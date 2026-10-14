"""Lecturer leave requests and same-day absence reports, and their review.

Lecturer (own records only):
  GET  /api/lecturer/leave                      dashboard: my absences with countdown, my requests
  POST /api/lecturer/leave-requests             submit (multipart: fields + optional document)
  PUT  /api/lecturer/leave-requests/<id>        change and resubmit while pending / more info asked
  POST /api/lecturer/leave-requests/<id>/withdraw
  GET  /api/leave-requests/<id>/document        the lecturer or a reviewer

Academic Office (RBAC lecturer_absences):
  GET  /api/admin/leave-requests                ?status=
  GET  /api/admin/leave-requests/<id>           with affected sessions and conflicts
  POST /api/admin/leave-requests/<id>/decision  {decision: approve|reject|more_info, comment, justified}

A request never exempts a session or cancels a class by itself. Approval
creates the LecturerAbsence (same rules, audit trail and notifications as
one recorded by the Academic Office) and links it to the request.
"""
from datetime import date

from flask import jsonify, request

from app.extensions import db
from app.leave_requests import leave_bp
from app.models import LeaveRequest, LeaveRequestEvent, LecturerAbsence, Timetable, utcnow
from app.utils.absences import (
    Draft, affected_sessions, find_conflicts, record_absence_event, session_list, snapshot, summarize_sessions,
    sync_review_items,
)
from app.utils.authz import current_user, permission_required, roles_required
from app.utils.leave import countdown, notify_lecturer_of_absence, sync_class_notices, users_with_permission
from app.utils.notify import notify
from app.utils.rbac import has_permission
from app.utils.uploads import delete_document, save_document, send_document
from app.utils.validation import ValidationError, clean_text, parse_iso_date

MIN_REMARKS = 10
MAX_DAYS = 366


def _event(req, actor, action, note=None):
    req.events.append(LeaveRequestEvent(actor_id=actor.id if actor else None, actor_name=actor.name if actor else None,
                                        action=action, note=note))


def _form() -> dict:
    return request.form if request.files or request.form else (request.get_json(silent=True) or {})


def _clean(data, lecturer, existing=None) -> dict:
    def pick(k):
        return data.get(k) if k in data else (getattr(existing, k) if existing else None)

    kind = pick("kind") or "leave"
    if kind not in LeaveRequest.KINDS:
        raise ValidationError("Choose leave request or same-day absence")
    reason = pick("reason")
    if reason not in LecturerAbsence.REASONS:
        raise ValidationError("Choose the type of absence or leave")
    custom = clean_text(pick("custom_reason"), "Type of absence", max_len=200)
    if reason == "other" and not custom:
        raise ValidationError("Describe the type of absence")
    if reason != "other":
        custom = None
    remarks = clean_text(pick("remarks"), "Reason / remarks", max_len=1000)
    if not remarks or len(remarks) < MIN_REMARKS:
        raise ValidationError(f"Explain the reason in the remarks (at least {MIN_REMARKS} characters). "
                              "A request cannot be sent without a reason.")

    today = date.today()
    raw_start, raw_end = pick("start_date"), pick("end_date")
    start = raw_start if isinstance(raw_start, date) else parse_iso_date(raw_start, "Start date") if raw_start else None
    if kind == "same_day":
        start = start or today
        if start != today:
            raise ValidationError("A same-day absence is for today. For other dates, send a leave request.")
    if start is None:
        raise ValidationError("Choose the start date")
    end = raw_end if isinstance(raw_end, date) else parse_iso_date(raw_end, "End date") if raw_end else start
    if end < start:
        raise ValidationError("The end date cannot be before the start date")
    if (end - start).days + 1 > MAX_DAYS:
        raise ValidationError("A request cannot be longer than a year")
    if kind == "leave" and start < today and existing is None:
        raise ValidationError("Leave must start today or later. For a past absence, contact the Academic Office.")

    raw_ids = data.getlist("timetable_ids") if hasattr(data, "getlist") else (pick("timetable_ids") or [])
    if isinstance(raw_ids, str):
        raw_ids = [x for x in raw_ids.split(",") if x.strip()]
    try:
        ids = sorted({int(x) for x in raw_ids})
    except (TypeError, ValueError):
        raise ValidationError("Choose the affected classes from your timetable")
    if ids:
        own = {t.id for t in Timetable.query.filter(Timetable.id.in_(ids), Timetable.lecturer_id == lecturer.id).all()}
        if set(ids) - own:
            raise ValidationError("You can only choose your own classes")
    return {"kind": kind, "reason": reason, "custom_reason": custom, "remarks": remarks,
            "start_date": start, "end_date": end, "timetable_ids": ids or None}


