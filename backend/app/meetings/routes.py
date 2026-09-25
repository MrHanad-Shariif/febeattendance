"""Meetings (scheduling, agendas) and the meeting-minutes archive.

Workflow (brief item 29): a chairperson schedules a meeting -> members are
notified -> after the meeting an Administration Team member uploads the
final minutes -> the release date is recorded -> the minutes join the
permanent archive and an Information Sharing post + notifications/emails go
out (item 28).
"""
from flask import jsonify, request

from app.extensions import db
from app.meetings import meetings_bp
from app.models import Committee, InformationPost, Meeting, MeetingMinutes, utcnow
from app.utils.audiences import audience_users, committee_users
from app.utils.authz import current_user, roles_required
from app.utils.notify import notify, subject_for
from app.utils.permissions import (
    can_publish_minutes, can_schedule_meeting, can_share_information, can_view_committee, can_view_minutes,
    is_admin_team, require, visible_committee_ids,
)
from app.utils.uploads import delete_document, save_document, send_document
from app.utils.validation import (
    ValidationError, clean_choice, clean_int, clean_text, parse_hhmm, parse_iso_date,
)

STAFF_ROLES = ("admin", "lecturer")


def _payload():
    """Meetings and minutes accept JSON or multipart (when a document is attached)."""
    if request.files or request.form:
        return request.form
    return request.get_json(silent=True) or {}


def _when_text(meeting: Meeting) -> str:
    text = f"{meeting.date:%A %d %B %Y}"
    if meeting.start_time:
        text += f", {meeting.start_time:%H:%M}"
        if meeting.end_time:
            text += f"–{meeting.end_time:%H:%M}"
    return text


def _notify_members(meeting: Meeting, actor, subject_key: str, heading: str):
    notify(
        committee_users(meeting.committee),
        type="meeting",
        title=f"{heading}: {meeting.title}",
        message=f"{meeting.committee.name}. {_when_text(meeting)}" + (f" at {meeting.location}" if meeting.location else ""),
        link=f"/meetings/{meeting.id}",
        related_id=meeting.id,
        email_subject=subject_for(subject_key, meeting.title),
        email_lines=[
            f"Committee: {meeting.committee.name}",
            f"Meeting: {meeting.title}",
            f"When: {_when_text(meeting)}",
            f"Where: {meeting.location}" if meeting.location else "",
            f"Agenda: {meeting.agenda}" if meeting.agenda else "",
            f"Scheduled by: {actor.name}",
        ],
        exclude=actor,
    )


def _apply_meeting_fields(meeting: Meeting, data, *, creating: bool):
    if creating or "title" in data:
        meeting.title = clean_text(data.get("title"), "Title", max_len=255, required=True)
    if creating or "date" in data:
        meeting.date = parse_iso_date(data.get("date"), "Date")
    if creating or "start_time" in data:
        meeting.start_time = parse_hhmm(data.get("start_time"), "Start time")
    if creating or "end_time" in data:
        meeting.end_time = parse_hhmm(data.get("end_time"), "End time")
    if meeting.start_time and meeting.end_time and meeting.end_time <= meeting.start_time:
        raise ValidationError("End time must be after the start time")
    if creating or "location" in data:
        meeting.location = clean_text(data.get("location"), "Location", max_len=255)
    if creating or "agenda" in data:
        meeting.agenda = clean_text(data.get("agenda"), "Agenda", max_len=20000)
    saved = save_document(request.files.get("agenda_file"), "agendas")
    if saved:
        delete_document(meeting.agenda_file_path)
        meeting.agenda_file_name, meeting.agenda_file_path = saved


def _meeting_filters(query):
    args = request.args
    if args.get("committee_id"):
        query = query.filter(Meeting.committee_id == clean_int(args["committee_id"], "committee_id"))
    if args.get("status"):
        query = query.filter(Meeting.status == args["status"])
    if args.get("kind"):
        query = query.join(Committee).filter(Committee.kind == args["kind"])
    if args.get("from"):
        query = query.filter(Meeting.date >= parse_iso_date(args["from"], "from"))
    if args.get("to"):
        query = query.filter(Meeting.date <= parse_iso_date(args["to"], "to"))
    if args.get("when") == "upcoming":
        query = query.filter(Meeting.date >= utcnow().date(), Meeting.status == "scheduled")
    elif args.get("when") == "past":
        query = query.filter(Meeting.date < utcnow().date())
    return query


def _meeting_dict(meeting: Meeting, user) -> dict:
    data = meeting.to_dict()
    data["can_edit"] = can_schedule_meeting(user, meeting.committee)
    return data


# ---------- Meetings ----------

