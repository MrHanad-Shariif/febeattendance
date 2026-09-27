"""Fine-grained role-based access control for the management screens.

Each screen or record type is a *resource*; each resource allows some of the
four CRUD actions (view, add, edit, delete). A permission is the pair, written
"<resource>:<action>". Roles bundle permissions and users hold roles, so
"give X edit rights on the timetable" means assigning X a role that contains
timetable:edit (and usually timetable:view).

The catalogue below is the single source of truth: `ensure_rbac_seeded()`
writes it to the permissions table, adds the built-in roles and gives every
existing admin account without a role the Super Admin role, so upgrading an
existing deployment changes nothing for its admins.

Students never receive permissions. Lecturers keep everything they can do as
lecturers (their own classes, QR and board codes, their students) without any
role; a role only *adds* management access on top.
"""
from app.extensions import db
from app.models import Permission, Role, User, user_roles

ACTIONS = ("view", "add", "edit", "delete")
ACTION_LABELS = {"view": "View", "add": "Add", "edit": "Edit", "delete": "Delete"}

# resource: (label, group, {action: what it allows})
CATALOGUE = {
    "dashboard": ("Admin dashboard", "General", {
        "view": "Open the admin dashboard with KPIs and live check-ins",
    }),
    "lecturers": ("Lecturers", "Lecturers", {
        "view": "See the lecturer list",
        "add": "Invite new lecturers",
        "edit": "Edit lecturers, enable/disable them and resend invites",
        "delete": "Delete lecturers",
    }),
    "lecturer_attendance": ("Lecturer attendance", "Lecturers", {
        "view": "See today's lecturer attendance, the check-in QR poster and kiosk link",
        "edit": "Add or change remarks that justify an absence or early leave",
    }),
    "timetable": ("Timetable", "Lecturers", {
        "view": "See the timetable",
        "add": "Add timetable entries",
        "edit": "Change timetable entries",
        "delete": "Delete timetable entries",
    }),
    "students": ("Students", "Students", {
        "view": "See the student list and each student's report",
        "edit": "Edit students, enable/disable them and reset registered faces",
        "delete": "Delete students",
    }),
    "student_attendance": ("Student attendance", "Students", {
        "view": "See today's class sessions and each session's roster",
        "edit": "Correct a student's attendance (a remark is always required)",
    }),
    "class_checkin": ("Class check-in (any class)", "Students", {
        "view": "Show the QR code and rotating code for any lecturer's class",
        "add": "Start board-code check-in for any lecturer's class",
        "edit": "Change the board code or close board check-in for any class",
    }),
    "reports": ("Reports", "Reports", {
        "view": "Open every attendance report and export it",
    }),
    "committees": ("Committees", "Committees", {
        "view": "Monitor every committee, its tasks and meetings",
        "add": "Create committees",
        "edit": "Edit committees and their members, publish minutes and remove notices",
        "delete": "Delete committees",
    }),
    "faculty_roles": ("Faculty roles", "Committees", {
        "view": "See who holds Dean and Administration Team roles",
        "edit": "Grant and revoke Dean and Administration Team roles",
    }),
    "settings": ("Settings", "System", {
        "view": "See attendance rules and system settings",
        "edit": "Change attendance rules and system settings",
    }),
    "users": ("Users", "Authentication", {
        "view": "See staff accounts and the roles they hold",
        "add": "Invite new staff accounts",
        "edit": "Assign roles, enable and disable staff accounts",
        "delete": "Delete staff accounts",
    }),
    "roles": ("Roles & permissions", "Authentication", {
        "view": "See roles and which permissions each one grants",
        "add": "Create roles",
        "edit": "Change a role's name and permissions",
        "delete": "Delete roles",
    }),
}

ALL_PERMISSIONS = [f"{res}:{action}" for res, (_, _, actions) in CATALOGUE.items() for action in actions]

SUPER_ADMIN = "Super Admin"

