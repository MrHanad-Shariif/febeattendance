"""Committee reports (brief items 40 and 41) and the Dean's faculty overview.

Every report is returned in one shape -- title, scope, columns, rows, summary
-- which the SPA renders on screen and on the FEBE-branded print page, and
which `?format=csv` turns into a download.

Scope: the Dean and admins can report on every committee; a chairperson on
the committees they chair; anyone on their own tasks (member report).
"""
import csv
import io
from datetime import datetime

from flask import Response, jsonify, request

from app.models import Committee, Meeting, MeetingMinutes, Task, User, utcnow
from app.reports import reports_bp
from app.utils.authz import current_user, roles_required
from app.utils.permissions import can_view_all_committees, officer_committee_ids, require
from app.utils.validation import ValidationError, clean_int, parse_iso_date

STAFF_ROLES = ("admin", "lecturer")

REPORT_TYPES = {
    "committee_tasks": "Committee Task Report",
    "member_tasks": "Member Task Report",
    "overdue": "Overdue Task Report",
    "completed": "Completed Task Report",
    "committee_activity": "Committee Activity Report",
    "faculty_overview": "Faculty Committee Overview",
}

TASK_COLUMNS = [
    ("title", "Task"),
    ("committee_name", "Committee"),
    ("assigned_to_name", "Assigned to"),
    ("assigned_by_name", "Assigned by"),
    ("assigned_at", "Date assigned"),
    ("deadline", "Deadline"),
    ("priority", "Priority"),
    ("status_label", "Status"),
    ("completed_at", "Completed"),
]

ACTIVITY_COLUMNS = [
    ("name", "Committee / unit"),
    ("kind_label", "Type"),
    ("chairperson_name", "Chairperson"),
    ("secretary_name", "Secretary"),
    ("member_count", "Members"),
    ("task_total", "Tasks"),
    ("task_completed", "Completed"),
    ("task_pending", "Pending"),
    ("task_overdue", "Overdue"),
    ("meetings_held", "Meetings held"),
    ("upcoming_meetings", "Upcoming meetings"),
    ("minutes_published", "Minutes published"),
]


def _allowed_committees(user: User) -> list[Committee] | None:
    """None = every committee."""
    if can_view_all_committees(user):
        return None
    ids = officer_committee_ids(user)
    return Committee.query.filter(Committee.id.in_(ids or [-1])).all()


def _fmt(value):
    if isinstance(value, str) and len(value) >= 16 and value[4] == "-" and "T" in value:
        return datetime.fromisoformat(value).strftime("%Y-%m-%d %H:%M")
    return value


def _task_rows(tasks):
    rows = []
    for t in tasks:
        d = t.to_dict()
        rows.append({key: _fmt(d.get(key)) for key, _ in TASK_COLUMNS})
    return rows


def _activity_row(c: Committee, now) -> dict:
    tasks = Task.query.filter_by(committee_id=c.id)
    total = tasks.count()
    completed = tasks.filter(Task.status == "completed").count()
    return {
        "committee_id": c.id,
        "name": c.name,
        "kind_label": Committee.KIND_LABELS.get(c.kind, c.kind),
        "chairperson_name": c.chairperson.name if c.chairperson else "—",
        "secretary_name": c.secretary.user.name if c.secretary and c.secretary.user else "—",
        "member_count": len(c.memberships),
        "task_total": total,
        "task_completed": completed,
        "task_pending": total - completed,
        "task_overdue": tasks.filter(Task.status != "completed", Task.deadline.isnot(None), Task.deadline < now).count(),
        "meetings_held": Meeting.query.filter(
            Meeting.committee_id == c.id,
            (Meeting.status == "held") | ((Meeting.status == "scheduled") & (Meeting.date < now.date())),
        ).count(),
        "upcoming_meetings": Meeting.query.filter(
            Meeting.committee_id == c.id, Meeting.status == "scheduled", Meeting.date >= now.date()
        ).count(),
        "minutes_published": MeetingMinutes.query.filter_by(committee_id=c.id).count(),
    }