@meetings_bp.get("/meetings")
@roles_required(*STAFF_ROLES)
def list_meetings():
    user = current_user()
    ids = visible_committee_ids(user)
    query = Meeting.query
    if ids is not None:
        query = query.filter(Meeting.committee_id.in_(ids or [-1]))
    meetings = _meeting_filters(query).order_by(Meeting.date.desc(), Meeting.start_time.desc()).all()
    return jsonify([_meeting_dict(m, user) for m in meetings])


@meetings_bp.get("/meetings/<int:meeting_id>")
@roles_required(*STAFF_ROLES)
def get_meeting(meeting_id):
    user = current_user()
    meeting = Meeting.query.get_or_404(meeting_id)
    require(can_view_committee(user, meeting.committee) or is_admin_team(user))
    return jsonify(_meeting_dict(meeting, user))


@meetings_bp.post("/committees/<int:committee_id>/meetings")
@roles_required(*STAFF_ROLES)
def schedule_meeting(committee_id):
    user = current_user()
    committee = Committee.query.get_or_404(committee_id)
    require(can_schedule_meeting(user, committee), "Only this committee's chairperson can schedule its meetings.")
    meeting = Meeting(committee=committee, created_by_id=user.id, status="scheduled")
    _apply_meeting_fields(meeting, _payload(), creating=True)
    db.session.add(meeting)
    db.session.flush()
    _notify_members(meeting, user, "meeting_scheduled", "Meeting scheduled")
    db.session.commit()
    return jsonify(_meeting_dict(meeting, user)), 201


@meetings_bp.put("/meetings/<int:meeting_id>")
@roles_required(*STAFF_ROLES)
def update_meeting(meeting_id):
    user = current_user()
    meeting = Meeting.query.get_or_404(meeting_id)
    require(can_schedule_meeting(user, meeting.committee))
    data = _payload()
    _apply_meeting_fields(meeting, data, creating=False)
    if "status" in data:
        meeting.status = clean_choice(data.get("status"), "Status", Meeting.STATUSES)
    notify_members = str(data.get("notify", "true")).lower() != "false"
    if notify_members:
        key, heading = (
            ("meeting_cancelled", "Meeting cancelled") if meeting.status == "cancelled"
            else ("meeting_updated", "Meeting updated")
        )
        _notify_members(meeting, user, key, heading)
    db.session.commit()
    return jsonify(_meeting_dict(meeting, user))


@meetings_bp.get("/meetings/<int:meeting_id>/agenda")
@roles_required(*STAFF_ROLES)
def download_agenda(meeting_id):
    user = current_user()
    meeting = Meeting.query.get_or_404(meeting_id)
    require(can_view_committee(user, meeting.committee) or is_admin_team(user))
    if not meeting.agenda_file_path:
        return jsonify({"error": "Not found"}), 404
    return send_document(meeting.agenda_file_path, meeting.agenda_file_name, inline=request.args.get("inline") == "1")


# ---------- Committees a publisher can choose from ----------

@meetings_bp.get("/committees/options")
@roles_required(*STAFF_ROLES)
def committee_options():
    """Minimal committee list for people who publish minutes or notices
    (Administration Team members need every committee, not only their own)."""
    user = current_user()
    ids = visible_committee_ids(user)
    query = Committee.query.filter_by(status="active")
    if ids is not None and not (can_share_information(user) or can_publish_minutes(user, None)):
        query = query.filter(Committee.id.in_(ids or [-1]))
    return jsonify([
        {"id": c.id, "name": c.name, "kind": c.kind, "kind_label": Committee.KIND_LABELS[c.kind]}
        for c in query.order_by(Committee.kind.desc(), Committee.name)
    ])


@meetings_bp.get("/minutes/pending-meetings")
@roles_required(*STAFF_ROLES)
def meetings_awaiting_minutes():
    user = current_user()
    require(can_publish_minutes(user, None))
    meetings = (
        Meeting.query.outerjoin(MeetingMinutes, MeetingMinutes.meeting_id == Meeting.id)
        .filter(MeetingMinutes.id.is_(None), Meeting.status != "cancelled", Meeting.date <= utcnow().date())
        .order_by(Meeting.date.desc())
        .all()
    )
    return jsonify([m.to_dict() for m in meetings])


# ---------- Minutes archive ----------

