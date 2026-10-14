"""Online teaching: designated sessions skip only the campus code and
location; identity, class, timing and duplicate checks stay. Temporary
periods end by themselves; early end, extension and cancellation keep past
sessions as they were taught; everyone affected is told."""
import io
from datetime import date, datetime, time, timedelta

import pytest

from app.extensions import db
from app.models import Attendance, Notification, OnlineArrangement, StudentAttendance, StudentFace, Timetable
from app.utils import face
from app.utils.checkin_session import load_ticket
from app.utils.online import OnlineIndex, delivery_mode, send_return_notices
from tests.conftest import auth_header, make_user

TODAY = date.today()
EVERY_DAY = "Sat,Sun,Mon,Tue,Wed,Thu,Fri"
URL = "/api/admin/online"


@pytest.fixture()
def world(app, admin, lecturer, monkeypatch):
    now = datetime.now()
    start = (now - timedelta(minutes=10)).time().replace(second=0, microsecond=0)
    end = (now + timedelta(minutes=80)).time().replace(second=0, microsecond=0)
    if end <= start:  # around midnight
        start, end = time(0, 0), time(23, 59)
    t1 = Timetable(lecturer_id=lecturer.id, course_name="Statics", batch="BCE08", room="R101", days=EVERY_DAY,
                   start_time=start, end_time=end)
    other = make_user("other.lect@example.com")
    t2 = Timetable(lecturer_id=other.id, course_name="Surveying", batch="BCE09", room="R202", days=EVERY_DAY,
                   start_time=start, end_time=end)
    db.session.add_all([t1, t2])
    s1 = make_user("s1@example.com", role="student", batch="BCE08", student_id_number="S1")
    s9 = make_user("s9@example.com", role="student", batch="BCE09", student_id_number="S9")
    for s in (s1, s9):
        db.session.add(StudentFace(user_id=s.id, embeddings=b"\0" * 512, model_version="t"))
    db.session.commit()
    monkeypatch.setattr(face, "verify", lambda frontal, turned, direction, enrolled: (
        0.9, face.TurnCheck(direction=direction, frontal_yaw=0.0, frames=len(turned), turn=0.3, similarity=0.8)))
    return dict(admin=admin, lecturer=lecturer, other=other, t1=t1, t2=t2, s1=s1, s9=s9)


def _create(client, w, **extra):
    body = {"title": "Online week", "batches": ["BCE08"], "start_date": TODAY.isoformat(),
            "end_date": (TODAY + timedelta(days=6)).isoformat(), "meeting_link": "https://meet.example.com/statics"}
    body.update(extra)
    return client.post(URL, json=body, headers=auth_header(w["admin"]))


def _frames(ticket):
    return {"ticket": ticket, "frontal": (io.BytesIO(b"j"), "f.jpg"), "turned": (io.BytesIO(b"j"), "t.jpg")}


def test_one_week_online_then_back_on_campus_automatically(client, world):
    resp = _create(client, world)
    assert resp.status_code == 201, resp.json
    assert resp.json["status"] == "active" and resp.json["return_date"] == (TODAY + timedelta(days=7)).isoformat()
    OnlineIndex.invalidate()
    assert delivery_mode(world["t1"], TODAY) == "online"
    assert delivery_mode(world["t1"], TODAY + timedelta(days=6)) == "online"
    assert delivery_mode(world["t1"], TODAY + timedelta(days=7)) == "campus"  # nobody has to switch it back
    assert delivery_mode(world["t2"], TODAY) == "campus"  # other classes untouched


def test_student_checks_in_online_without_code_or_location_but_with_face(client, world):
    _create(client, world)
    h = auth_header(world["s1"])
    resp = client.post("/api/student/checkin/online", json={"timetable_id": world["t1"].id}, headers=h)
    assert resp.status_code == 200, resp.json
    assert resp.json["steps"] == {"code": False, "location": False, "face": True}
    assert resp.json["meeting_link"] == "https://meet.example.com/statics"
    done = client.post("/api/student/checkin/complete", data=_frames(resp.json["ticket"]), headers=h)
    assert done.status_code == 200, done.json
    record = StudentAttendance.query.filter_by(student_id=world["s1"].id).one()
    assert record.checkin_method == "online" and record.checkin_lat is None
    # Duplicate protection is unchanged.
    again = client.post("/api/student/checkin/online", json={"timetable_id": world["t1"].id}, headers=h)
    assert again.status_code == 409 and again.json["reason"] == "already_checked_in"


