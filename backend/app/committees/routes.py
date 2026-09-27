"""Committees, memberships, faculty roles and committee tasks.

Committee setup (create/edit, chairperson, secretary, members, faculty roles)
is for system admins only. Task management is for the committee's chairperson
and secretary (see utils/permissions.py). Every route below loads the record it acts on and
checks permission against *that* record's committee.
"""
from datetime import timedelta

from flask import jsonify, request
from sqlalchemy import func

from app.committees import committees_bp
from app.extensions import db
from app.models import (
    ArchiveDocument, Committee, CommitteeMember, FacultyRole, Meeting, MeetingMinutes, Task, TaskAttachment, User, utcnow,
)
from app.utils.authz import current_user, permission_required, roles_required
from app.utils.notify import notify, subject_for
from app.utils.permissions import (
    can_manage_tasks, can_schedule_meeting, can_view_all_committees, can_view_archive, can_view_committee, can_view_reports,
    can_view_task, can_work_on_task, is_admin, is_chair, membership, officer_committee_ids, require,
)
from app.utils.archive import file_task_report
from app.utils.task_audit import record_event
from app.utils.uploads import save_document, send_document
from app.utils.validation import ValidationError, clean_choice, clean_int, clean_text, parse_deadline

STAFF_ROLES = ("admin", "lecturer")


def _staff_user(user_id, field="User") -> User:
    uid = clean_int(user_id, field, minimum=1)
    if uid is None:
        raise ValidationError(f"{field} is required")
    user = User.query.filter(User.id == uid, User.role.in_(STAFF_ROLES)).first()
    if not user:
        raise ValidationError(f"{field} must be an existing lecturer or staff account")
    return user


def _committee_or_404(committee_id) -> Committee:
    return Committee.query.get_or_404(committee_id)


def _task_or_404(task_id) -> Task:
    return Task.query.get_or_404(task_id)


def _committee_counts(committee: Committee, now) -> dict:
    tasks = Task.query.filter_by(committee_id=committee.id)
    total = tasks.count()
    completed = tasks.filter(Task.status == "completed").count()
    overdue = tasks.filter(Task.status != "completed", Task.deadline.isnot(None), Task.deadline < now).count()
    upcoming = Meeting.query.filter(
        Meeting.committee_id == committee.id, Meeting.status == "scheduled", Meeting.date >= now.date()
    ).count()
    return {
        "task_total": total,
        "task_completed": completed,
        "task_pending": total - completed,
        "task_overdue": overdue,
        "upcoming_meetings": upcoming,
    }


def _committee_payload(committee: Committee, user: User, now, detail=False) -> dict:
    mine = membership(user, committee)
    data = committee.to_dict(_committee_counts(committee, now))
    data.update({
        "my_role": mine.role if mine else None,
        "can_manage_tasks": can_manage_tasks(user, committee),
        "can_schedule_meeting": can_schedule_meeting(user, committee),
        "can_view_reports": can_view_reports(user, committee),
        "can_view_archive": can_view_archive(user, committee),
        "can_edit": is_admin(user),
    })
    if detail:
        data["members"] = sorted(
            (m.to_dict() for m in committee.memberships),
            key=lambda m: ({"chairperson": 0, "secretary": 1}.get(m["role"], 2), (m["name"] or "").lower()),
        )
    return data


def _set_chairperson(committee: Committee, user: User | None):
    """Keep committees.chairperson_id and the chairperson membership row in step."""
    for m in committee.memberships:
        if m.role == "chairperson" and (user is None or m.user_id != user.id):
            m.role = "member"
    committee.chairperson_id = user.id if user else None
    if user is None:
        return
    existing = next((m for m in committee.memberships if m.user_id == user.id), None)
    if existing:
        existing.role = "chairperson"
    else:
        committee.memberships.append(CommitteeMember(user_id=user.id, role="chairperson"))


def _set_secretary(committee: Committee, user: User | None):
    """One secretary per committee. The chairperson can't also be secretary."""
    if user is not None and committee.chairperson_id == user.id:
        raise ValidationError(f"{user.name} is the chairperson; choose someone else as secretary")
    for m in committee.memberships:
        if m.role == "secretary" and (user is None or m.user_id != user.id):
            m.role = "member"
    if user is None:
        return
    existing = next((m for m in committee.memberships if m.user_id == user.id), None)
    if existing:
        existing.role = "secretary"
    else:
        committee.memberships.append(CommitteeMember(user_id=user.id, role="secretary"))


