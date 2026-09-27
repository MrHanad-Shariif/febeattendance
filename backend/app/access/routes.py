"""User management: staff accounts, roles and the permission catalogue.

Rules that stop anyone from escalating their own access or locking everyone
out (all enforced here, whatever the UI shows):

* You can only put permissions you hold yourself into a role, and only assign
  roles whose permissions you hold yourself. A Super Admin holds everything.
* Only a Super Admin can grant or remove the Super Admin role, or change or
  delete a Super Admin's account.
* Nobody changes their own roles or status, or deletes their own account.
* There is always at least one active Super Admin.
"""
from flask import jsonify, request
from sqlalchemy import func

from app.access import access_bp
from app.extensions import db
from app.models import Permission, Role, User
from app.utils.authz import STAFF_ROLES, current_user, permission_required
from app.utils.invite import create_invited_user, resend_invite
from app.utils.rbac import (
    SUPER_ADMIN, active_super_admins, catalogue, is_super_admin, user_permissions,
)
from app.utils.validation import ValidationError, clean_email, clean_text


def _forbid(message: str):
    raise ValidationError(message, status=403)


def _user_payload(user: User) -> dict:
    return {
        **user.to_dict(),
        "account_type": user.role,
        "roles": [{"id": r.id, "name": r.name, "is_system": r.is_system} for r in user.roles],
        "is_super_admin": is_super_admin(user),
        "permission_count": len(user_permissions(user)) if user.status == "active" else 0,
    }


def _role_ids(value) -> list[Role]:
    if not isinstance(value, list) or not all(isinstance(v, int) and not isinstance(v, bool) for v in value):
        raise ValidationError("Roles must be a list of role ids")
    roles = Role.query.filter(Role.id.in_(value)).all() if value else []
    if len(roles) != len(set(value)):
        raise ValidationError("One of the selected roles no longer exists")
    return roles


def _check_can_assign(actor: User, roles: list[Role]):
    if is_super_admin(actor):
        return
    mine = user_permissions(actor)
    for role in roles:
        if role.is_system and role.name == SUPER_ADMIN:
            _forbid("Only a Super Admin can assign the Super Admin role.")
        missing = {p.code for p in role.permissions} - mine
        if missing:
            _forbid(f"You can't assign the role \"{role.name}\": it grants permissions you don't have yourself.")


def _check_keeps_a_super_admin(user: User, *, loses_super_admin: bool):
    if not loses_super_admin:
        return
    others = [u for u in active_super_admins() if u.id != user.id]
    if not others:
        raise ValidationError("At least one active Super Admin must remain.")


def _staff_or_404(user_id) -> User:
    return User.query.filter(User.id == user_id, User.role.in_(STAFF_ROLES)).first_or_404()


def _guard_target(actor: User, target: User):
    if target.id == actor.id:
        _forbid("You can't change your own account here. Ask another administrator.")
    if is_super_admin(target) and not is_super_admin(actor):
        _forbid("Only a Super Admin can change a Super Admin's account.")


# ---------- Permissions catalogue ----------

@access_bp.get("/permissions")
@permission_required("roles:view", "users:view")
def list_permissions():
    """Every permission, grouped by resource, with the roles that grant it."""
    granted: dict[str, list[str]] = {}
    for role in Role.query.order_by(Role.name).all():
        codes = [p.code for p in role.permissions]
        for code in codes:
            granted.setdefault(code, []).append(role.name)
    groups = catalogue()
    for group in groups:
        for action in group["actions"]:
            action["roles"] = granted.get(action["code"], [])
    return jsonify(groups)


# ---------- Roles ----------

@access_bp.get("/roles")
@permission_required("roles:view", "users:view")
def list_roles():
    return jsonify([r.to_dict() for r in Role.query.order_by(Role.is_system.desc(), Role.name).all()])


def _role_fields(data: dict, actor: User, role: Role | None = None) -> tuple[str, str | None, list[Permission]]:
    name = clean_text(data.get("name"), "Role name", max_len=100, required=True)
    clash = Role.query.filter(func.lower(Role.name) == name.lower()).first()
    if clash and clash is not role:
        raise ValidationError("A role with that name already exists", status=409)
    description = clean_text(data.get("description"), "Description", max_len=500)

    codes = data.get("permissions")
    if not isinstance(codes, list) or not all(isinstance(c, str) for c in codes):
        raise ValidationError("Permissions must be a list of permission codes")
    permissions = Permission.query.filter(Permission.code.in_(codes)).all() if codes else []
    if len(permissions) != len(set(codes)):
        raise ValidationError("Unknown permission in the list")
    if not is_super_admin(actor):
        missing = {p.code for p in permissions} - user_permissions(actor)
        if missing:
            _forbid("You can only grant permissions you have yourself.")
    return name, description, permissions


