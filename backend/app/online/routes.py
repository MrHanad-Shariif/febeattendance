"""Online teaching arrangements (RBAC online_teaching) and what lecturers
and students see of them.

  GET  /api/admin/online                 list (?status=)
  GET  /api/admin/online/options         lecturers, classes, batches, courses
  POST /api/admin/online/preview         affected sessions + conflicts, nothing saved
  POST /api/admin/online                 create (start today or later)
  GET  /api/admin/online/<id>            detail with sessions and history
  PUT  /api/admin/online/<id>            change; once started only the end date, link and instructions
  POST /api/admin/online/<id>/end        back to campus from return_date (early end)
  POST /api/admin/online/<id>/cancel     only before it starts
  GET  /api/online/mine                  current and upcoming arrangements for my classes
"""
from datetime import date, timedelta

from flask import jsonify, request

from app.extensions import db
from app.models import OnlineArrangement, Timetable, User
from app.online import online_bp
from app.utils.authz import current_user, permission_required, roles_required
from app.utils.online import (
    Draft, OnlineIndex, affected_sessions, clean_input, current_for_user, find_conflicts, notify_change,
    record_event, snapshot, summarize,
)
from app.utils.validation import ValidationError, clean_text, parse_iso_date


def _conflict_check(draft, exclude_id=None):
    conflicts = find_conflicts(draft, exclude_id)
    if conflicts:
        c = conflicts[0]
        raise ValidationError(
            f"Some of these sessions are already online under another arrangement "
            f"({c.title or 'untitled'}, {c.start_date:%d %b} – {c.effective_end:%d %b %Y}). Change that one instead.",
            status=409)


def _detail(a, today=None):
    today = today or date.today()
    sessions = affected_sessions(a)
    return {**a.to_dict(today), "affected": summarize(sessions),
            "sessions": [{"date": d.isoformat(), "course_name": e.course_name, "batch": e.batch,
                          "time": f"{e.start_time:%H:%M}" + (f"–{e.end_time:%H:%M}" if e.end_time else ""),
                          "lecturer_name": e.lecturer.name if e.lecturer else None} for e, d in sessions[:300]],
            "events": [ev.to_dict() for ev in reversed(a.events)]}


@online_bp.get("/admin/online")
@permission_required("online_teaching:view")
def list_online():
    today = date.today()
    rows = [a.to_dict(today) | {"sessions": len(affected_sessions(a))}
            for a in OnlineArrangement.query.order_by(OnlineArrangement.start_date.desc()).all()]
    status = request.args.get("status")
    if status:
        rows = [r for r in rows if r["status"] == status]
    return jsonify(rows)


@online_bp.get("/admin/online/options")
@permission_required("online_teaching:view")
def online_options():
    entries = Timetable.query.filter(Timetable.start_time.isnot(None)).order_by(Timetable.batch, Timetable.course_name).all()
    return jsonify({
        "lecturers": [{"id": u.id, "name": u.name} for u in User.query.filter_by(role="lecturer").order_by(User.name).all()],
        "classes": [e.to_dict() for e in entries],
        "batches": sorted({e.batch for e in entries if e.batch}),
        "courses": sorted({e.course_name for e in entries if e.course_name}),
    })


@online_bp.post("/admin/online/preview")
@permission_required("online_teaching:add", "online_teaching:edit")
def preview_online():
    data = request.get_json(silent=True) or {}
    existing = OnlineArrangement.query.get_or_404(int(data["id"])) if data.get("id") else None
    fields = clean_input(data, existing)
    draft = Draft(fields, existing.id if existing else None, existing.actual_end_date if existing else None)
    sessions = affected_sessions(draft)
    conflicts = find_conflicts(draft, exclude_id=draft.id)
    return jsonify({**summarize(sessions), "conflicts": [c.to_dict() for c in conflicts]})


@online_bp.post("/admin/online")
@permission_required("online_teaching:add")
def create_online():
    actor = current_user()
    fields = clean_input(request.get_json(silent=True) or {})
    draft = Draft(fields)
    if not affected_sessions(draft):
        raise ValidationError("No timetabled sessions fall in these dates for that choice")
    _conflict_check(draft)
    a = OnlineArrangement(**fields, created_by_id=actor.id, updated_by_id=actor.id)
    db.session.add(a)
    db.session.flush()
    record_event(a, actor, "created", new=snapshot(a))
    db.session.commit()
    OnlineIndex.invalidate()
    notify_change(a, "created")
    db.session.commit()
    return jsonify(_detail(a)), 201


@online_bp.get("/admin/online/<int:arrangement_id>")
@permission_required("online_teaching:view")
def get_online(arrangement_id):
    return jsonify(_detail(OnlineArrangement.query.get_or_404(arrangement_id)))