# ---------- Staff directory (for pickers) ----------

@committees_bp.get("/staff")
@roles_required(*STAFF_ROLES)
def list_staff():
    """Existing lecturer/staff accounts, so no-one retypes a name or email."""
    require(is_admin(current_user()) or can_view_all_committees(current_user()))
    users = User.query.filter(User.role.in_(STAFF_ROLES), User.status != "disabled").order_by(User.name).all()
    return jsonify([
        {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "status": u.status} for u in users
    ])


# ---------- Faculty roles (Dean, Administration Team) ----------

@committees_bp.get("/faculty-roles")
@permission_required("faculty_roles:view")
def list_faculty_roles():
    rows = FacultyRole.query.join(User, FacultyRole.user_id == User.id).order_by(FacultyRole.role, User.name).all()
    return jsonify([r.to_dict() for r in rows])


@committees_bp.post("/faculty-roles")
@permission_required("faculty_roles:edit")
def grant_faculty_role():
    data = request.get_json(silent=True) or {}
    user = _staff_user(data.get("user_id"))
    role = clean_choice(data.get("role"), "Role", FacultyRole.ROLES)
    if FacultyRole.query.filter_by(user_id=user.id, role=role).first():
        return jsonify({"error": f"{user.name} already has that role"}), 409
    row = FacultyRole(user_id=user.id, role=role, granted_by_id=current_user().id)
    db.session.add(row)
    db.session.commit()
    return jsonify(row.to_dict()), 201


@committees_bp.delete("/faculty-roles/<int:role_id>")
@permission_required("faculty_roles:edit")
def revoke_faculty_role(role_id):
    row = FacultyRole.query.get_or_404(role_id)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"message": "Role removed"})


# ---------- Committees ----------

@committees_bp.get("/committees")
@roles_required(*STAFF_ROLES)
def list_committees():
    """scope=mine (default): committees I belong to. scope=all: every
    committee, for the Dean and admins only."""
    user = current_user()
    now = utcnow()
    scope = request.args.get("scope", "mine")
    if scope == "all":
        require(can_view_all_committees(user))
        committees = Committee.query.order_by(Committee.kind.desc(), Committee.name).all()
    else:
        committees = (
            Committee.query.join(CommitteeMember)
            .filter(CommitteeMember.user_id == user.id)
            .order_by(Committee.kind.desc(), Committee.name)
            .all()
        )
    kind = request.args.get("kind")
    if kind:
        committees = [c for c in committees if c.kind == kind]
    return jsonify([_committee_payload(c, user, now) for c in committees])


@committees_bp.get("/committees/<int:committee_id>")
@roles_required(*STAFF_ROLES)
def get_committee(committee_id):
    user = current_user()
    committee = _committee_or_404(committee_id)
    require(can_view_committee(user, committee))
    return jsonify(_committee_payload(committee, user, utcnow(), detail=True))


@committees_bp.post("/committees")
@permission_required("committees:add")
def create_committee():
    data = request.get_json(silent=True) or {}
    name = clean_text(data.get("name"), "Name", max_len=200, required=True)
    if Committee.query.filter(func.lower(Committee.name) == name.lower()).first():
        return jsonify({"error": "A committee with that name already exists"}), 409
    committee = Committee(
        name=name,
        description=clean_text(data.get("description"), "Description", max_len=5000),
        scope_of_work=clean_text(data.get("scope_of_work"), "Scope of work", max_len=20000),
        kind=clean_choice(data.get("kind"), "Type", Committee.KINDS, default="committee"),
    )
    db.session.add(committee)
    for uid in data.get("member_ids") or []:
        member = _staff_user(uid, "Member")
        if not any(m.user_id == member.id for m in committee.memberships):
            committee.memberships.append(CommitteeMember(user_id=member.id, role="member"))
    if data.get("chairperson_id"):
        _set_chairperson(committee, _staff_user(data.get("chairperson_id"), "Chairperson"))
    if data.get("secretary_id"):
        _set_secretary(committee, _staff_user(data.get("secretary_id"), "Secretary"))
    db.session.commit()
    return jsonify(_committee_payload(committee, current_user(), utcnow(), detail=True)), 201


