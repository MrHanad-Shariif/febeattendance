"""Lecturer lateness, Academic Office review and makeup sessions
(RBAC lecturer_attendance: view to see, edit to review/assign/correct).

  GET  /api/admin/punctuality                      every lecturer's totals for a period
  GET  /api/admin/punctuality/export               the same, PDF or Excel
  GET  /api/admin/punctuality/<lecturer_id>        one lecturer: totals, session history, reviews, makeups, corrections
  GET  /api/admin/punctuality/<lecturer_id>/export
  POST /api/admin/punctuality/<lecturer_id>/review {decision, comment}
  POST /api/admin/makeup-sessions                  assign
  PUT  /api/admin/makeup-sessions/<id>             reschedule
  POST /api/admin/makeup-sessions/<id>/complete | /cancel
  PUT  /api/admin/attendance/<id>/correct          correct a check-in/out (audited)
"""
from datetime import date, datetime

from flask import Blueprint, jsonify, request

from app.extensions import db
from app.models import Attendance, AttendanceCorrection, LatenessReview, MakeupSession, Timetable, User, utcnow
from app.utils import report_export as rx
from app.utils.attendance_report import lecturer_session_rows, resolve_period
from app.utils.authz import current_user, permission_required
from app.utils.notify import notify
from app.utils.punctuality import all_lecturers, lecturer_summary
from app.utils.status import compute_checkin_status, compute_checkout_status
from app.utils.validation import ValidationError, clean_text, parse_hhmm, parse_iso_date

punctuality_bp = Blueprint("punctuality", __name__, url_prefix="/api/admin")


def _period():
    args = request.args.to_dict()
    args.setdefault("period", "semester")
    return resolve_period(args)


def _period_json(p):
    return {"period": p["period"], "from": p["from"].isoformat(), "to": p["to"].isoformat(), "label": p["label"]}


@punctuality_bp.get("/punctuality")
@permission_required("lecturer_attendance:view", "reports:view")
def punctuality_list():
    p = _period()
    return jsonify({**_period_json(p), "rows": all_lecturers(p["from"], p["to"])})


def _lecturer_detail(lecturer, p):
    rows = lecturer_session_rows(p["from"], p["to"], lecturer_id=lecturer.id)
    summary = lecturer_summary(lecturer.id, p["from"], p["to"], rows)
    corrections = (AttendanceCorrection.query.filter_by(lecturer_id=lecturer.id)
                   .order_by(AttendanceCorrection.created_at.desc()).limit(200).all())
    return {
        **_period_json(p), "lecturer": {"id": lecturer.id, "name": lecturer.name, "email": lecturer.email,
                                        "department": lecturer.department},
        "summary": summary,
        "sessions": [r for r in rows if r["category"] != "not_yet"],
        "reviews": [r.to_dict() for r in LatenessReview.query.filter_by(lecturer_id=lecturer.id)
                    .order_by(LatenessReview.created_at.desc()).all()],
        "makeups": [m.to_dict() for m in MakeupSession.query.filter_by(lecturer_id=lecturer.id)
                    .order_by(MakeupSession.scheduled_date.desc()).all()],
        "corrections": [c.to_dict() for c in corrections],
        "classes": [t.to_dict() for t in Timetable.query.filter_by(lecturer_id=lecturer.id).all() if t.start_time],
    }


@punctuality_bp.get("/punctuality/<int:lecturer_id>")
@permission_required("lecturer_attendance:view", "reports:view")
def punctuality_detail(lecturer_id):
    lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first_or_404()
    return jsonify(_lecturer_detail(lecturer, _period()))


SUMMARY_COLS = [rx.Column("lecturer_name", "Lecturer", 26), rx.Column("department", "Department", 18),
                rx.Column("scheduled_sessions", "Scheduled", 9, "int"), rx.Column("conducted_sessions", "Conducted", 9, "int"),
                rx.Column("late_sessions", "Late sessions", 9, "int"), rx.Column("late_minutes", "Late minutes", 9, "int"),
                rx.Column("equivalent_sessions", "Equivalent sessions", 10, "int"),
                rx.Column("makeup_assigned", "Makeups assigned", 9, "int"), rx.Column("makeup_completed", "Makeups done", 9, "int"),
                rx.Column("makeup_outstanding", "Outstanding", 9, "int"), rx.Column("review_flag", "Review", 12)]


