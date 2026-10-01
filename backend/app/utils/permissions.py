"""Who may do what in the committees module.

Every rule here reads the database, so it reflects the current memberships on
each request -- nothing the browser sends (menus, hidden buttons, capability
flags in /auth/me) is trusted. Routes load the object they act on and pass it
in, which is what stops a user from reaching another committee's data by
changing an id in the URL or body.

The key rule (brief item 37): being a member does not allow assigning tasks,
and being Dean or admin does not make someone a committee's chairperson. Only
the committee's officers -- the chairperson and the secretary, who has the
same authority -- manage a committee's tasks, unless an admin switches on the
explicit `dean_task_override` setting.
"""
from app.models import (
    ArchiveDocument, Committee, CommitteeMember, FacultyRole, InformationPost, MeetingMinutes, Task, User,
)
from app.utils.rbac import has_permission, user_permissions
from app.utils.settings import get_setting_str
from app.utils.validation import ValidationError


def require(condition: bool, message: str = "You do not have permission to do that."):
    if not condition:
        raise ValidationError(message, status=403)


# ---------- Role lookups ----------

def has_faculty_role(user: User, role: str) -> bool:
    return FacultyRole.query.filter_by(user_id=user.id, role=role).first() is not None


def is_admin(user: User) -> bool:
    """Committee administrator: holds committees:edit through an RBAC role
    (see utils/rbac.py). A Super Admin always does."""
    return has_permission(user, "committees:edit")


def is_dean(user: User) -> bool:
    return has_faculty_role(user, "dean")


def is_admin_team(user: User) -> bool:
    """Administration Team = the faculty role, or membership of an
    administration-kind committee."""
    if has_faculty_role(user, "admin_team"):
        return True
    return (
        CommitteeMember.query.join(Committee)
        .filter(CommitteeMember.user_id == user.id, Committee.kind == "administration", Committee.status == "active")
        .first()
        is not None
    )


def membership(user: User, committee: Committee) -> CommitteeMember | None:
    return CommitteeMember.query.filter_by(committee_id=committee.id, user_id=user.id).first()


def is_member(user: User, committee: Committee) -> bool:
    return membership(user, committee) is not None


def is_chair(user: User, committee: Committee) -> bool:
    """Chairperson or secretary: the secretary has the chairperson's permissions."""
    m = membership(user, committee)
    return m is not None and m.role in CommitteeMember.OFFICER_ROLES


def officer_committee_ids(user: User) -> list[int]:
    """Committees the user chairs or is secretary of."""
    return [
        m.committee_id for m in CommitteeMember.query.filter(
            CommitteeMember.user_id == user.id, CommitteeMember.role.in_(CommitteeMember.OFFICER_ROLES)
        )
    ]


def dean_override_enabled() -> bool:
    return get_setting_str("dean_task_override") == "on"


# ---------- Committee-level rules ----------

def can_view_all_committees(user: User) -> bool:
    """Faculty-level monitoring: the Dean and staff with committees:view."""
    return has_permission(user, "committees:view") or is_dean(user)


def can_view_committee(user: User, committee: Committee) -> bool:
    return can_view_all_committees(user) or is_member(user, committee)


def can_manage_tasks(user: User, committee: Committee) -> bool:
    if committee.status != "active":
        return False
    if is_chair(user, committee):
        return True
    return dean_override_enabled() and is_dean(user)


def can_schedule_meeting(user: User, committee: Committee) -> bool:
    if committee.status != "active":
        return False
    if is_chair(user, committee):
        return True
    if committee.kind == "administration" and is_member(user, committee):
        return True
    return dean_override_enabled() and is_dean(user)


def can_publish_minutes(user: User, committee: Committee) -> bool:
    """Brief item 29 step 6: an authorised Administration Team member uploads
    the finalised minutes (system admins may too)."""
    return is_admin(user) or is_admin_team(user)


def can_share_information(user: User) -> bool:
    return is_admin(user) or is_dean(user) or is_admin_team(user)


