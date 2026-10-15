"""User management: fine-grained RBAC (roles bundle resource:action
permissions; users hold roles) and the anti-escalation / lockout rules."""
from app.extensions import db
from app.models import Role, User
from app.utils.rbac import ALL_PERMISSIONS, SUPER_ADMIN, ensure_rbac_seeded, user_permissions
from tests.conftest import auth_header, make_user


def _role(name, *codes):
    from app.models import Permission

    role = Role(name=name, permissions=Permission.query.filter(Permission.code.in_(codes)).all())
    db.session.add(role)
    db.session.commit()
    return role


def _staff(email, *roles, role="admin"):
    user = make_user(email, role=role)
    user.roles = list(roles)
    db.session.commit()
    return user


def test_seeding_creates_catalogue_and_builtin_roles(app):
    names = {r.name for r in Role.query.all()}
    assert {SUPER_ADMIN, "Viewer", "Attendance Officer", "Timetable Manager"} <= names
    viewer = Role.query.filter_by(name="Viewer").one()
    assert all(p.code.endswith(":view") for p in viewer.permissions)


def test_first_seed_gives_existing_admins_super_admin_but_later_seeds_do_not(app):
    # Simulate an existing deployment: wipe role assignments, add an admin.
    old_admin = make_user("old@example.com", role="admin")
    ensure_rbac_seeded()
    assert user_permissions(old_admin) == set(ALL_PERMISSIONS)

    removed = make_user("new@example.com", role="admin")
    ensure_rbac_seeded()
    assert user_permissions(removed) == set()


def test_admin_without_roles_has_no_access(client, admin):
    nobody = make_user("nobody@example.com", role="admin")
    assert client.get("/api/admin/lecturers", headers=auth_header(nobody)).status_code == 403
    assert client.get("/api/admin/settings", headers=auth_header(nobody)).status_code == 403


def test_crud_permissions_are_enforced_bit_by_bit(client, admin, lecturer):
    viewer = _staff("viewer@example.com", _role("TT view", "timetable:view"))
    editor = _staff("editor@example.com", _role("TT edit", "timetable:view", "timetable:edit"))
    creator = _staff("creator@example.com", _role("TT add", "timetable:add"))

    body = {"lecturer_id": lecturer.id, "course_name": "Statics", "batch": "B1", "days": ["Sat"], "start_time": "08:00", "end_time": "10:00"}
    assert client.post("/api/admin/timetable", json=body, headers=auth_header(viewer)).status_code == 403
    created = client.post("/api/admin/timetable", json=body, headers=auth_header(creator))
    assert created.status_code == 201
    tid = created.json["id"]

    assert client.get("/api/admin/timetable", headers=auth_header(viewer)).status_code == 200
    assert client.get("/api/admin/timetable", headers=auth_header(creator)).status_code == 403
    assert client.put(f"/api/admin/timetable/{tid}", json={"room": "204"}, headers=auth_header(viewer)).status_code == 403
    assert client.put(f"/api/admin/timetable/{tid}", json={"room": "204"}, headers=auth_header(editor)).status_code == 200
    assert client.delete(f"/api/admin/timetable/{tid}", headers=auth_header(editor)).status_code == 403
    assert client.delete(f"/api/admin/timetable/{tid}", headers=auth_header(admin)).status_code == 200
    # Other resources stay closed.
    assert client.get("/api/admin/students", headers=auth_header(editor)).status_code == 403


def test_lecturer_can_be_given_management_permissions(client, lecturer):
    lecturer.roles = [_role("Student viewer", "students:view")]
    db.session.commit()
    assert client.get("/api/admin/students", headers=auth_header(lecturer)).status_code == 200
    me = client.get("/api/auth/me", headers=auth_header(lecturer)).json
    assert me["capabilities"]["permissions"] == ["students:view"]


