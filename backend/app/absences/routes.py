"""Lecturer absence & leave management (admin only, RBAC resource
`lecturer_absences`). See utils/absences.py for how an absence turns into
exempted sessions."""
from datetime import date, timedelta

from flask import jsonify, request

from app.absences import absences_bp
from app.extensions import db
from app.models import LecturerAbsence, Timetable, User, utcnow
from app.utils.absences import (
    AbsenceIndex, Draft, affected_sessions, clean_absence_input, find_conflicts, record_absence_event,
    resolve_review_items, review_items_payload, session_list, snapshot, summarize_sessions, sync_review_items,
)
from app.utils.authz import current_user, permission_required
from app.utils.validation import ValidationError, clean_text, parse_iso_date


def _conflict_payload(conflicts):
    return [
        {"id": c.id, "start_date": c.start_date.isoformat(),
         "end_date": c.effective_end.isoformat() if c.effective_end else None,
         "reason_label": c.reason_label, "status_label": c.to_dict()["status_label"]}
        for c in conflicts
    ]


def _raise_conflicts(conflicts):
    if conflicts:
        first = conflicts[0]
        end = first.effective_end.strftime("%d %b %Y") if first.effective_end else "ongoing"
        err = ValidationError(
            f"This overlaps an absence already recorded for this lecturer "
            f"({first.reason_label}, {first.start_date:%d %b %Y} – {end}). "
            "Edit or close that one instead of recording a second.",
            status=409,
        )
        raise err


def _list_row(a: LecturerAbsence, today: date) -> dict:
    sessions = affected_sessions(a)
    summary = summarize_sessions(sessions, today)
    pending = sum(1 for i in a.review_items if i.resolution == "pending")
    return {
        **a.to_dict(today),
        "affected_sessions": summary["total_sessions"],
        "affected_past_sessions": summary["past_sessions"],
        "affected_classes": summary["batches"],
        "affected_courses": summary["courses"],
        "pending_reviews": pending,
    }


@absences_bp.get("/lecturer-absences")
@permission_required("lecturer_absences:view")
def list_absences():
    q = LecturerAbsence.query
    args = request.args
    if args.get("lecturer_id"):
        q = q.filter(LecturerAbsence.lecturer_id == args.get("lecturer_id", type=int))
    if args.get("reason"):
        if args["reason"] not in LecturerAbsence.REASONS:
            raise ValidationError("Unknown reason")
        q = q.filter(LecturerAbsence.reason == args["reason"])
    if args.get("from"):
        start = parse_iso_date(args["from"], "from")
        q = q.filter(db.or_(
            db.and_(LecturerAbsence.actual_end_date.isnot(None), LecturerAbsence.actual_end_date >= start),
            db.and_(LecturerAbsence.actual_end_date.is_(None),
                    db.or_(LecturerAbsence.end_date.is_(None), LecturerAbsence.end_date >= start)),
        ))
    if args.get("to"):
        q = q.filter(LecturerAbsence.start_date <= parse_iso_date(args["to"], "to"))
    today = date.today()
    rows = [_list_row(a, today) for a in q.order_by(LecturerAbsence.start_date.desc(), LecturerAbsence.id.desc()).all()]
    status = args.get("status")
    if status:
        if status not in LecturerAbsence.STATUS_LABELS:
            raise ValidationError("Unknown status")
        rows = [r for r in rows if r["status"] == status]
    return jsonify(rows)


@absences_bp.get("/lecturer-absences/options")
@permission_required("lecturer_absences:view")
def absence_options():
    lecturers = User.query.filter_by(role="lecturer").order_by(User.name).all()
    return jsonify({
        "lecturers": [{"id": u.id, "name": u.name, "status": u.status} for u in lecturers],
        "reasons": [{"value": k, "label": v} for k, v in LecturerAbsence.REASONS.items()],
        "statuses": [{"value": k, "label": v} for k, v in LecturerAbsence.STATUS_LABELS.items()],
    })