@punctuality_bp.get("/punctuality/export")
@permission_required("lecturer_attendance:view", "reports:view")
def punctuality_export():
    fmt = rx.export_format()
    p = _period()
    rows = all_lecturers(p["from"], p["to"])
    for r in rows:
        r["review_flag"] = "Needs review" if r["needs_review"] else ""
        r["category"] = "late" if r["needs_review"] else None
    threshold = rows[0]["minutes_per_equivalent_session"] if rows else None
    cells = [("Lecturers", len(rows), None), ("Late minutes", sum(r["late_minutes"] for r in rows), "late"),
             ("Equivalent sessions", sum(r["equivalent_sessions"] for r in rows), None),
             ("Needing review", sum(1 for r in rows if r["needs_review"]), "late")]
    note = (f"Late minutes are measured per session against its scheduled start. Every {threshold or 90} late minutes = one "
            "equivalent session, flagged for Academic Office review; nothing is marked missed automatically.")
    t = rx.Table("Late minutes", "Lecturer late minutes and makeup sessions", SUMMARY_COLS, rows, summary=cells,
                 note=note, status_col="review_flag")
    return rx.send(rx.Report("Lecturer Punctuality and Makeup Sessions", "Lecturer_Punctuality", p["label"], [t]), fmt)


@punctuality_bp.get("/punctuality/<int:lecturer_id>/export")
@permission_required("lecturer_attendance:view", "reports:view")
def punctuality_lecturer_export(lecturer_id):
    fmt = rx.export_format()
    lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first_or_404()
    d = _lecturer_detail(lecturer, _period())
    s = d["summary"]
    cells = [("Late minutes", s["late_minutes"], "late"), ("Equivalent sessions", s["equivalent_sessions"], None),
             ("Scheduled", s["scheduled_sessions"], None), ("Conducted", s["conducted_sessions"], "present"),
             ("Makeups assigned", s["makeup_assigned"], None), ("Makeups completed", s["makeup_completed"], "present"),
             ("Outstanding", s["makeup_outstanding"], "absent")]
    session_cols = [rx.Column("date", "Date", 11), rx.Column("day", "Day", 6), rx.Column("class_name", "Class", 11),
                    rx.Column("course_name", "Course", 28), rx.Column("scheduled_start", "Starts", 7),
                    rx.Column("checkin_at", "Arrived", 7), rx.Column("late_minutes", "Late min.", 8, "int"),
                    rx.Column("status_label", "Status", 20), rx.Column("delivery_mode", "Mode", 8), rx.Column("remarks", "Remarks", 28)]
    makeup_cols = [rx.Column("scheduled_date", "Date", 11), rx.Column("course_name", "Course", 26), rx.Column("batch", "Class", 10),
                   rx.Column("start_time", "Start", 7), rx.Column("end_time", "End", 7), rx.Column("room", "Room", 9),
                   rx.Column("reason_label", "Reason", 20), rx.Column("status_label", "Status", 11)]
    tables = [rx.Table("Sessions", "Session-by-session attendance and lateness", session_cols, d["sessions"],
                       summary=cells, status_col="status_label"),
              rx.Table("Makeup sessions", "Makeup sessions", makeup_cols, d["makeups"])]
    return rx.send(rx.Report(f"Punctuality: {lecturer.name}", f"Punctuality_{lecturer.name}", d["label"], tables), fmt)


@punctuality_bp.post("/punctuality/<int:lecturer_id>/review")
@permission_required("lecturer_attendance:edit")
def review_lateness(lecturer_id):
    actor = current_user()
    lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first_or_404()
    if lecturer.id == actor.id:
        raise ValidationError("You cannot review your own lateness", status=403)
    data = request.get_json(silent=True) or {}
    decision = data.get("decision")
    if decision not in LatenessReview.DECISIONS:
        raise ValidationError("Choose a decision")
    comment = clean_text(data.get("comment"), "Comment", max_len=1000)
    if decision in ("warning", "no_action") and not comment:
        raise ValidationError("Add a comment explaining the decision")
    p = _period()
    s = lecturer_summary(lecturer.id, p["from"], p["to"])
    review = LatenessReview(lecturer_id=lecturer.id, period_from=p["from"], period_to=p["to"],
                            late_minutes=s["late_minutes"], equivalent_sessions=s["equivalent_sessions"],
                            decision=decision, comment=comment, reviewed_by_id=actor.id, reviewed_by_name=actor.name)
    db.session.add(review)
    notify([lecturer], type="notice", title="Academic Office review of your late minutes",
           message=(f"{s['late_minutes']} late minutes ({s['equivalent_sessions']} equivalent session(s)) for {p['label']}. "
                    f"Decision: {LatenessReview.DECISIONS[decision]}." + (f" {comment}" if comment else "")),
           link="/", email_subject="FEBEMS – Review of your late minutes")
    db.session.commit()
    return jsonify(review.to_dict()), 201