def test_students_never_get_permissions(client):
    student = make_user("s@example.com", role="student")
    student.roles = [Role.query.filter_by(name=SUPER_ADMIN).one()]
    db.session.commit()
    assert user_permissions(student) == set()
    assert client.get("/api/admin/students", headers=auth_header(student)).status_code == 403


def test_role_crud(client, admin):
    headers = auth_header(admin)
    res = client.post("/api/access/roles", json={"name": "Registrar", "description": "Students", "permissions": ["students:view", "students:edit"]}, headers=headers)
    assert res.status_code == 201 and res.json["permissions"] == ["students:edit", "students:view"]
    rid = res.json["id"]
    assert client.post("/api/access/roles", json={"name": "registrar", "permissions": []}, headers=headers).status_code == 409
    assert client.post("/api/access/roles", json={"name": "X", "permissions": ["nope:view"]}, headers=headers).status_code == 400
    res = client.put(f"/api/access/roles/{rid}", json={"name": "Registrar", "permissions": ["students:view"]}, headers=headers)
    assert res.json["permissions"] == ["students:view"]

    super_id = Role.query.filter_by(name=SUPER_ADMIN).one().id
    assert client.put(f"/api/access/roles/{super_id}", json={"name": "x", "permissions": []}, headers=headers).status_code == 403
    assert client.delete(f"/api/access/roles/{super_id}", headers=headers).status_code == 403
    assert client.delete(f"/api/access/roles/{rid}", headers=headers).status_code == 200

    perms = client.get("/api/access/permissions", headers=headers).json
    timetable = next(g for g in perms if g["resource"] == "timetable")
    assert [a["action"] for a in timetable["actions"]] == ["view", "add", "edit", "delete"]
    assert SUPER_ADMIN in timetable["actions"][0]["roles"]


def test_cannot_grant_permissions_you_do_not_have(client, admin):
    manager = _staff("mgr@example.com", _role("Role manager", "roles:view", "roles:add", "roles:edit", "users:view", "users:edit", "timetable:view"))
    headers = auth_header(manager)
    assert client.post("/api/access/roles", json={"name": "Mine", "permissions": ["timetable:view"]}, headers=headers).status_code == 201
    assert client.post("/api/access/roles", json={"name": "Escalate", "permissions": ["settings:edit"]}, headers=headers).status_code == 403

    target = make_user("target@example.com", role="admin")
    super_id = Role.query.filter_by(name=SUPER_ADMIN).one().id
    viewer_id = Role.query.filter_by(name="Viewer").one().id
    assert client.put(f"/api/access/users/{target.id}", json={"role_ids": [super_id]}, headers=headers).status_code == 403
    # Viewer holds views this manager doesn't have (e.g. settings:view).
    assert client.put(f"/api/access/users/{target.id}", json={"role_ids": [viewer_id]}, headers=headers).status_code == 403
    # Nor can they edit their own roles.
    assert client.put(f"/api/access/users/{manager.id}", json={"role_ids": [super_id]}, headers=headers).status_code == 403
    # And they can't touch a Super Admin's account.
    assert client.put(f"/api/access/users/{admin.id}", json={"status": "disabled"}, headers=headers).status_code == 403


def test_user_management_and_last_super_admin(client, admin, monkeypatch):
    monkeypatch.setattr("app.utils.invite.send_invite_email", lambda user, token: None)
    headers = auth_header(admin)
    viewer_id = Role.query.filter_by(name="Viewer").one().id
    super_id = Role.query.filter_by(name=SUPER_ADMIN).one().id

    res = client.post("/api/access/users", json={"name": "Office", "email": "office@example.com", "role_ids": [viewer_id]}, headers=headers)
    assert res.status_code == 201
    assert res.json["account_type"] == "admin" and res.json["status"] == "invited"
    assert [r["name"] for r in res.json["roles"]] == ["Viewer"]

    users = client.get("/api/access/users", headers=headers).json
    assert {u["email"] for u in users} == {"admin@example.com", "office@example.com"}

    # Super Admins manage each other; a demoted admin loses user management at once.
    second = _staff("second@example.com", Role.query.get(super_id))
    s_headers = auth_header(second)
    assert client.put(f"/api/access/users/{admin.id}", json={"role_ids": [viewer_id]}, headers=s_headers).status_code == 200
    assert client.put(f"/api/access/users/{second.id}", json={"role_ids": []}, headers=headers).status_code == 403  # admin is no longer super
    res = client.put(f"/api/access/users/{admin.id}", json={"role_ids": [super_id]}, headers=s_headers)
    assert res.status_code == 200
    assert client.delete(f"/api/access/users/{second.id}", headers=headers).status_code == 200
    assert client.put(f"/api/access/users/{admin.id}", json={"status": "disabled"}, headers=headers).status_code == 403  # self
    assert User.query.get(admin.id).status == "active"