@absences_bp.get("/lecturer-absences/lecturer/<int:lecturer_id>/classes")
@permission_required("lecturer_absences:view")
def lecturer_classes(lecturer_id):
    """The lecturer's timetable, to pick specific classes, subjects, days or sessions."""
    User.query.filter_by(id=lecturer_id, role="lecturer").first_or_404()
    entries = Timetable.query.filter_by(lecturer_id=lecturer_id).order_by(Timetable.batch, Timetable.course_name, Timetable.start_time).all()
    return jsonify([e.to_dict() for e in entries if e.start_time])


@absences_bp.post("/lecturer-absences/preview")
@permission_required("lecturer_absences:add", "lecturer_absences:edit")
def preview_absence():
    """Affected sessions, attendance already recorded for them and any
    conflicting absence, before anything is saved."""
    data = request.get_json(silent=True) or {}
    existing = None
    if data.get("id"):
        existing = LecturerAbsence.query.get_or_404(int(data["id"]))
    fields = clean_absence_input(data, existing)
    draft = Draft(fields, absence_id=existing.id if existing else None,
                  actual_end_date=existing.actual_end_date if existing else None)
    today = date.today()
    sessions = affected_sessions(draft)
    summary = summarize_sessions(sessions, today)
    from app.models import Attendance, StudentAttendance

    past = [(e, d) for e, d in sessions if d <= today]
    existing_student = existing_lecturer = 0
    if past:
        pairs = {(e.id, d) for e, d in past}
        dates = sorted({d for _, d in past})
        existing_student = sum(
            1 for r in StudentAttendance.query.filter(
                StudentAttendance.timetable_id.in_({e.id for e, _ in past}),
                StudentAttendance.date >= dates[0], StudentAttendance.date <= dates[-1],
            ).with_entities(StudentAttendance.timetable_id, StudentAttendance.date).all()
            if (r[0], r[1]) in pairs
        )
        existing_lecturer = Attendance.query.filter(
            Attendance.lecturer_id == draft.lecturer_id, Attendance.date.in_(dates)).count()
    return jsonify({
        **summary,
        "sessions": session_list(sessions),
        "ongoing": draft.effective_end is None,
        "projected_until": sessions[-1][1].isoformat() if sessions else None,
        "existing_student_records": existing_student,
        "existing_lecturer_records": existing_lecturer,
        "conflicts": _conflict_payload(find_conflicts(draft, exclude_id=draft.id)),
    })


@absences_bp.post("/lecturer-absences")
@permission_required("lecturer_absences:add")
def create_absence():
    data = request.get_json(silent=True) or {}
    fields = clean_absence_input(data)
    _raise_conflicts(find_conflicts(Draft(fields)))
    actor = current_user()
    absence = LecturerAbsence(**fields, created_by_id=actor.id, updated_by_id=actor.id)
    db.session.add(absence)
    db.session.flush()
    record_absence_event(absence, actor, "created", new=snapshot(absence))
    flagged = sync_review_items(absence)
    db.session.commit()
    return jsonify({**_detail(absence), "flagged_for_review": flagged}), 201


def _detail(a: LecturerAbsence) -> dict:
    today = date.today()
    sessions = affected_sessions(a)
    return {
        **a.to_dict(today),
        "affected": summarize_sessions(sessions, today),
        "sessions": session_list(sessions),
        "review_items": review_items_payload(a),
        "events": [e.to_dict() for e in reversed(a.events)],
    }


@absences_bp.get("/lecturer-absences/<int:absence_id>")
@permission_required("lecturer_absences:view")
def get_absence(absence_id):
    return jsonify(_detail(LecturerAbsence.query.get_or_404(absence_id)))


@absences_bp.put("/lecturer-absences/<int:absence_id>")
@permission_required("lecturer_absences:edit")
def update_absence(absence_id):
    absence = LecturerAbsence.query.get_or_404(absence_id)
    if absence.state == "cancelled":
        raise ValidationError("A cancelled absence cannot be edited. Record a new one instead.", status=409)
    data = request.get_json(silent=True) or {}
    fields = clean_absence_input(data, absence)
    if fields["lecturer_id"] != absence.lecturer_id:
        raise ValidationError("The lecturer of an absence cannot be changed. Cancel it and record a new one.")
    if absence.actual_end_date and absence.actual_end_date < fields["start_date"]:
        raise ValidationError("The start date is after the recorded return date")
    _raise_conflicts(find_conflicts(Draft(fields, absence.id, absence.actual_end_date), exclude_id=absence.id))
    old = snapshot(absence)
    for k, v in fields.items():
        setattr(absence, k, v)
    actor = current_user()
    absence.updated_by_id = actor.id
    new = snapshot(absence)
    if new == old:
        return jsonify(_detail(absence))
    record_absence_event(absence, actor, "edited", old=old, new=new,
                         note=clean_text(data.get("change_note"), "Note", max_len=500))
    flagged = sync_review_items(absence)
    db.session.commit()
    return jsonify({**_detail(absence), "flagged_for_review": flagged})