# Built-in roles created on first run. Only Super Admin is locked; the others
# are starting points an admin can edit or delete.
DEFAULT_ROLES = {
    SUPER_ADMIN: ("Full access to everything, including users and roles.", True, ALL_PERMISSIONS),
    "Viewer": ("Can open every management screen and report but change nothing.", False,
               [p for p in ALL_PERMISSIONS if p.endswith(":view")]),
    "Attendance Officer": (
        "Day-to-day attendance: today's lists, corrections, class codes for any class and reports.", False,
        ["dashboard:view", "lecturer_attendance:view", "lecturer_attendance:edit", "student_attendance:view",
         "student_attendance:edit", "class_checkin:view", "class_checkin:add", "class_checkin:edit",
         "lecturers:view", "students:view", "timetable:view", "reports:view"],
    ),
    "Timetable Manager": (
        "Maintains the timetable.", False,
        ["timetable:view", "timetable:add", "timetable:edit", "timetable:delete", "lecturers:view"],
    ),
}


def catalogue() -> list[dict]:
    """The permission catalogue for the UI, grouped by resource."""
    return [
        {
            "resource": res,
            "label": label,
            "group": group,
            "actions": [
                {"action": a, "label": ACTION_LABELS[a], "code": f"{res}:{a}", "description": desc}
                for a, desc in actions.items()
            ],
        }
        for res, (label, group, actions) in CATALOGUE.items()
    ]


def is_super_admin(user: User) -> bool:
    return user.role != "student" and any(r.is_system and r.name == SUPER_ADMIN for r in user.roles)


def user_permissions(user: User | None) -> set[str]:
    if user is None or user.role == "student" or user.status != "active":
        return set()
    if is_super_admin(user):
        # Also covers permissions added to the catalogue after the role was seeded.
        return set(ALL_PERMISSIONS)
    return {p.code for role in user.roles for p in role.permissions}


def has_permission(user: User | None, code: str) -> bool:
    return code in user_permissions(user)


def has_any_permission(user: User | None, codes) -> bool:
    perms = user_permissions(user)
    return any(c in perms for c in codes)


def active_super_admins() -> list[User]:
    role = Role.query.filter_by(name=SUPER_ADMIN, is_system=True).first()
    if not role:
        return []
    return [u for u in role.users if u.status == "active" and u.role != "student"]


def ensure_rbac_seeded():
    """Idempotent: add missing permissions and built-in roles, and give every
    admin account that has no role yet the Super Admin role."""
    existing = {p.code: p for p in Permission.query.all()}
    for res, (_, _, actions) in CATALOGUE.items():
        for action, desc in actions.items():
            code = f"{res}:{action}"
            if code in existing:
                existing[code].description = desc
            else:
                existing[code] = Permission(code=code, resource=res, action=action, description=desc)
                db.session.add(existing[code])
    db.session.flush()

    for name, (desc, is_system, codes) in DEFAULT_ROLES.items():
        role = Role.query.filter_by(name=name).first()
        if role is None:
            role = Role(name=name, description=desc, is_system=is_system,
                        permissions=[existing[c] for c in codes])
            db.session.add(role)
        elif role.is_system:
            role.permissions = [existing[c] for c in codes]

    db.session.flush()
    # One-off upgrade path: the first time RBAC runs (no one holds any role
    # yet) every existing admin keeps full access. After that an admin with
    # no role is deliberate and stays without access.
    super_admin = Role.query.filter_by(name=SUPER_ADMIN).first()
    if db.session.query(user_roles).first() is None:
        for user in User.query.filter_by(role="admin").all():
            user.roles.append(super_admin)
    db.session.commit()


def grant_super_admin(user: User):
    role = Role.query.filter_by(name=SUPER_ADMIN, is_system=True).first()
    if role is None:
        ensure_rbac_seeded()
        role = Role.query.filter_by(name=SUPER_ADMIN, is_system=True).first()
    if role not in user.roles:
        user.roles.append(role)
    db.session.commit()