def _build_report(user: User, report_type: str) -> dict:
    if report_type not in REPORT_TYPES:
        raise ValidationError("Unknown report type", status=404)
    args = request.args
    now = utcnow()
    allowed = _allowed_committees(user)
    allowed_ids = None if allowed is None else {c.id for c in allowed}

    committee = None
    if args.get("committee_id"):
        committee = Committee.query.get_or_404(clean_int(args["committee_id"], "committee_id", minimum=1))

    def check_committee_scope():
        if committee is not None:
            require(allowed_ids is None or committee.id in allowed_ids,
                    "You can only run reports for committees you chair or are secretary of.")

    query = Task.query
    scope = "All committees" if allowed_ids is None else "Committees you chair or are secretary of"
    summary = []

    if report_type == "faculty_overview":
        require(can_view_all_committees(user), "The faculty overview is for the Dean and administrators.")
        rows = [_activity_row(c, now) for c in Committee.query.filter_by(status="active").order_by(Committee.name)]
        totals = {k: sum(r[k] for r in rows) for k in ("task_total", "task_completed", "task_pending", "task_overdue",
                                                        "meetings_held", "upcoming_meetings", "minutes_published")}
        summary = [
            {"label": "Committees", "value": len(rows)},
            {"label": "Tasks", "value": totals["task_total"]},
            {"label": "Completed", "value": totals["task_completed"]},
            {"label": "Overdue", "value": totals["task_overdue"]},
            {"label": "Meetings held", "value": totals["meetings_held"]},
            {"label": "Upcoming meetings", "value": totals["upcoming_meetings"]},
        ]
        return _report(report_type, "All faculty committees", ACTIVITY_COLUMNS, rows, summary, now)

    if report_type == "committee_activity":
        check_committee_scope()
        committees = [committee] if committee else (allowed if allowed is not None else Committee.query.all())
        rows = [_activity_row(c, now) for c in sorted(committees, key=lambda c: c.name)]
        return _report(report_type, committee.name if committee else scope, ACTIVITY_COLUMNS, rows, [], now)

    if report_type == "committee_tasks":
        if committee is None:
            raise ValidationError("Choose a committee")
        check_committee_scope()
        query = query.filter(Task.committee_id == committee.id)
        scope = committee.name
    elif report_type == "member_tasks":
        member = User.query.get_or_404(clean_int(args.get("member_id"), "member_id", minimum=1) or 0)
        query = query.filter(Task.assigned_to_id == member.id)
        if member.id != user.id and allowed_ids is not None:
            query = query.filter(Task.committee_id.in_(allowed_ids or [-1]))
        if committee:
            if member.id != user.id:
                check_committee_scope()
            query = query.filter(Task.committee_id == committee.id)
        scope = f"{member.name}" + (f" — {committee.name}" if committee else "")
    else:
        check_committee_scope()
        if committee:
            query = query.filter(Task.committee_id == committee.id)
            scope = committee.name
        elif allowed_ids is not None:
            query = query.filter(Task.committee_id.in_(allowed_ids or [-1]))
        if report_type == "overdue":
            query = query.filter(Task.status != "completed", Task.deadline.isnot(None), Task.deadline < now)
        else:  # completed
            query = query.filter(Task.status == "completed")
            if args.get("from"):
                query = query.filter(Task.completed_at >= parse_iso_date(args["from"], "from"))
            if args.get("to"):
                end = parse_iso_date(args["to"], "to")
                query = query.filter(Task.completed_at < datetime.combine(end, datetime.max.time()))

    tasks = query.order_by(Task.deadline.is_(None), Task.deadline, Task.id).all()
    completed = sum(1 for t in tasks if t.status == "completed")
    overdue = sum(1 for t in tasks if t.is_overdue(now))
    summary = [
        {"label": "Tasks", "value": len(tasks)},
        {"label": "Completed", "value": completed},
        {"label": "Pending", "value": len(tasks) - completed},
        {"label": "Overdue", "value": overdue},
    ]
    return _report(report_type, scope, TASK_COLUMNS, _task_rows(tasks), summary, now)