def _hist(m, actor, action, note=None):
    m.history = (m.history or []) + [{"action": action, "by": actor.name, "at": datetime.now().isoformat(timespec="seconds"),
                                      "note": note}]


def _students_of(batch):
    from app.utils.batches import members

    codes = members(batch)
    return User.query.filter(User.role == "student", User.status == "active", User.batch.in_(codes)).all() if codes else []


def _announce_makeup(m, action):
    when = f"{m.scheduled_date:%A %d %b %Y}" + (f", {m.start_time:%H:%M}" if m.start_time else "") + \
        (f"–{m.end_time:%H:%M}" if m.end_time else "")
    where = f" in {m.room}" if m.room else ""
    if action == "cancelled":
        title, msg = f"Makeup class cancelled: {m.course_name}", f"The makeup class on {when}{where} is cancelled."
    else:
        verb = "rescheduled to" if action == "rescheduled" else "on"
        title = f"Makeup class: {m.course_name} ({m.batch})"
        msg = f"A makeup class for {m.course_name} is {verb} {when}{where}" + \
              (f", replacing the session of {m.replaces_date:%d %b}" if m.replaces_date else "") + "."
    notify([m.lecturer], type="notice", title=title, message=msg, link="/", related_id=m.id,
           email_subject=f"FEBEMS – {title}")
    notify(_students_of(m.batch), type="class_notice", title=title, message=msg, link="/", related_id=m.id,
           email_subject=f"FEBEMS – {title}", include_students=True)


def _clean_makeup(data, m=None):
    def pick(k):
        return data[k] if k in data else (getattr(m, k) if m else None)

    d = pick("scheduled_date")
    d = d if isinstance(d, date) else parse_iso_date(d, "Date") if d else None
    if d is None:
        raise ValidationError("Choose the makeup date")
    start = pick("start_time")
    start = start if start is None or not isinstance(start, str) else parse_hhmm(start, "Start time")
    end = pick("end_time")
    end = end if end is None or not isinstance(end, str) else parse_hhmm(end, "End time")
    if start and end and end <= start:
        raise ValidationError("End time must be after the start time")
    return d, start, end, clean_text(pick("room"), "Room", max_len=100), clean_text(pick("notes"), "Notes", max_len=1000)


@punctuality_bp.post("/makeup-sessions")
@permission_required("lecturer_attendance:edit")
def assign_makeup():
    actor = current_user()
    data = request.get_json(silent=True) or {}
    lecturer = User.query.filter_by(id=data.get("lecturer_id"), role="lecturer").first()
    if not lecturer:
        raise ValidationError("Choose the lecturer")
    entry = Timetable.query.get(data.get("timetable_id")) if data.get("timetable_id") else None
    if entry is None or entry.lecturer_id != lecturer.id:
        raise ValidationError("Choose one of the lecturer's classes")
    reason = data.get("reason") or "late_minutes"
    if reason not in MakeupSession.REASONS:
        raise ValidationError("Unknown reason")
    d, start, end, room, notes = _clean_makeup(data)
    if d < date.today():
        raise ValidationError("A makeup session is scheduled for today or later")
    if not start:
        start, end = entry.start_time, entry.end_time
    m = MakeupSession(lecturer_id=lecturer.id, timetable_id=entry.id, reason=reason,
                      review_id=data.get("review_id") or None, course_name=entry.course_name, batch=entry.batch,
                      scheduled_date=d, start_time=start, end_time=end, room=room or entry.room, notes=notes,
                      replaces_date=parse_iso_date(data["replaces_date"], "Replaces") if data.get("replaces_date") else None,
                      created_by_id=actor.id, updated_by_id=actor.id)
    _hist(m, actor, "assigned", notes)
    db.session.add(m)
    db.session.flush()
    _announce_makeup(m, "assigned")
    db.session.commit()
    return jsonify(m.to_dict()), 201