@committees_bp.put("/committees/<int:committee_id>")
@permission_required("committees:edit")
def update_committee(committee_id):
    committee = _committee_or_404(committee_id)
    data = request.get_json(silent=True) or {}
    if "name" in data:
        name = clean_text(data.get("name"), "Name", max_len=200, required=True)
        clash = Committee.query.filter(func.lower(Committee.name) == name.lower(), Committee.id != committee.id).first()
        if clash:
            return jsonify({"error": "A committee with that name already exists"}), 409
        committee.name = name
    if "description" in data:
        committee.description = clean_text(data.get("description"), "Description", max_len=5000)
    if "scope_of_work" in data:
        committee.scope_of_work = clean_text(data.get("scope_of_work"), "Scope of work", max_len=20000)
    if "kind" in data:
        committee.kind = clean_choice(data.get("kind"), "Type", Committee.KINDS)
    if "status" in data:
        committee.status = clean_choice(data.get("status"), "Status", ("active", "archived"))
    if "chairperson_id" in data:
        chair = _staff_user(data["chairperson_id"], "Chairperson") if data["chairperson_id"] else None
        if chair and committee.secretary and committee.secretary.user_id == chair.id:
            committee.secretary.role = "member"  # promoted from secretary to chair
        _set_chairperson(committee, chair)
    if "secretary_id" in data:
        secretary = _staff_user(data["secretary_id"], "Secretary") if data["secretary_id"] else None
        _set_secretary(committee, secretary)
    db.session.commit()
    return jsonify(_committee_payload(committee, current_user(), utcnow(), detail=True))


@committees_bp.delete("/committees/<int:committee_id>")
@permission_required("committees:delete")
def delete_committee(committee_id):
    committee = _committee_or_404(committee_id)
    has_records = (
        Task.query.filter_by(committee_id=committee.id).first()
        or Meeting.query.filter_by(committee_id=committee.id).first()
        or MeetingMinutes.query.filter_by(committee_id=committee.id).first()
    )
    if has_records:
        return jsonify({"error": "This committee has tasks, meetings or minutes on record. Archive it instead."}), 409
    db.session.delete(committee)
    db.session.commit()
    return jsonify({"message": "Committee deleted"})


@committees_bp.post("/committees/<int:committee_id>/members")
@permission_required("committees:edit")
def add_member(committee_id):
    committee = _committee_or_404(committee_id)
    data = request.get_json(silent=True) or {}
    user = _staff_user(data.get("user_id"), "Member")
    role = clean_choice(data.get("role"), "Role", CommitteeMember.ROLES, default="member")
    if role == "chairperson":
        _set_chairperson(committee, user)
    elif role == "secretary":
        _set_secretary(committee, user)
    elif any(m.user_id == user.id for m in committee.memberships):
        return jsonify({"error": f"{user.name} is already a member"}), 409
    else:
        committee.memberships.append(CommitteeMember(user_id=user.id, role="member"))
    db.session.commit()
    return jsonify(_committee_payload(committee, current_user(), utcnow(), detail=True)), 201


@committees_bp.delete("/committees/<int:committee_id>/members/<int:user_id>")
@permission_required("committees:edit")
def remove_member(committee_id, user_id):
    committee = _committee_or_404(committee_id)
    row = CommitteeMember.query.filter_by(committee_id=committee.id, user_id=user_id).first_or_404()
    if row.role == "chairperson":
        committee.chairperson_id = None
    db.session.delete(row)
    db.session.commit()
    return jsonify({"message": "Member removed"})


# ---------- Tasks ----------

def _task_query_filters(query):
    """Shared filters from the query string (brief item 39)."""
    args = request.args
    if args.get("status") == "overdue":
        query = query.filter(Task.status != "completed", Task.deadline.isnot(None), Task.deadline < utcnow())
    elif args.get("status"):
        query = query.filter(Task.status == args["status"])
    if args.get("assigned_to"):
        query = query.filter(Task.assigned_to_id == clean_int(args["assigned_to"], "assigned_to"))
    if args.get("committee_id"):
        query = query.filter(Task.committee_id == clean_int(args["committee_id"], "committee_id"))
    if args.get("q"):
        like = f"%{args['q'].strip()[:100]}%"
        query = query.filter(Task.title.ilike(like) | Task.description.ilike(like))
    return query