@meetings_bp.post("/minutes")
@roles_required(*STAFF_ROLES)
def publish_minutes():
    user = current_user()
    data = _payload()
    meeting = None
    if data.get("meeting_id"):
        meeting = Meeting.query.get_or_404(clean_int(data.get("meeting_id"), "Meeting", minimum=1))
        committee = meeting.committee
        if meeting.minutes:
            return jsonify({"error": "Minutes for this meeting are already published"}), 409
    else:
        committee = Committee.query.get_or_404(clean_int(data.get("committee_id"), "Committee", minimum=1) or 0)
    require(can_publish_minutes(user, committee), "Only authorised Administration Team members can publish minutes.")

    title = clean_text(data.get("title"), "Title", max_len=255) or (meeting.title if meeting else None)
    if not title:
        raise ValidationError("Title is required")
    meeting_date = parse_iso_date(data.get("meeting_date"), "Meeting date") if data.get("meeting_date") else (
        meeting.date if meeting else None
    )
    if not meeting_date:
        raise ValidationError("Meeting date is required")
    visibility = clean_choice(data.get("visibility"), "Visibility", MeetingMinutes.VISIBILITIES, default="committee")
    summary = clean_text(data.get("summary"), "Summary", max_len=20000)
    saved = save_document(request.files.get("file"), "minutes")
    if not saved:
        raise ValidationError("Attach the finalised minutes document")

    now = utcnow()
    minutes = MeetingMinutes(
        meeting=meeting, committee=committee, title=title, meeting_date=meeting_date, summary=summary,
        file_name=saved[0], file_path=saved[1], visibility=visibility, uploaded_by_id=user.id, published_at=now,
    )
    db.session.add(minutes)
    if meeting and meeting.status == "scheduled":
        meeting.status = "held"

    # Information Sharing = the notification/distribution side of the same record.
    audience = "all_staff" if visibility == "faculty" else "committee"
    post = InformationPost(
        title=title,
        description=summary or f"Official minutes of {committee.name}, meeting of {meeting_date:%d %B %Y}.",
        category="meeting_minutes",
        audience=audience,
        committee=committee,
        minutes=minutes,
        published_by_id=user.id,
        published_at=now,
    )
    db.session.add(post)
    db.session.flush()

    notify(
        audience_users(audience, committee),
        type="minutes",
        title=f"Meeting minutes published: {title}",
        message=f"{committee.name}, meeting of {meeting_date:%d %b %Y}.",
        link=f"/meeting-minutes/{minutes.id}",
        related_id=minutes.id,
        email_subject=subject_for("minutes_published", title),
        email_lines=[
            f"The official minutes of {committee.name} have been published.",
            f"Meeting: {title}",
            f"Meeting date: {meeting_date:%d %B %Y}",
            f"Released: {now:%d %B %Y %H:%M}",
            summary or "",
        ],
    )
    db.session.commit()
    return jsonify(minutes.to_dict()), 201


@meetings_bp.get("/minutes")
@roles_required(*STAFF_ROLES)
def list_minutes():
    """Archive search (brief items 26 and 39): committee, administrative unit
    (kind), meeting date range, release date range, year, keyword."""
    user = current_user()
    args = request.args
    query = MeetingMinutes.query.join(Committee)
    ids = visible_committee_ids(user)
    if ids is not None and not can_publish_minutes(user, None):
        query = query.filter((MeetingMinutes.visibility == "faculty") | MeetingMinutes.committee_id.in_(ids or [-1]))
    if args.get("committee_id"):
        query = query.filter(MeetingMinutes.committee_id == clean_int(args["committee_id"], "committee_id"))
    if args.get("kind"):
        query = query.filter(Committee.kind == args["kind"])
    if args.get("from"):
        query = query.filter(MeetingMinutes.meeting_date >= parse_iso_date(args["from"], "from"))
    if args.get("to"):
        query = query.filter(MeetingMinutes.meeting_date <= parse_iso_date(args["to"], "to"))
    if args.get("released_from"):
        query = query.filter(MeetingMinutes.published_at >= parse_iso_date(args["released_from"], "released_from"))
    if args.get("released_to"):
        end = parse_iso_date(args["released_to"], "released_to")
        query = query.filter(db.func.date(MeetingMinutes.published_at) <= end)
    rows = query.order_by(MeetingMinutes.meeting_date.desc()).all()
    if args.get("year"):
        year = clean_int(args["year"], "year", minimum=1900, maximum=3000)
        rows = [m for m in rows if m.meeting_date.year == year]
    if args.get("q"):
        needle = args["q"].strip().lower()[:100]
        rows = [m for m in rows if needle in f"{m.title} {m.summary or ''} {m.committee.name}".lower()]
    return jsonify([m.to_dict() for m in rows])


@meetings_bp.get("/minutes/<int:minutes_id>")
@roles_required(*STAFF_ROLES)
def get_minutes(minutes_id):
    user = current_user()
    minutes = MeetingMinutes.query.get_or_404(minutes_id)
    require(can_view_minutes(user, minutes))
    data = minutes.to_dict()
    data["meeting"] = minutes.meeting.to_dict() if minutes.meeting else None
    return jsonify(data)


@meetings_bp.get("/minutes/<int:minutes_id>/document")
@roles_required(*STAFF_ROLES)
def download_minutes(minutes_id):
    user = current_user()
    minutes = MeetingMinutes.query.get_or_404(minutes_id)
    require(can_view_minutes(user, minutes))
    return send_document(minutes.file_path, minutes.file_name, inline=request.args.get("inline") == "1")