def _draft(req_or_fields, lecturer_id):
    f = req_or_fields if isinstance(req_or_fields, dict) else {
        k: getattr(req_or_fields, k) for k in ("start_date", "end_date", "timetable_ids")}
    return Draft({"lecturer_id": lecturer_id, "start_date": f["start_date"], "end_date": f["end_date"],
                  "timetable_ids": f.get("timetable_ids"), "batches": None, "courses": None, "days": None})


def _check_contradictions(fields, lecturer, exclude_id=None):
    """No second open request over the same dates, and nothing the Academic
    Office has already recorded for the same sessions."""
    open_reqs = LeaveRequest.query.filter(LeaveRequest.lecturer_id == lecturer.id,
                                          LeaveRequest.status.in_(LeaveRequest.OPEN)).all()
    for other in open_reqs:
        if other.id != exclude_id and other.start_date <= fields["end_date"] and fields["start_date"] <= other.end_date:
            raise ValidationError(
                f"You already have a request for {other.start_date:%d %b} – {other.end_date:%d %b %Y} "
                f"({other.status_label.lower()}). Change that one instead.", status=409)
    conflicts = find_conflicts(_draft(fields, lecturer.id))
    if conflicts:
        a = conflicts[0]
        end = a.effective_end
        raise ValidationError(
            f"The Academic Office has already recorded {a.reason_label.lower()} for you from {a.start_date:%d %b %Y}"
            + (f" to {end:%d %b %Y}" if end else "") + " covering these classes.", status=409)


def _reviewers():
    return users_with_permission("lecturer_absences:add")


def _tell_reviewers(req, action):
    title = {"submitted": "New leave request", "resubmitted": "Leave request updated",
             "same_day": "Same-day absence reported"}[action]
    who = req.lecturer.name if req.lecturer else "A lecturer"
    message = (f"{who}: {req.reason_label}, {req.start_date:%d %b %Y}"
               + (f" to {req.end_date:%d %b %Y}" if req.end_date != req.start_date else "") + f". Reason: {req.remarks}")
    notify(_reviewers(), type="leave", title=f"{title}: {who}", message=message,
           link=f"/admin/lecturer-absences?tab=requests&request={req.id}", related_id=req.id,
           email_subject=f"FEBEMS – {title}: {who}"[:255], exclude=req.lecturer)


def _payload(req, today=None):
    """A request only has a countdown once approved: a pending one is not leave."""
    d = req.to_dict()
    d["countdown"] = countdown(req.absence, today) if req.status == "approved" and req.absence else None
    return d


# ---------- lecturer ----------

@leave_bp.get("/lecturer/leave")
@roles_required("lecturer")
def my_leave():
    user = current_user()
    today = date.today()
    absences = (LecturerAbsence.query.filter_by(lecturer_id=user.id)
                .order_by(LecturerAbsence.start_date.desc()).limit(50).all())
    rows = []
    for a in absences:
        rows.append({**a.to_dict(today), "countdown": countdown(a, today)})
    current = next((r for r in rows if r["countdown"]["phase"] == "active"), None)
    upcoming = sorted((r for r in rows if r["countdown"]["phase"] == "upcoming"), key=lambda r: r["start_date"])
    requests_ = LeaveRequest.query.filter_by(lecturer_id=user.id).order_by(LeaveRequest.created_at.desc()).all()
    classes = Timetable.query.filter_by(lecturer_id=user.id).order_by(Timetable.batch, Timetable.course_name).all()
    return jsonify({
        "current": current,
        "upcoming": upcoming,
        "absences": rows,
        "requests": [_payload(r, today) for r in requests_],
        "pending_requests": sum(1 for r in requests_ if r.status in LeaveRequest.OPEN),
        "reasons": [{"value": k, "label": v} for k, v in LecturerAbsence.REASONS.items()],
        "kinds": [{"value": k, "label": v} for k, v in LeaveRequest.KINDS.items()],
        "classes": [c.to_dict() for c in classes if c.start_time],
    })