def can_view_reports(user: User, committee: Committee) -> bool:
    return can_view_all_committees(user) or is_chair(user, committee)


# ---------- Task-level rules ----------

def can_view_task(user: User, task: Task) -> bool:
    if task.assigned_to_id == user.id:
        return True
    committee = task.committee
    return can_view_all_committees(user) or is_chair(user, committee) or can_manage_tasks(user, committee)


def can_work_on_task(user: User, task: Task) -> bool:
    """Only the assignee completes a task or uploads evidence for it."""
    return task.assigned_to_id == user.id


# ---------- Archive / notices visibility ----------

def visible_committee_ids(user: User) -> set[int] | None:
    """Committees whose records the user may see. None means 'all'."""
    if can_view_all_committees(user):
        return None
    return {m.committee_id for m in CommitteeMember.query.filter_by(user_id=user.id).all()}


def can_view_minutes(user: User, minutes: MeetingMinutes) -> bool:
    if minutes.visibility == "faculty":
        return True
    ids = visible_committee_ids(user)
    return ids is None or minutes.committee_id in ids or can_publish_minutes(user, minutes.committee)


# ---------- Committee archive (memos, agendas, reports) ----------

def can_view_whole_archive(user: User) -> bool:
    """System admins, the Dean and the Administration Team see every
    committee's archive."""
    return has_permission(user, "committees:view") or is_dean(user) or is_admin_team(user)


def archive_committee_ids(user: User) -> set[int] | None:
    """Committees whose archive the user may open. None means all. Ordinary
    members see none: only a committee's chairperson and secretary do."""
    if can_view_whole_archive(user):
        return None
    return set(officer_committee_ids(user))


def can_view_archive(user: User, committee: Committee) -> bool:
    ids = archive_committee_ids(user)
    return ids is None or committee.id in ids


def can_add_to_archive(user: User, committee: Committee) -> bool:
    return is_admin(user) or is_chair(user, committee)


def can_delete_archive_document(user: User, doc: ArchiveDocument) -> bool:
    return is_admin(user) or (doc.created_by_id == user.id and is_chair(user, doc.committee))


def can_view_notice(user: User, post: InformationPost) -> bool:
    if post.audience == "all_staff":
        return True
    if post.audience == "lecturers":
        return user.role == "lecturer" or can_share_information(user)
    ids = visible_committee_ids(user)
    return ids is None or post.committee_id in ids or can_share_information(user)


# ---------- What the SPA uses to build its menu (display only) ----------

# ---------- Special exam requests ----------

def can_view_special_exams(user: User) -> bool:
    """The Administration Team, or a staff account whose role grants it."""
    return user.role != "student" and (is_admin_team(user) or has_permission(user, "special_exams:view"))


def can_decide_special_exams(user: User) -> bool:
    return user.role != "student" and (is_admin_team(user) or has_permission(user, "special_exams:edit"))


def capabilities(user: User) -> dict:
    if user.role == "student":
        return {"permissions": []}
    memberships = CommitteeMember.query.filter_by(user_id=user.id).all()
    officer_ids = sorted(m.committee_id for m in memberships if m.role in CommitteeMember.OFFICER_ROLES)
    return {
        "is_dean": is_dean(user),
        "is_admin_team": is_admin_team(user),
        "can_share_information": can_share_information(user),
        "can_view_all_committees": can_view_all_committees(user),
        # Chairperson or secretary (same permissions).
        "chaired_committee_ids": officer_ids,
        "secretary_committee_ids": sorted(m.committee_id for m in memberships if m.role == "secretary"),
        "can_view_archive": bool(officer_ids) or can_view_whole_archive(user),
        "member_committee_ids": sorted(m.committee_id for m in memberships),
        "can_review_special_exams": can_view_special_exams(user),
        "can_decide_special_exams": can_decide_special_exams(user),
        # Fine-grained RBAC permissions ("<resource>:<action>") for building
        # the menu and hiding buttons. Display only: the API checks each one.
        "permissions": sorted(user_permissions(user)),
    }
