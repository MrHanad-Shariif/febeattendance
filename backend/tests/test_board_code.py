"""Board-code check-in: the lecturer writes a short code on the board and
students type it instead of scanning the QR code. Location and face steps
are the same as QR check-in (face engine stubbed as in test_student_checkin)."""
from datetime import date, datetime, timedelta

from app.extensions import db
from app.models import BoardSession, StudentAttendance
from app.utils.rbac import ensure_rbac_seeded
from app.models import Role
from tests.conftest import auth_header, make_user
from tests.test_student_checkin import CAMPUS, _entry, _frames, _student, face_score  # noqa: F401


def _start(client, user, entry):
    return client.post("/api/me/board-session", json={"timetable_id": entry.id}, headers=auth_header(user))


def _board_checkin(client, student, entry, code):
    return client.post("/api/student/checkin/board", json={"timetable_id": entry.id, "code": code}, headers=auth_header(student))


def _finish(client, student, ticket):
    headers = auth_header(student)
    resp = client.post("/api/student/checkin/location", json={"ticket": ticket, **CAMPUS}, headers=headers)
    assert resp.status_code == 200, resp.json
    return client.post("/api/student/checkin/complete", data=_frames(ticket=resp.json["ticket"]), headers=headers)


def test_lecturer_starts_board_session_and_student_checks_in(client, lecturer, face_score):
    entry, student = _entry(lecturer), _student()
    resp = _start(client, lecturer, entry)
    assert resp.status_code == 201, resp.json
    code = resp.json["session"]["code"]
    assert len(code) == 4 and code.isdigit() and resp.json["session"]["open"]

    current = client.get("/api/student/current-class", headers=auth_header(student)).json
    assert current["session"]["timetable_id"] == entry.id and current["board_open"] is True

    resp = _board_checkin(client, student, entry, code)
    assert resp.status_code == 200, resp.json
    assert resp.json["code_verified"] is True
    done = _finish(client, student, resp.json["ticket"])
    assert done.status_code == 200, done.json
    assert done.json["status"] == "on_time" and done.json["checkin_method"] == "board"

    state = client.get(f"/api/me/board-session?timetable_id={entry.id}", headers=auth_header(lecturer)).json
    assert state["counts"]["checked_in"] == 1 and state["counts"]["board"] == 1


def test_starting_twice_returns_the_same_code(client, lecturer):
    entry = _entry(lecturer)
    first = _start(client, lecturer, entry).json["session"]["code"]
    again = _start(client, lecturer, entry)
    assert again.status_code == 200 and again.json["session"]["code"] == first
    assert BoardSession.query.count() == 1


def test_board_code_needs_an_open_session(client, lecturer):
    entry, student = _entry(lecturer), _student()
    resp = _board_checkin(client, student, entry, "1234")
    assert resp.status_code == 409 and resp.json["reason"] == "board_not_open"


def test_board_code_of_another_batch_is_refused(client, lecturer):
    other = _entry(lecturer, batch="BARE05")
    code = _start(client, lecturer, other).json["session"]["code"]
    resp = _board_checkin(client, _student(), other, code)
    assert resp.status_code == 403 and resp.json["reason"] == "wrong_batch"


def test_board_code_is_only_valid_for_its_own_class(client, lecturer):
    mine, other = _entry(lecturer), _entry(lecturer, course="Hydraulics")
    _start(client, lecturer, mine)
    other_code = _start(client, lecturer, other).json["session"]["code"]
    mine_code = BoardSession.query.filter_by(timetable_id=mine.id).first().code
    if other_code != mine_code:
        assert _board_checkin(client, _student(), mine, other_code).status_code == 403


def test_five_wrong_codes_lock_the_student_out(client, lecturer):
    entry, student = _entry(lecturer), _student()
    code = _start(client, lecturer, entry).json["session"]["code"]
    wrong = "0000" if code != "0000" else "1111"
    for remaining in (4, 3, 2, 1):
        resp = _board_checkin(client, student, entry, wrong)
        assert resp.status_code == 403 and resp.json["attempts_remaining"] == remaining
    assert _board_checkin(client, student, entry, wrong).json["reason"] == "board_locked"
    # Even the right code no longer works for this student and class.
    resp = _board_checkin(client, student, entry, code)
    assert resp.status_code == 429 and resp.json["reason"] == "board_locked"