@leave_bp.post("/lecturer/leave-requests")
@roles_required("lecturer")
def submit_request():
    user = current_user()
    data = _form()
    fields = _clean(data, user)
    _check_contradictions(fields, user)
    req = LeaveRequest(lecturer_id=user.id, **fields)
    saved = save_document(request.files.get("document"), "leave")
    if saved:
        req.document_name, req.document_path = saved
    db.session.add(req)
    _event(req, user, "submitted", fields["remarks"])
    db.session.flush()
    _tell_reviewers(req, "same_day" if req.kind == "same_day" else "submitted")
    notify([user], type="leave", title=f"{LeaveRequest.KINDS[req.kind]} sent",
           message=(f"Your {LeaveRequest.KINDS[req.kind].lower()} for {req.start_date:%d %b %Y}"
                    + (f" to {req.end_date:%d %b %Y}" if req.end_date != req.start_date else "")
                    + " was sent to the Academic Office. It is pending review: your classes are not cancelled "
                      "until it is approved."),
           link="/my-leave", related_id=req.id)
    db.session.commit()
    return jsonify(_payload(req)), 201


def _own_open_request(request_id):
    user = current_user()
    req = LeaveRequest.query.get_or_404(request_id)
    if req.lecturer_id != user.id:
        raise ValidationError("This is not your request", status=403)
    if req.status not in LeaveRequest.OPEN:
        raise ValidationError(f"This request is {req.status_label.lower()} and can no longer be changed", status=409)
    return user, req


@leave_bp.put("/lecturer/leave-requests/<int:request_id>")
@roles_required("lecturer")
def update_request(request_id):
    user, req = _own_open_request(request_id)
    data = _form()
    fields = _clean(data, user, existing=req)
    _check_contradictions(fields, user, exclude_id=req.id)
    for k, v in fields.items():
        setattr(req, k, v)
    saved = save_document(request.files.get("document"), "leave")
    if saved:
        delete_document(req.document_path)
        req.document_name, req.document_path = saved
    was_more_info = req.status == "more_info"
    req.status = "pending"
    _event(req, user, "resubmitted", clean_text(data.get("note"), "Note", max_len=1000) or fields["remarks"])
    _tell_reviewers(req, "resubmitted")
    db.session.commit()
    return jsonify({**_payload(req), "was_more_info": was_more_info})


@leave_bp.post("/lecturer/leave-requests/<int:request_id>/withdraw")
@roles_required("lecturer")
def withdraw_request(request_id):
    user, req = _own_open_request(request_id)
    req.status = "withdrawn"
    _event(req, user, "withdrawn", clean_text((request.get_json(silent=True) or {}).get("note"), "Note", max_len=500))
    db.session.commit()
    return jsonify(_payload(req))


@leave_bp.get("/leave-requests/<int:request_id>/document")
@roles_required("lecturer", "admin")
def request_document(request_id):
    user = current_user()
    req = LeaveRequest.query.get_or_404(request_id)
    if req.lecturer_id != user.id and not has_permission(user, "lecturer_absences:view"):
        raise ValidationError("You do not have permission to do that.", status=403)
    if not req.document_path:
        raise ValidationError("No document was attached", status=404)
    return send_document(req.document_path, req.document_name or "document")


# ---------- Academic Office ----------

@leave_bp.get("/admin/leave-requests")
@permission_required("lecturer_absences:view")
def list_requests():
    q = LeaveRequest.query
    status = request.args.get("status")
    if status:
        if status not in LeaveRequest.STATUS_LABELS:
            raise ValidationError("Unknown status")
        q = q.filter_by(status=status)
    rows = q.order_by(LeaveRequest.created_at.desc()).all()
    counts = {k: LeaveRequest.query.filter_by(status=k).count() for k in LeaveRequest.STATUS_LABELS}
    return jsonify({"rows": [_payload(r) for r in rows], "counts": counts,
                    "statuses": [{"value": k, "label": v} for k, v in LeaveRequest.STATUS_LABELS.items()]})