def test_user_list_includes_students_but_they_hold_no_roles(client, admin, lecturer):
    student = make_user("student@example.com", role="student", student_id_number="S-100", batch="BCE08")
    users = {u["email"]: u for u in client.get("/api/access/users", headers=auth_header(admin)).json}
    assert {u["account_type"] for u in users.values()} == {"admin", "lecturer", "student"}
    assert users["student@example.com"]["student_id_number"] == "S-100"
    assert users["student@example.com"]["roles"] == [] and users["student@example.com"]["permission_count"] == 0
    # Roles, status and deletion stay staff-only.
    viewer_id = Role.query.filter_by(name="Viewer").one().id
    headers = auth_header(admin)
    assert client.put(f"/api/access/users/{student.id}", json={"role_ids": [viewer_id]}, headers=headers).status_code == 404
    assert client.delete(f"/api/access/users/{student.id}", headers=headers).status_code == 404


def test_only_super_admin_sets_other_users_passwords(client, admin, lecturer):
    student = make_user("student@example.com", role="student", student_id_number="S-101")
    old_student_headers = auth_header(student)
    url = f"/api/access/users/{student.id}/password"

    # A user manager without Super Admin can't, nor can students or lecturers.
    manager = _staff("manager@example.com", _role("Users", "users:view", "users:edit"))
    assert client.post(url, json={"password": "brand-new-pass"}, headers=auth_header(manager)).status_code == 403
    assert client.post(url, json={"password": "brand-new-pass"}, headers=auth_header(lecturer)).status_code == 403
    # Nor on your own account (use change-password, which checks the old one).
    own = client.post(f"/api/access/users/{admin.id}/password", json={"password": "brand-new-pass"}, headers=auth_header(admin))
    assert own.status_code == 403
    assert client.post(url, json={"password": "short"}, headers=auth_header(admin)).status_code == 400

    assert client.post(url, json={"password": "brand-new-pass"}, headers=auth_header(admin)).status_code == 200
    assert User.query.get(student.id).check_password("brand-new-pass")
    # Their old session is signed out.
    assert client.get("/api/auth/me", headers=old_student_headers).status_code == 401
    res = client.post("/api/auth/login", json={"email": "student@example.com", "password": "brand-new-pass"})
    assert res.status_code == 200

    for target in (lecturer, manager):
        res = client.post(f"/api/access/users/{target.id}/password", json={"password": "another-pass-1"}, headers=auth_header(admin))
        assert res.status_code == 200
        assert User.query.get(target.id).check_password("another-pass-1")


def test_setting_password_activates_an_invited_account(client, admin, monkeypatch):
    from app.models import PasswordResetToken

    monkeypatch.setattr("app.utils.invite.send_invite_email", lambda user, token: None)
    res = client.post("/api/access/users", json={"name": "Office", "email": "office@example.com"}, headers=auth_header(admin))
    uid = res.json["id"]
    res = client.post(f"/api/access/users/{uid}/password", json={"password": "set-by-admin-1"}, headers=auth_header(admin))
    assert res.status_code == 200 and res.json["status"] == "active"
    assert PasswordResetToken.query.filter_by(user_id=uid, purpose="invite", used_at=None).count() == 0