@committees_bp.get("/committees/<int:committee_id>/tasks")
@roles_required(*STAFF_ROLES)
def list_committee_tasks(committee_id):
    """Chairperson / Dean / admin see every task; other members see their own."""
    user = current_user()
    committee = _committee_or_404(committee_id)
    require(can_view_committee(user, committee))
    query = Task.query.filter_by(committee_id=committee.id)
    if not (can_view_all_committees(user) or is_chair(user, committee) or can_manage_tasks(user, committee)):
        query = query.filter(Task.assigned_to_id == user.id)
    tasks = _task_query_filters(query).order_by(Task.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tasks])


@committees_bp.get("/tasks")
@roles_required(*STAFF_ROLES)
def my_tasks():
    """Tasks assigned to me, across every committee. scope=managed returns
    the tasks of every committee I chair (Task Monitoring)."""
    user = current_user()
    if request.args.get("scope") == "managed":
        query = Task.query.filter(Task.committee_id.in_(officer_committee_ids(user) or [-1]))
    else:
        query = Task.query.filter(Task.assigned_to_id == user.id)
    tasks = _task_query_filters(query).order_by(Task.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tasks])


@committees_bp.post("/committees/<int:committee_id>/tasks")
@roles_required(*STAFF_ROLES)
def create_task(committee_id):
    user = current_user()
    committee = _committee_or_404(committee_id)
    require(can_manage_tasks(user, committee), "Only this committee's chairperson or secretary can assign tasks.")
    data = request.get_json(silent=True) or {}
    assignee = _staff_user(data.get("assigned_to_id"), "Assignee")
    require(membership(assignee, committee) is not None, f"{assignee.name} is not a member of this committee.")

    task = Task(
        committee=committee,
        assigned_by=user,
        assigned_to=assignee,
        title=clean_text(data.get("title"), "Title", max_len=255, required=True),
        description=clean_text(data.get("description"), "Description", max_len=10000),
        deadline=parse_deadline(data.get("deadline")),
        priority=clean_choice(data.get("priority"), "Priority", Task.PRIORITIES, default="normal"),
        assigned_at=utcnow(),
    )
    db.session.add(task)
    db.session.flush()  # the notification links to the task's id
    record_event(task, user, "created", new={"title": task.title})
    record_event(task, user, "assigned", new={"assigned_to": assignee.name, "deadline": task.deadline})
    _notify_assignee(task, assignee, user, "task_assigned", "New task assigned")
    db.session.commit()
    return jsonify(task.to_dict(detail=True)), 201


def _deadline_text(task: Task) -> str:
    return f"Deadline: {task.deadline:%d %b %Y %H:%M}" if task.deadline else "No deadline set"


def _notify_assignee(task: Task, assignee: User, actor: User, subject_key: str, heading: str):
    sent = notify(
        [assignee],
        type="task",
        title=f"{heading}: {task.title}",
        message=f"{task.committee.name}. {_deadline_text(task)}.",
        link=f"/tasks/{task.id}",
        related_id=task.id,
        email_subject=subject_for(subject_key, task.title),
        email_lines=[
            f"Committee: {task.committee.name}",
            f"Task: {task.title}",
            task.description or "",
            _deadline_text(task),
            f"Assigned by: {actor.name}",
        ],
    )
    if sent:
        record_event(task, None, "notification_sent", new={"to": assignee.name, "subject": subject_for(subject_key, task.title)})


@committees_bp.get("/tasks/<int:task_id>")
@roles_required(*STAFF_ROLES)
def get_task(task_id):
    user = current_user()
    task = _task_or_404(task_id)
    require(can_view_task(user, task))
    data = task.to_dict(detail=True)
    report = _task_report_doc(task)
    data.update({
        "can_manage": can_manage_tasks(user, task.committee),
        "can_work": can_work_on_task(user, task),
        "report": {
            "reference_no": report.reference_no, "file_name": report.file_name,
            "url": f"/api/tasks/{task.id}/report", "archive_id": report.id,
        } if report else None,
    })
    return jsonify(data)


def _task_report_doc(task: Task) -> ArchiveDocument | None:
    return ArchiveDocument.query.filter_by(task_id=task.id, category="report", source="created").first()