def test_new_code_stops_the_old_one(client, lecturer):
    entry, student = _entry(lecturer), _student()
    old = _start(client, lecturer, entry).json["session"]["code"]
    new = client.post("/api/me/board-session/new-code", json={"timetable_id": entry.id}, headers=auth_header(lecturer)).json["session"]
    assert new["code"] != old and new["code_changes"] == 1
    assert _board_checkin(client, student, entry, old).status_code == 403
    assert _board_checkin(client, student, entry, new["code"]).status_code == 200


def test_closing_stops_new_and_in_flight_checkins(client, lecturer, face_score):
    entry, student = _entry(lecturer), _student()
    code = _start(client, lecturer, entry).json["session"]["code"]
    ticket = _board_checkin(client, student, entry, code).json["ticket"]

    closed = client.post("/api/me/board-session/close", json={"timetable_id": entry.id}, headers=auth_header(lecturer))
    assert closed.status_code == 200 and closed.json["session"]["open"] is False
    assert "code" not in closed.json["session"]

    resp = client.post("/api/student/checkin/location", json={"ticket": ticket, **CAMPUS}, headers=auth_header(student))
    assert resp.status_code == 409 and resp.json["reason"] == "board_closed"
    assert _board_checkin(client, _student("b@example.com", seed=2), entry, code).json["reason"] == "board_not_open"
    assert StudentAttendance.query.filter(StudentAttendance.checkin_at.isnot(None)).count() == 0


def test_board_session_closes_by_itself(client, lecturer):
    entry, student = _entry(lecturer), _student()
    code = _start(client, lecturer, entry).json["session"]["code"]
    session = BoardSession.query.one()
    session.closes_at = datetime.now() - timedelta(seconds=1)
    db.session.commit()
    assert _board_checkin(client, student, entry, code).json["reason"] == "board_not_open"


def test_cannot_start_after_the_auto_close_time(client, lecturer, admin):
    entry = _entry(lecturer)  # started 5 minutes ago
    client.put("/api/admin/settings", json={"board_code_close_after_minutes": "2"}, headers=auth_header(admin))
    resp = _start(client, lecturer, entry)
    assert resp.status_code == 400 and "closed at" in resp.json["error"]


def test_lecturer_cannot_run_another_lecturers_board(client, lecturer):
    theirs = _entry(make_user("other@example.com"))
    assert _start(client, lecturer, theirs).status_code == 404
    assert client.get(f"/api/me/board-session?timetable_id={theirs.id}", headers=auth_header(lecturer)).status_code == 404


def test_staff_with_permission_can_start_for_a_lecturer(client, lecturer, admin):
    entry = _entry(lecturer)
    staff = make_user("office@example.com", role="admin")
    # No role yet: no access to anyone's class.
    assert _start(client, staff, entry).status_code == 404

    ensure_rbac_seeded()
    staff.roles = [Role.query.filter_by(name="Attendance Officer").one()]
    db.session.commit()
    resp = _start(client, staff, entry)
    assert resp.status_code == 201
    assert resp.json["session"]["started_by_name"] == staff.name
    classes = client.get("/api/me/classes-today", headers=auth_header(staff)).json["classes"]
    assert entry.id in [c["id"] for c in classes]


def test_qr_checkin_is_recorded_as_qr(client, lecturer, face_score):
    from tests.test_student_checkin import _through_location

    entry, student = _entry(lecturer), _student()
    ticket = _through_location(client, student, entry)
    done = client.post("/api/student/checkin/complete", data=_frames(ticket=ticket), headers=auth_header(student))
    assert done.json["checkin_method"] == "qr"


def test_checkin_methods_report(client, lecturer, admin, face_score):
    entry, student = _entry(lecturer), _student()
    code = _start(client, lecturer, entry).json["session"]["code"]
    _finish(client, student, _board_checkin(client, student, entry, code).json["ticket"])

    resp = client.get("/api/admin/reports/checkin-methods", headers=auth_header(admin))
    assert resp.status_code == 200
    row = next(r for r in resp.json["rows"] if r["timetable_id"] == entry.id and r["date"] == date.today().isoformat())
    assert row["board"] == 1 and row["qr"] == 0 and row["board_opened"] and row["enrolled"] == 1
    assert row["board_started_by"] == lecturer.name
    assert client.get("/api/admin/reports/checkin-methods", headers=auth_header(lecturer)).status_code == 403