def _open_makeup(makeup_id):
    m = MakeupSession.query.get_or_404(makeup_id)
    if m.status != "assigned":
        raise ValidationError(f"This makeup session is {m.status}", status=409)
    return m


@punctuality_bp.put("/makeup-sessions/<int:makeup_id>")
@permission_required("lecturer_attendance:edit")
def reschedule_makeup(makeup_id):
    actor = current_user()
    m = _open_makeup(makeup_id)
    data = request.get_json(silent=True) or {}
    old = (m.scheduled_date, m.start_time, m.end_time, m.room)
    m.scheduled_date, m.start_time, m.end_time, m.room, m.notes = _clean_makeup(data, m)
    if m.scheduled_date < date.today():
        raise ValidationError("A makeup session is scheduled for today or later")
    m.updated_by_id = actor.id
    if old != (m.scheduled_date, m.start_time, m.end_time, m.room):
        _hist(m, actor, "rescheduled", f"Was {old[0]:%d %b %Y}" + (f" {old[1]:%H:%M}" if old[1] else ""))
        _announce_makeup(m, "rescheduled")
    db.session.commit()
    return jsonify(m.to_dict())


@punctuality_bp.post("/makeup-sessions/<int:makeup_id>/complete")
@permission_required("lecturer_attendance:edit")
def complete_makeup(makeup_id):
    actor = current_user()
    m = _open_makeup(makeup_id)
    if m.scheduled_date > date.today():
        raise ValidationError("It can be marked completed on or after its date")
    note = clean_text((request.get_json(silent=True) or {}).get("note"), "Note", max_len=500)
    m.status, m.completed_at, m.completed_note, m.updated_by_id = "completed", utcnow(), note, actor.id
    _hist(m, actor, "completed", note)
    db.session.commit()
    return jsonify(m.to_dict())


@punctuality_bp.post("/makeup-sessions/<int:makeup_id>/cancel")
@permission_required("lecturer_attendance:edit")
def cancel_makeup(makeup_id):
    actor = current_user()
    m = _open_makeup(makeup_id)
    reason = clean_text((request.get_json(silent=True) or {}).get("reason"), "Reason", max_len=500, required=True)
    m.status, m.updated_by_id = "cancelled", actor.id
    _hist(m, actor, "cancelled", reason)
    _announce_makeup(m, "cancelled")
    db.session.commit()
    return jsonify(m.to_dict())


def _snap(r):
    return {"checkin_at": r.checkin_at.isoformat(timespec="minutes") if r.checkin_at else None,
            "checkout_at": r.checkout_at.isoformat(timespec="minutes") if r.checkout_at else None,
            "status": r.status, "remarks": r.remarks}


@punctuality_bp.put("/attendance/<int:record_id>/correct")
@permission_required("lecturer_attendance:edit")
def correct_attendance(record_id):
    """Correct a lecturer's check-in or check-out time (e.g. the kiosk was
    down). A reason is required; status and late minutes are recalculated
    and the change is kept in the correction log."""
    actor = current_user()
    r = Attendance.query.get_or_404(record_id)
    data = request.get_json(silent=True) or {}
    reason = clean_text(data.get("reason"), "Reason", max_len=500, required=True)
    old = _snap(r)
    for key in ("checkin_at", "checkout_at"):
        if key in data:
            t = parse_hhmm(data.get(key), "Time") if data.get(key) else None
            setattr(r, key, datetime.combine(r.date, t) if t else None)
    if r.checkin_at and r.checkout_at and r.checkout_at <= r.checkin_at:
        raise ValidationError("Check-out must be after check-in")
    if r.checkin_at:
        r.status = compute_checkin_status(r.scheduled_start, r.checkin_at)
        if r.checkout_at:
            r.status = compute_checkout_status(r.scheduled_end, r.checkout_at, r.status)
    else:
        r.status = "absent"
        r.checkout_at = None
    if _snap(r) == old:
        return jsonify(r.to_dict())
    db.session.add(AttendanceCorrection(attendance_id=r.id, lecturer_id=r.lecturer_id, old_value=old, new_value=_snap(r),
                                        reason=reason, actor_id=actor.id, actor_name=actor.name))
    db.session.commit()
    return jsonify(r.to_dict())