@committees_bp.get("/tasks/<int:task_id>/report")
@roles_required(*STAFF_ROLES)
def download_task_report(task_id):
    """The standard task report, for anyone who can see the task (including
    the member who wrote it, who can't open the committee archive)."""
    user = current_user()
    task = _task_or_404(task_id)
    require(can_view_task(user, task))
    report = _task_report_doc(task)
    if report is None:
        return jsonify({"error": "This task has no report yet. It is created when the task is completed."}), 404
    return send_document(report.file_path, report.file_name, inline=request.args.get("inline") == "1")


@committees_bp.put("/tasks/<int:task_id>")
@roles_required(*STAFF_ROLES)
def update_task(task_id):
    """Edit, change deadline, reassign or reopen (chairperson or secretary only)."""
    user = current_user()
    task = _task_or_404(task_id)
    require(can_manage_tasks(user, task.committee), "Only this committee's chairperson or secretary can change this task.")
    data = request.get_json(silent=True) or {}
    changes = {}

    for field, max_len, required in (("title", 255, True), ("description", 10000, False)):
        if field in data:
            value = clean_text(data.get(field), field.capitalize(), max_len=max_len, required=required)
            if value != getattr(task, field):
                changes[field] = (getattr(task, field), value)
                setattr(task, field, value)
    if "priority" in data:
        value = clean_choice(data.get("priority"), "Priority", Task.PRIORITIES)
        if value != task.priority:
            changes["priority"] = (task.priority, value)
            task.priority = value
    if changes:
        record_event(task, user, "edited",
                     old={k: v[0] for k, v in changes.items()}, new={k: v[1] for k, v in changes.items()})

    if "deadline" in data:
        value = parse_deadline(data.get("deadline"))
        if value != task.deadline:
            record_event(task, user, "deadline_changed", old=task.deadline, new=value)
            changes["deadline"] = (task.deadline, value)
            task.deadline = value
            task.due_soon_notified_at = None
            task.overdue_notified_at = None

    reassigned_to = None
    assignee = _staff_user(data.get("assigned_to_id"), "Assignee") if "assigned_to_id" in data else None
    if assignee and assignee.id != task.assigned_to_id:
        require(membership(assignee, task.committee) is not None, f"{assignee.name} is not a member of this committee.")
        record_event(task, user, "reassigned",
                     old=task.assigned_to.name if task.assigned_to else None, new=assignee.name)
        task.assigned_to = assignee
        task.assigned_at = utcnow()
        reassigned_to = assignee
        changes["assigned_to"] = True

    if data.get("status") in ("pending", "in_progress") and task.status == "completed":
        record_event(task, user, "reopened", old="completed", new=data["status"])
        task.status = data["status"]
        task.completed_at = None
        task.completed_by_id = None
        changes["status"] = True

    if not changes:
        return jsonify(task.to_dict(detail=True))

    db.session.flush()
    if reassigned_to:
        _notify_assignee(task, reassigned_to, user, "task_assigned", "New task assigned")
    elif task.assigned_to:
        _notify_assignee(task, task.assigned_to, user, "task_updated", "Task updated")
    db.session.commit()
    return jsonify(task.to_dict(detail=True))


@committees_bp.post("/tasks/<int:task_id>/status")
@roles_required(*STAFF_ROLES)
def set_task_progress(task_id):
    """The assignee marks a task as in progress (or back to pending)."""
    user = current_user()
    task = _task_or_404(task_id)
    require(can_work_on_task(user, task), "Only the person this task is assigned to can update its progress.")
    data = request.get_json(silent=True) or {}
    status = clean_choice(data.get("status"), "Status", ("pending", "in_progress"))
    if task.status == "completed":
        return jsonify({"error": "This task is already completed"}), 409
    if status != task.status:
        record_event(task, user, "status_changed", old=task.status, new=status)
        task.status = status
        db.session.commit()
    return jsonify(task.to_dict(detail=True))