@leave_bp.get("/admin/leave-requests/<int:request_id>")
@permission_required("lecturer_absences:view")
def get_request(request_id):
    req = LeaveRequest.query.get_or_404(request_id)
    draft = _draft(req, req.lecturer_id)
    sessions = affected_sessions(draft)
    conflicts = find_conflicts(draft) if req.status in LeaveRequest.OPEN else []
    return jsonify({**_payload(req), "affected": summarize_sessions(sessions), "sessions": session_list(sessions),
                    "conflicts": [{"id": a.id, "reason_label": a.reason_label, "start_date": a.start_date.isoformat(),
                                   "end_date": a.effective_end.isoformat() if a.effective_end else None} for a in conflicts]})


@leave_bp.post("/admin/leave-requests/<int:request_id>/decision")
@permission_required("lecturer_absences:add")
def decide(request_id):
    actor = current_user()
    req = LeaveRequest.query.get_or_404(request_id)
    if req.status not in LeaveRequest.OPEN:
        raise ValidationError(f"This request is already {req.status_label.lower()}", status=409)
    if req.lecturer_id == actor.id:
        raise ValidationError("You cannot decide your own leave request. Another member of the Academic Office must review it.",
                              status=403)
    data = request.get_json(silent=True) or {}
    decision = data.get("decision")
    comment = clean_text(data.get("comment"), "Comment", max_len=1000)
    if decision not in ("approve", "reject", "more_info"):
        raise ValidationError("decision must be approve, reject or more_info")
    if decision in ("reject", "more_info") and not comment:
        raise ValidationError("Give a reason, so the lecturer knows why" if decision == "reject"
                              else "Say what information is needed")

    req.reviewer_id, req.reviewed_at, req.review_comment = actor.id, utcnow(), comment
    if decision == "approve":
        conflicts = find_conflicts(_draft(req, req.lecturer_id))
        if conflicts:
            a = conflicts[0]
            raise ValidationError(f"An absence is already recorded for these sessions ({a.reason_label}, from "
                                  f"{a.start_date:%d %b %Y}). Edit that absence instead.", status=409)
        absence = LecturerAbsence(
            lecturer_id=req.lecturer_id, start_date=req.start_date, end_date=req.end_date, reason=req.reason,
            custom_reason=req.custom_reason, remarks=req.remarks, justified=bool(data.get("justified", True)),
            timetable_ids=req.timetable_ids, created_by_id=actor.id, updated_by_id=actor.id,
        )
        db.session.add(absence)
        db.session.flush()
        record_absence_event(absence, actor, "created", new=snapshot(absence),
                             note=f"Approved leave request #{req.id}" + (f": {comment}" if comment else ""))
        sync_review_items(absence)
        req.absence_id = absence.id
        req.status = "approved"
        _event(req, actor, "approved", comment)
        db.session.commit()
        notify_lecturer_of_absence(absence, "approved", comment)
        sync_class_notices(absence.lecturer_id)
    else:
        req.status = "rejected" if decision == "reject" else "more_info"
        _event(req, actor, req.status, comment)
        title = ("Your leave request was not approved" if decision == "reject"
                 else "More information needed for your leave request")
        notify([req.lecturer], type="leave", title=title,
               message=f"{req.reason_label}, {req.start_date:%d %b %Y} to {req.end_date:%d %b %Y}. {comment}",
               link="/my-leave", related_id=req.id, email_subject=f"FEBEMS Leave – {title}"[:255],
               email_lines=[f"Request: {req.reason_label}, {req.start_date:%d %b %Y} to {req.end_date:%d %b %Y}.",
                            f"Comment from {actor.name}: {comment}",
                            "Your classes are not cancelled." if decision == "reject"
                            else "Open the request in FEBEMS, add the information and send it again."])
        db.session.commit()
    return jsonify(_payload(req))