@absences_bp.post("/lecturer-absences/<int:absence_id>/close")
@permission_required("lecturer_absences:edit")
def close_absence(absence_id):
    """Early return / end of an ongoing absence: `return_date` is the
    lecturer's first day back. Sessions from that day on are no longer
    exempted, so normal attendance resumes."""
    absence = LecturerAbsence.query.get_or_404(absence_id)
    if absence.state == "cancelled":
        raise ValidationError("This absence was cancelled", status=409)
    data = request.get_json(silent=True) or {}
    if not data.get("return_date"):
        raise ValidationError("Enter the date the lecturer returned (their first day back)")
    returned = parse_iso_date(data["return_date"], "return_date")
    if returned <= absence.start_date:
        raise ValidationError("The return date must be after the start date. To remove the absence entirely, cancel it.")
    if absence.end_date and returned > absence.end_date + timedelta(days=1):
        raise ValidationError("That is after the expected end date. Edit the absence to extend it instead.")
    old = snapshot(absence)
    actor = current_user()
    absence.actual_end_date = returned - timedelta(days=1)
    absence.state = "closed"
    absence.closed_by_id = actor.id
    absence.closed_at = utcnow()
    record_absence_event(absence, actor, "closed", old=old, new=snapshot(absence),
                         note=clean_text(data.get("note"), "Note", max_len=500)
                         or f"Lecturer returned on {returned:%d %b %Y}")
    sync_review_items(absence)
    db.session.commit()
    return jsonify(_detail(absence))


@absences_bp.post("/lecturer-absences/<int:absence_id>/cancel")
@permission_required("lecturer_absences:delete")
def cancel_absence(absence_id):
    """Cancel an absence recorded in error. Its sessions stop being
    exempted; nothing is deleted, and it stays in the list as Cancelled."""
    absence = LecturerAbsence.query.get_or_404(absence_id)
    if absence.state == "cancelled":
        raise ValidationError("This absence is already cancelled", status=409)
    data = request.get_json(silent=True) or {}
    reason = clean_text(data.get("reason"), "Reason", max_len=500, required=True)
    actor = current_user()
    old_state = absence.state
    absence.state = "cancelled"
    absence.cancel_reason = reason
    absence.cancelled_by_id = actor.id
    absence.cancelled_at = utcnow()
    record_absence_event(absence, actor, "cancelled", old={"state": old_state}, new={"state": "cancelled"}, note=reason)
    sync_review_items(absence)
    AbsenceIndex.invalidate()
    db.session.commit()
    return jsonify(_detail(absence))


@absences_bp.post("/lecturer-absences/<int:absence_id>/review")
@permission_required("lecturer_absences:edit")
def resolve_review(absence_id):
    """Decide attendance rows that were already recorded for covered
    sessions: 'exempted' (the session doesn't count -- the default) or
    'kept' (the recorded status counts as normal). The rows themselves are
    never changed."""
    absence = LecturerAbsence.query.get_or_404(absence_id)
    data = request.get_json(silent=True) or {}
    resolution = data.get("resolution")
    if data.get("all"):
        ids = [i.id for i in absence.review_items]
    else:
        ids = data.get("item_ids")
        if not isinstance(ids, list) or not ids:
            raise ValidationError("Choose at least one record")
        try:
            ids = [int(i) for i in ids]
        except (TypeError, ValueError):
            raise ValidationError("Invalid record id")
    actor = current_user()
    changed = resolve_review_items(absence, ids, resolution, actor)
    if changed:
        record_absence_event(absence, actor, "review_resolved", new={"resolution": resolution, "records": changed},
                             note=f"{changed} record(s) marked {resolution}")
    db.session.commit()
    return jsonify(_detail(absence))