@online_bp.put("/admin/online/<int:arrangement_id>")
@permission_required("online_teaching:edit")
def update_online(arrangement_id):
    """Change an arrangement. Once it has started, its start and scope are
    fixed (they decided how past sessions were taught); the end date can be
    extended or brought forward to today or later."""
    actor = current_user()
    a = OnlineArrangement.query.get_or_404(arrangement_id)
    if a.state == "cancelled":
        raise ValidationError("A cancelled arrangement cannot be changed. Create a new one.", status=409)
    data = request.get_json(silent=True) or {}
    today = date.today()
    started = a.start_date <= today
    if started:
        locked = [k for k in ("start_date", "lecturer_id", "timetable_ids", "batches", "courses", "days")
                  if k in data and data[k] != (snapshot(a)[k])]
        if locked:
            raise ValidationError("This online period has started, so only its end date, link and instructions can change. "
                                  "End it and create a new one for other classes.", status=409)
    fields = clean_input(data, a)
    if started and fields["end_date"] < today:
        raise ValidationError("To finish an online period before today, use End early.", status=409)
    if not started and fields["start_date"] < today:
        raise ValidationError("Online teaching can start today or later")
    draft = Draft(fields, a.id, None)
    _conflict_check(draft, exclude_id=a.id)
    old = snapshot(a)
    old_sessions = set((e.id, d) for e, d in affected_sessions(a, date_from=today))
    for k, v in fields.items():
        setattr(a, k, v)
    a.actual_end_date = None
    a.state = "recorded"
    a.updated_by_id = actor.id
    new = snapshot(a)
    if new == old:
        return jsonify(_detail(a))
    note = clean_text(data.get("change_note"), "Note", max_len=500)
    action = "extended" if fields["end_date"] > (date.fromisoformat(old["actual_end_date"] or old["end_date"])) else "changed"
    record_event(a, actor, action, old=old, new=new, note=note)
    db.session.commit()
    OnlineIndex.invalidate()
    new_sessions = affected_sessions(a, date_from=today)
    notify_change(a, "updated", new_sessions or None, note)
    if old_sessions - {(e.id, d) for e, d in new_sessions}:
        removed = [(Timetable.query.get(tid), d) for tid, d in sorted(old_sessions - {(e.id, d) for e, d in new_sessions})]
        notify_change(a, "ended", [(e, d) for e, d in removed if e], note)
    db.session.commit()
    return jsonify(_detail(a))


@online_bp.post("/admin/online/<int:arrangement_id>/end")
@permission_required("online_teaching:edit")
def end_online(arrangement_id):
    """Return to campus early: return_date is the first day back on campus."""
    actor = current_user()
    a = OnlineArrangement.query.get_or_404(arrangement_id)
    if a.state == "cancelled":
        raise ValidationError("This arrangement was cancelled", status=409)
    data = request.get_json(silent=True) or {}
    returned = parse_iso_date(data.get("return_date"), "Back-on-campus date") if data.get("return_date") else date.today()
    if returned < date.today():
        raise ValidationError("The return to campus can be today or later; past sessions stay as they were taught")
    if returned <= a.start_date:
        raise ValidationError("It has not started yet on that date: cancel it instead")
    if returned > a.effective_end:
        raise ValidationError("That is after the planned end; classes are back on campus by then anyway")
    old = snapshot(a)
    a.actual_end_date = returned - timedelta(days=1)
    a.state = "ended"
    a.updated_by_id = actor.id
    note = clean_text(data.get("note"), "Note", max_len=500)
    record_event(a, actor, "ended_early", old=old, new=snapshot(a), note=note or f"Back on campus from {returned:%d %b %Y}")
    removed = affected_sessions(Draft({k: getattr(a, k) for k in ("lecturer_id", "timetable_ids", "batches", "courses", "days")}
                                      | {"start_date": returned, "end_date": date.fromisoformat(old["end_date"])}))
    db.session.commit()
    OnlineIndex.invalidate()
    notify_change(a, "ended", removed or None, note)
    db.session.commit()
    return jsonify(_detail(a))


@online_bp.post("/admin/online/<int:arrangement_id>/cancel")
@permission_required("online_teaching:delete")
def cancel_online(arrangement_id):
    actor = current_user()
    a = OnlineArrangement.query.get_or_404(arrangement_id)
    if a.state == "cancelled":
        raise ValidationError("Already cancelled", status=409)
    if a.start_date <= date.today():
        raise ValidationError("This online period has started. Use End early so the sessions already taught online "
                              "stay recorded as online.", status=409)
    data = request.get_json(silent=True) or {}
    reason = clean_text(data.get("reason"), "Reason", max_len=500, required=True)
    sessions = affected_sessions(a)
    old = snapshot(a)
    a.state = "cancelled"
    a.updated_by_id = actor.id
    record_event(a, actor, "cancelled", old=old, new=snapshot(a), note=reason)
    db.session.commit()
    OnlineIndex.invalidate()
    notify_change(a, "cancelled", sessions, reason)
    db.session.commit()
    return jsonify(_detail(a))


@online_bp.get("/online/mine")
@roles_required("lecturer", "student")
def my_online():
    return jsonify(current_for_user(current_user()))