@committees_bp.post("/tasks/<int:task_id>/complete")
@roles_required(*STAFF_ROLES)
def complete_task(task_id):
    """The assignee marks the task completed, optionally with a note, the
    report sections (outcomes, challenges, recommendations) and evidence
    files (multipart field `files`). The standard task report PDF is then
    generated and filed in the committee archive."""
    user = current_user()
    task = _task_or_404(task_id)
    require(can_work_on_task(user, task), "Only the person this task is assigned to can complete it.")
    if task.status == "completed":
        return jsonify({"error": "This task is already completed"}), 409

    source = request.form if request.files or request.form else (request.get_json(silent=True) or {})
    note = clean_text(source.get("completion_note"), "Completion note", max_len=5000)
    report_fields = {
        key: clean_text(source.get(key), label, max_len=5000)
        for key, label in (("report_outcomes", "Outcomes"), ("report_challenges", "Challenges"),
                           ("report_recommendations", "Recommendations"))
    }
    for upload in request.files.getlist("files"):
        _attach(task, user, upload)

    now = utcnow()
    record_event(task, user, "completed", old=task.status, new="completed", note=note)
    task.status = "completed"
    task.completed_at = now
    task.completed_by_id = user.id
    task.completion_note = note
    for key, value in report_fields.items():
        setattr(task, key, value)
    db.session.flush()
    report = file_task_report(task, user)

    recipients = [u for u in (*task.committee.officers, task.assigned_by) if u]
    sent = notify(
        recipients,
        type="task",
        title=f"Task completed: {task.title}",
        message=f"{user.name} completed this task on {now:%d %b %Y %H:%M}.",
        link=f"/tasks/{task.id}",
        related_id=task.id,
        email_subject=subject_for("task_completed", task.title),
        email_lines=[
            f"Committee: {task.committee.name}",
            f"Task: {task.title}",
            f"Completed by: {user.name}",
            f"Completed on: {now:%d %b %Y %H:%M}",
            f"Note: {note}" if note else "",
            f"The task report ({report.reference_no}) is filed in the committee archive.",
        ],
        exclude=user,
    )
    if sent:
        record_event(task, None, "notification_sent", new={"to": [u.name for u in recipients if u.id != user.id]})
    db.session.commit()
    return jsonify(task.to_dict(detail=True))


def _attach(task: Task, user: User, upload) -> TaskAttachment | None:
    saved = save_document(upload, "tasks")
    if not saved:
        return None
    name, path = saved
    attachment = TaskAttachment(task=task, file_name=name, file_path=path, uploaded_by_id=user.id)
    db.session.add(attachment)
    record_event(task, user, "file_uploaded", new=name)
    return attachment


@committees_bp.post("/tasks/<int:task_id>/attachments")
@roles_required(*STAFF_ROLES)
def upload_task_attachment(task_id):
    user = current_user()
    task = _task_or_404(task_id)
    require(can_work_on_task(user, task) or can_manage_tasks(user, task.committee))
    files = request.files.getlist("files") or ([request.files["file"]] if "file" in request.files else [])
    if not files:
        raise ValidationError("Choose a file to upload")
    for upload in files:
        _attach(task, user, upload)
    db.session.commit()
    return jsonify(task.to_dict(detail=True)), 201


@committees_bp.get("/tasks/<int:task_id>/attachments/<int:attachment_id>")
@roles_required(*STAFF_ROLES)
def download_task_attachment(task_id, attachment_id):
    user = current_user()
    task = _task_or_404(task_id)
    require(can_view_task(user, task))
    attachment = TaskAttachment.query.filter_by(id=attachment_id, task_id=task.id).first_or_404()
    return send_document(attachment.file_path, attachment.file_name, inline=request.args.get("inline") == "1")


# ---------- Dashboard summary for the committees module ----------

@committees_bp.get("/committees/summary")
@roles_required(*STAFF_ROLES)
def my_summary():
    user = current_user()
    now = utcnow()
    mine = Task.query.filter(Task.assigned_to_id == user.id, Task.status != "completed")
    committee_ids = [m.committee_id for m in CommitteeMember.query.filter_by(user_id=user.id)]
    return jsonify({
        "open_tasks": mine.count(),
        "overdue_tasks": mine.filter(Task.deadline.isnot(None), Task.deadline < now).count(),
        "due_this_week": mine.filter(Task.deadline.isnot(None), Task.deadline >= now,
                                     Task.deadline <= now + timedelta(days=7)).count(),
        "committees": len(committee_ids),
        "upcoming_meetings": Meeting.query.filter(
            Meeting.committee_id.in_(committee_ids or [-1]), Meeting.status == "scheduled",
            Meeting.date >= now.date(),
        ).count(),
    })