def test_face_mismatch_still_refuses_online(client, world, monkeypatch):
    _create(client, world)
    monkeypatch.setattr(face, "verify", lambda frontal, turned, direction, enrolled: (
        0.1, face.TurnCheck(direction=direction, frontal_yaw=0.0, frames=1, turn=0.3, similarity=0.8)))
    h = auth_header(world["s1"])
    ticket = client.post("/api/student/checkin/online", json={"timetable_id": world["t1"].id}, headers=h).json["ticket"]
    assert client.post("/api/student/checkin/complete", data=_frames(ticket), headers=h).status_code == 403
    assert StudentAttendance.query.filter(StudentAttendance.checkin_at.isnot(None)).count() == 0


def test_other_classes_and_campus_sessions_cannot_use_online_check_in(client, world):
    _create(client, world)
    # s9 is not in BCE08.
    resp = client.post("/api/student/checkin/online", json={"timetable_id": world["t1"].id}, headers=auth_header(world["s9"]))
    assert resp.status_code == 403 and resp.json["reason"] == "wrong_batch"
    # Surveying (BCE09) is on campus: no online check-in.
    resp = client.post("/api/student/checkin/online", json={"timetable_id": world["t2"].id}, headers=auth_header(world["s9"]))
    assert resp.status_code == 409 and resp.json["reason"] == "not_online"


def test_online_ticket_cannot_be_reused_for_another_class(client, world):
    _create(client, world)
    ticket = client.post("/api/student/checkin/online", json={"timetable_id": world["t1"].id},
                         headers=auth_header(world["s1"])).json["ticket"]
    data = load_ticket(ticket, world["s1"].id)
    assert data["t"] == world["t1"].id and data["m"] == "online"
    # Another student cannot use it.
    assert client.post("/api/student/checkin/complete", data=_frames(ticket), headers=auth_header(world["s9"])).status_code in (400, 403)


def test_lecturer_checks_in_without_campus_code_when_all_classes_are_online(client, world):
    _create(client, world, batches=None, lecturer_id=world["lecturer"].id)
    resp = client.post("/api/attendance/checkin", json={}, headers=auth_header(world["lecturer"]))
    assert resp.status_code == 200, resp.json
    assert resp.json["checkin_mode"] == "online"
    # The other lecturer is on campus and still needs the code.
    resp = client.post("/api/attendance/checkin", json={}, headers=auth_header(world["other"]))
    assert resp.status_code == 403


def test_affected_lecturers_and_students_are_told(client, world):
    _create(client, world)
    s1 = Notification.query.filter_by(user_id=world["s1"].id).all()
    assert len(s1) == 1 and s1[0].title == "Classes move online" and "face is still checked" in s1[0].message
    assert Notification.query.filter_by(user_id=world["lecturer"].id).count() == 1
    assert Notification.query.filter_by(user_id=world["s9"].id).count() == 0


def test_end_early_keeps_past_online_sessions(client, world):
    arr_id = _create(client, world, start_date=(TODAY + timedelta(days=1)).isoformat()).json["id"]
    a = db.session.get(OnlineArrangement, arr_id)
    a.start_date = TODAY - timedelta(days=3)  # pretend it started three days ago
    db.session.commit()
    h = auth_header(world["admin"])
    assert client.post(f"{URL}/{arr_id}/cancel", json={"reason": "x"}, headers=h).status_code == 409  # started: no cancel
    assert client.post(f"{URL}/{arr_id}/end", json={"return_date": (TODAY - timedelta(days=1)).isoformat()},
                       headers=h).status_code == 400  # not in the past
    resp = client.post(f"{URL}/{arr_id}/end", json={"return_date": (TODAY + timedelta(days=2)).isoformat()}, headers=h)
    assert resp.status_code == 200 and resp.json["status"] == "active" and resp.json["actual_end_date"] == (TODAY + timedelta(days=1)).isoformat()
    OnlineIndex.invalidate()
    assert delivery_mode(world["t1"], TODAY - timedelta(days=2)) == "online"  # history unchanged
    assert delivery_mode(world["t1"], TODAY + timedelta(days=2)) == "campus"
    assert [e["action"] for e in resp.json["events"]][0] == "ended_early"
    titles = [n.title for n in Notification.query.filter_by(user_id=world["s1"].id).all()]
    assert "Back to campus teaching" in titles