@access_bp.post("/roles")
@permission_required("roles:add")
def create_role():
    actor = current_user()
    name, description, permissions = _role_fields(request.get_json(silent=True) or {}, actor)
    role = Role(name=name, description=description, permissions=permissions)
    db.session.add(role)
    db.session.commit()
    return jsonify(role.to_dict()), 201


@access_bp.put("/roles/<int:role_id>")
@permission_required("roles:edit")
def update_role(role_id):
    actor = current_user()
    role = Role.query.get_or_404(role_id)
    if role.is_system:
        _forbid("Built-in system roles can't be changed.")
    if not is_super_admin(actor):
        # Also covers removing permissions the actor doesn't have from a role.
        if {p.code for p in role.permissions} - user_permissions(actor):
            _forbid("This role grants permissions you don't have, so only a Super Admin can change it.")
    role.name, role.description, role.permissions = _role_fields(request.get_json(silent=True) or {}, actor, role)
    db.session.commit()
    return jsonify(role.to_dict())


@access_bp.delete("/roles/<int:role_id>")
@permission_required("roles:delete")
def delete_role(role_id):
    actor = current_user()
    role = Role.query.get_or_404(role_id)
    if role.is_system:
        _forbid("Built-in system roles can't be deleted.")
    if not is_super_admin(actor) and {p.code for p in role.permissions} - user_permissions(actor):
        _forbid("This role grants permissions you don't have, so only a Super Admin can delete it.")
    db.session.delete(role)
    db.session.commit()
    return jsonify({"message": "Deleted"})


# ---------- Users (staff accounts) ----------

@access_bp.get("/users")
@permission_required("users:view")
def list_users():
    users = User.query.filter(User.role.in_(STAFF_ROLES)).order_by(User.name).all()
    return jsonify([_user_payload(u) for u in users])


@access_bp.post("/users")
@permission_required("users:add")
def create_user():
    """Invite a new administrative staff account with the chosen roles.
    (Lecturers are invited from the Lecturers page and can be given roles here.)"""
    actor = current_user()
    data = request.get_json(silent=True) or {}
    name = clean_text(data.get("name"), "Name", max_len=200, required=True)
    email = clean_email(data.get("email"))
    roles = _role_ids(data.get("role_ids") or [])
    if roles:
        # Assigning roles at creation is an edit of that user's access.
        if "users:edit" not in user_permissions(actor):
            _forbid("You need permission to assign roles.")
        _check_can_assign(actor, roles)
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "A user with that email already exists"}), 409

    user = create_invited_user(name, email, role="admin")
    user.roles = roles
    db.session.commit()
    return jsonify(_user_payload(user)), 201


@access_bp.put("/users/<int:user_id>")
@permission_required("users:edit")
def update_user(user_id):
    actor = current_user()
    user = _staff_or_404(user_id)
    _guard_target(actor, user)
    data = request.get_json(silent=True) or {}

    if "role_ids" in data:
        new_roles = _role_ids(data["role_ids"])
        added = [r for r in new_roles if r not in user.roles]
        removed = [r for r in user.roles if r not in new_roles]
        _check_can_assign(actor, added + removed)
        loses = any(r.is_system and r.name == SUPER_ADMIN for r in removed)
        _check_keeps_a_super_admin(user, loses_super_admin=loses and user.status == "active")
        user.roles = new_roles

    if "status" in data:
        status = data["status"]
        if status not in ("active", "disabled"):
            raise ValidationError("Status must be active or disabled")
        if user.status == "invited":
            raise ValidationError("This account hasn't been activated yet. Resend the invite instead.")
        if status == "disabled" and user.status == "active":
            _check_keeps_a_super_admin(user, loses_super_admin=is_super_admin(user))
        user.status = status

    if data.get("name") is not None:
        user.name = clean_text(data["name"], "Name", max_len=200, required=True)

    db.session.commit()
    return jsonify(_user_payload(user))


@access_bp.post("/users/<int:user_id>/resend-invite")
@permission_required("users:edit")
def resend_user_invite(user_id):
    user = _staff_or_404(user_id)
    if user.status != "invited":
        raise ValidationError("This account is already activated.")
    resend_invite(user)
    return jsonify({"message": "Invite resent"})


@access_bp.delete("/users/<int:user_id>")
@permission_required("users:delete")
def delete_user(user_id):
    actor = current_user()
    user = _staff_or_404(user_id)
    _guard_target(actor, user)
    if user.role != "admin":
        raise ValidationError("Lecturer accounts are deleted from the Lecturers page.")
    _check_keeps_a_super_admin(user, loses_super_admin=is_super_admin(user) and user.status == "active")
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Deleted"})
