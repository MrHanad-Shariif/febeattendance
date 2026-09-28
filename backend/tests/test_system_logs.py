"""System logs: sign-ins, failed sign-ins, sign-outs and actions are recorded
with IP and device, grouped by sign-in, and only visible with system_logs:view."""
import io

from app.extensions import db
from app.models import ActivityLog
from app.utils.device import describe_device
from app.utils.log_import import import_access_log
from tests.conftest import auth_header, make_user

CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
SAFARI_IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 "
                 "(KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1")


def _login(client, email, password="correct-horse-1", ip="41.78.74.32", ua=CHROME_WIN):
    return client.post("/api/auth/login", json={"email": email, "password": password},
                       headers={"User-Agent": ua}, environ_base={"REMOTE_ADDR": ip})


def test_successful_login_is_logged_with_ip_and_device(client, lecturer):
    res = _login(client, lecturer.email)
    assert res.status_code == 200

    row = ActivityLog.query.filter_by(event="login").one()
    assert row.user_id == lecturer.id
    assert row.user_name == lecturer.name
    assert row.ip_address == "41.78.74.32"
    assert row.device == "Chrome 153 · Windows 10/11 · Desktop"
    assert row.session_id and row.source == "live"


def test_failed_logins_are_logged_with_reason(client, lecturer):
    _login(client, lecturer.email, password="wrong-password")
    _login(client, "nobody@example.com")
    lecturer.status = "disabled"
    db.session.commit()
    _login(client, lecturer.email)

    rows = ActivityLog.query.filter_by(event="login_failed").order_by(ActivityLog.id).all()
    assert [r.detail for r in rows] == ["Wrong password", "No account with this email", "Account is disabled"]
    assert rows[0].user_id == lecturer.id
    assert rows[1].user_id is None and rows[1].user_email == "nobody@example.com"


def test_actions_are_grouped_under_their_sign_in(client, admin):
    token = _login(client, admin.email).get_json()["access_token"]
    headers = {"Authorization": f"Bearer {token}", "User-Agent": SAFARI_IPHONE}

    res = client.post("/api/access/roles", json={"name": "Auditors", "permissions": ["system_logs:view"]}, headers=headers)
    assert res.status_code == 201
    client.get("/api/access/roles", headers=headers)  # plain reads are not logged
    client.post("/api/auth/logout", headers=headers)

    login = ActivityLog.query.filter_by(event="login").one()
    trail = ActivityLog.query.filter_by(session_id=login.session_id).order_by(ActivityLog.id).all()
    assert [(r.event, r.action) for r in trail] == [
        ("login", "Signed in"), ("action", "Created a role"), ("logout", "Signed out"),
    ]
    assert trail[1].status_code == 201
    assert trail[1].device == "Safari 26 · iOS 18 · Phone"


def test_session_listing_counts_actions(client, admin):
    token = _login(client, admin.email).get_json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/access/roles", json={"name": "Auditors", "permissions": []}, headers=headers)

    res = client.get("/api/access/logs/sessions", headers=headers)
    assert res.status_code == 200
    [session] = res.get_json()["rows"]
    assert session["user_id"] == admin.id and session["action_count"] == 1

    trail = client.get(f"/api/access/logs?session_id={session['session_id']}", headers=headers).get_json()["rows"]
    assert {r["event"] for r in trail} == {"login", "action"}


def test_logs_need_the_system_logs_permission(client, lecturer):
    assert client.get("/api/access/logs", headers=auth_header(lecturer)).status_code == 403
    student = make_user("s@example.com", role="student", student_id_number="S1")
    assert client.get("/api/access/logs/sessions", headers=auth_header(student)).status_code == 403


def test_bad_date_is_rejected(client, admin):
    res = client.get("/api/access/logs?from=yesterday", headers=auth_header(admin))
    assert res.status_code == 400


def test_import_access_log_rebuilds_unattributed_rows(app):
    log = io.StringIO("\n".join([
        f'197.220.92.41 - - [20/Sep/2026:05:00:00 +0000] "POST /api/auth/login HTTP/1.1" 200 776 "-" "{CHROME_WIN}"',
        f'197.220.92.41 - - [20/Sep/2026:05:01:00 +0000] "POST /api/committees HTTP/1.1" 201 90 "-" "{CHROME_WIN}"',
        f'197.220.92.41 - - [20/Sep/2026:05:01:05 +0000] "GET /api/committees HTTP/1.1" 200 90 "-" "{CHROME_WIN}"',
        f'10.0.0.9 - - [20/Sep/2026:06:00:00 +0000] "POST /api/auth/login HTTP/1.1" 401 40 "-" "{SAFARI_IPHONE}"',
        'garbage line',
    ]))
    assert import_access_log(log) == (3, 0)

    login, action, failed = ActivityLog.query.order_by(ActivityLog.created_at).all()
    assert login.source == "imported" and login.user_id is None
    assert action.action == "Created a committee" and action.session_id == login.session_id
    assert failed.event == "login_failed" and failed.location == "Local network"

    # Running it again adds nothing.
    log.seek(0)
    assert import_access_log(log) == (0, 3)


def test_describe_device():
    assert describe_device(None) is None
    assert describe_device("curl/8.5.0").startswith("Script / bot")
    assert describe_device(
        "Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
    ) == "Chrome 140 · Android 14 · Phone"
