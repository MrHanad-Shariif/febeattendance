"""Authentication, session and token-purpose rules."""
from datetime import datetime, timedelta

from app.extensions import db
from app.models import PasswordResetToken
from tests.conftest import auth_header, make_user


def login(client, email, password):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_login_success_and_wrong_password(client, lecturer):
    ok = login(client, "lecturer@example.com", "correct-horse-1")
    assert ok.status_code == 200
    assert ok.json["access_token"]

    bad = login(client, "lecturer@example.com", "nope")
    unknown = login(client, "ghost@example.com", "nope")
    assert bad.status_code == unknown.status_code == 401
    assert bad.json == unknown.json  # no account enumeration


def test_login_rejects_non_string_input(client):
    resp = client.post("/api/auth/login", json={"email": ["a"], "password": {"x": 1}})
    assert resp.status_code == 400


def test_protected_route_requires_token(client):
    assert client.get("/api/admin/lecturers").status_code == 401


def test_role_is_enforced(client, lecturer):
    assert client.get("/api/admin/lecturers", headers=auth_header(lecturer)).status_code == 403


def test_disabled_user_loses_access_immediately(client, admin):
    headers = auth_header(admin)
    assert client.get("/api/admin/lecturers", headers=headers).status_code == 200

    admin.status = "disabled"
    db.session.commit()
    assert client.get("/api/admin/lecturers", headers=headers).status_code == 401


def test_deleted_user_token_is_rejected(client, lecturer):
    headers = auth_header(lecturer)
    db.session.delete(lecturer)
    db.session.commit()
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_changing_password_invalidates_old_tokens(client, lecturer):
    old = auth_header(lecturer)
    resp = client.post(
        "/api/auth/change-password", headers=old,
        json={"old_password": "correct-horse-1", "new_password": "brand-new-pass-2"},
    )
    assert resp.status_code == 200
    assert client.get("/api/auth/me", headers=old).status_code == 401
    fresh = {"Authorization": f"Bearer {resp.json['access_token']}"}
    assert client.get("/api/auth/me", headers=fresh).status_code == 200


def test_role_change_in_db_beats_stale_token_claim(client, admin):
    headers = auth_header(admin)
    admin.role = "lecturer"
    db.session.commit()
    assert client.get("/api/admin/lecturers", headers=headers).status_code == 401


def _token(user, purpose, **kw):
    row = PasswordResetToken(user_id=user.id, purpose=purpose, expires_at=datetime.now() + timedelta(hours=1), **kw)
    db.session.add(row)
    db.session.commit()
    return row.token


def test_reset_token_cannot_reactivate_a_disabled_account(client):
    user = make_user("gone@example.com", status="disabled")
    token = _token(user, "reset")
    resp = client.post("/api/auth/activate", json={"token": token, "password": "a-fresh-password"})
    assert resp.status_code == 400
    db.session.refresh(user)
    assert user.status == "disabled"


def test_verify_token_cannot_be_used_to_activate(client):
    user = make_user("pending@example.com", role="student", status="pending_verification")
    token = _token(user, "verify_email")
    assert client.post("/api/auth/activate", json={"token": token, "password": "a-fresh-password"}).status_code == 400


def test_invite_activation_works_once(client):
    user = make_user("invitee@example.com", status="invited", password="temporary-pass-1")
    token = _token(user, "invite")
    ok = client.post("/api/auth/activate", json={"token": token, "password": "my-new-password"})
    assert ok.status_code == 200
    again = client.post("/api/auth/activate", json={"token": token, "password": "another-password"})
    assert again.status_code == 400


def test_password_rules(client, lecturer):
    headers = auth_header(lecturer)
    for bad in ("short", " " * 12, "x" * 80, None, 12345678):
        resp = client.post("/api/auth/change-password", headers=headers,
                           json={"old_password": "correct-horse-1", "new_password": bad})
        assert resp.status_code == 400, bad


def test_forgot_password_does_not_reveal_accounts(client, lecturer):
    a = client.post("/api/auth/forgot-password", json={"email": "lecturer@example.com"})
    b = client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"})
    assert a.status_code == b.status_code == 200
    assert a.json == b.json


def test_uploads_require_authentication(client):
    assert client.get("/api/uploads/student_photos/x.png").status_code == 401


def test_errors_are_json_and_security_headers_present(client):
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404 and resp.is_json
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Cache-Control"] == "no-store"


def test_login_is_rate_limited_per_email(tmp_path):
    from app import create_app
    from app.config import TestingConfig

    class Limited(TestingConfig):
        RATELIMIT_ENABLED = True
        UPLOAD_FOLDER = str(tmp_path)

    app = create_app(Limited)
    with app.app_context():
        db.create_all()
        client = app.test_client()
        codes = [login(client, "victim@example.com", f"guess-{i}").status_code for i in range(10)]
        assert codes[:8] == [401] * 8
        assert 429 in codes[8:]
        # a different account is not affected by the first one's lockout
        assert login(client, "someone-else@example.com", "x").status_code == 401
        db.drop_all()