def test_started_arrangements_only_change_their_end(client, world):
    arr_id = _create(client, world).json["id"]
    h = auth_header(world["admin"])
    assert client.put(f"{URL}/{arr_id}", json={"batches": ["BCE09"]}, headers=h).status_code == 409
    resp = client.put(f"{URL}/{arr_id}", json={"end_date": (TODAY + timedelta(days=13)).isoformat()}, headers=h)
    assert resp.status_code == 200 and resp.json["events"][0]["action"] == "extended"
    assert client.put(f"{URL}/{arr_id}", json={"end_date": (TODAY - timedelta(days=1)).isoformat()}, headers=h).status_code in (400, 409)


def test_future_arrangement_can_be_cancelled(client, world):
    arr_id = _create(client, world, start_date=(TODAY + timedelta(days=7)).isoformat(),
                     end_date=(TODAY + timedelta(days=20)).isoformat()).json["id"]
    h = auth_header(world["admin"])
    assert client.post(f"{URL}/{arr_id}/cancel", json={}, headers=h).status_code == 400  # reason required
    resp = client.post(f"{URL}/{arr_id}/cancel", json={"reason": "Campus reopened"}, headers=h)
    assert resp.json["status"] == "cancelled"
    OnlineIndex.invalidate()
    assert delivery_mode(world["t1"], TODAY + timedelta(days=8)) == "campus"


def test_validation_and_conflicts(client, world):
    h = auth_header(world["admin"])
    assert _create(client, world, batches=None).status_code == 400  # nothing chosen
    assert _create(client, world, start_date=(TODAY - timedelta(days=1)).isoformat()).status_code == 400
    assert _create(client, world, meeting_link="javascript:alert(1)").status_code == 400
    assert _create(client, world).status_code == 201
    clash = client.post(URL, json={"timetable_ids": [world["t1"].id], "start_date": (TODAY + timedelta(days=2)).isoformat(),
                                   "end_date": (TODAY + timedelta(days=3)).isoformat()}, headers=h)
    assert clash.status_code == 409


def test_single_session_online(client, world):
    tomorrow = TODAY + timedelta(days=1)
    resp = _create(client, world, batches=None, timetable_ids=[world["t2"].id], start_date=tomorrow.isoformat(),
                   end_date=tomorrow.isoformat())
    assert resp.status_code == 201 and resp.json["affected"]["total_sessions"] == 1


def test_needs_permission(client, world):
    assert client.post(URL, json={}, headers=auth_header(world["lecturer"])).status_code == 403
    assert client.get(URL, headers=auth_header(world["s1"])).status_code == 403


def test_reports_mark_online_sessions(client, world):
    _create(client, world)
    from app.utils.attendance_report import lecturer_session_rows

    OnlineIndex.invalidate()
    rows = lecturer_session_rows(TODAY, TODAY)
    modes = {r["course_name"]: r["delivery_mode"] for r in rows}
    assert modes == {"Statics": "online", "Surveying": "campus"}


def test_return_notice_on_the_last_online_day(client, world):
    _create(client, world, end_date=TODAY.isoformat())
    assert send_return_notices() > 0
    assert send_return_notices() == 0  # once
    assert "Back on campus tomorrow" in [n.title for n in Notification.query.filter_by(user_id=world["s1"].id).all()]


def test_my_online_for_students_and_lecturers(client, world):
    _create(client, world)
    mine = client.get("/api/online/mine", headers=auth_header(world["s1"])).json
    assert len(mine) == 1 and mine[0]["classes"] == ["Statics (BCE08)"] and mine[0]["rooms"] == ["R101"]
    assert client.get("/api/online/mine", headers=auth_header(world["s9"])).json == []