def _report(report_type, scope, columns, rows, summary, now) -> dict:
    return {
        "type": report_type,
        "title": REPORT_TYPES[report_type],
        "scope": scope,
        "generated_at": now.isoformat(),
        "columns": [{"key": k, "label": label} for k, label in columns],
        "rows": rows,
        "summary": summary,
    }


@reports_bp.get("/reports/<report_type>")
@roles_required(*STAFF_ROLES)
def get_report(report_type):
    report = _build_report(current_user(), report_type)
    if request.args.get("format") != "csv":
        return jsonify(report)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["FEBEMS - Faculty of Engineering and Built Environment Management System"])
    writer.writerow([report["title"], report["scope"], f"Generated {report['generated_at'][:16].replace('T', ' ')}"])
    writer.writerow([])
    writer.writerow([c["label"] for c in report["columns"]])
    for row in report["rows"]:
        writer.writerow([row.get(c["key"], "") if row.get(c["key"]) is not None else "" for c in report["columns"]])
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={report_type}-{report['generated_at'][:10]}.csv"},
    )


@reports_bp.get("/reports")
@roles_required(*STAFF_ROLES)
def report_options():
    """Which reports and committees the current user may run (for the UI)."""
    user = current_user()
    allowed = _allowed_committees(user)
    committees = Committee.query.order_by(Committee.name).all() if allowed is None else allowed
    types = ["member_tasks"]
    if committees:
        types = ["committee_tasks", "member_tasks", "overdue", "completed", "committee_activity"]
    if can_view_all_committees(user):
        types.append("faculty_overview")
    members = {}
    for c in committees:
        for m in c.memberships:
            members[m.user_id] = m.user.name
    if not committees:
        members = {user.id: user.name}
    return jsonify({
        "types": [{"value": t, "label": REPORT_TYPES[t]} for t in types],
        "committees": [{"id": c.id, "name": c.name} for c in committees],
        "members": [{"id": k, "name": v} for k, v in sorted(members.items(), key=lambda kv: kv[1].lower())],
    })


@reports_bp.get("/faculty/overview")
@roles_required(*STAFF_ROLES)
def faculty_overview():
    """The Dean's faculty-level dashboard."""
    user = current_user()
    require(can_view_all_committees(user), "The faculty overview is for the Dean and administrators.")
    now = utcnow()
    committees = [_activity_row(c, now) for c in Committee.query.filter_by(status="active").order_by(Committee.name)]
    upcoming = (
        Meeting.query.filter(Meeting.status == "scheduled", Meeting.date >= now.date())
        .order_by(Meeting.date, Meeting.start_time).limit(8).all()
    )
    recent_minutes = MeetingMinutes.query.order_by(MeetingMinutes.published_at.desc()).limit(6).all()
    overdue = (
        Task.query.filter(Task.status != "completed", Task.deadline.isnot(None), Task.deadline < now)
        .order_by(Task.deadline).limit(10).all()
    )
    return jsonify({
        "totals": {
            "committees": len(committees),
            "tasks": sum(c["task_total"] for c in committees),
            "completed": sum(c["task_completed"] for c in committees),
            "pending": sum(c["task_pending"] for c in committees),
            "overdue": sum(c["task_overdue"] for c in committees),
            "upcoming_meetings": sum(c["upcoming_meetings"] for c in committees),
        },
        "committees": committees,
        "upcoming_meetings": [m.to_dict() for m in upcoming],
        "recent_minutes": [m.to_dict() for m in recent_minutes],
        "overdue_tasks": [t.to_dict() for t in overdue],
    })
