"""Per-session class codes/QR tokens, the step-by-step student check-in and
face enrollment. The face engine itself is stubbed: these tests cover the
rules around it, not OpenCV."""
import io
from datetime import date, datetime, time, timedelta

import numpy as np
import pytest

from app.extensions import db
from app.models import FaceCheckAttempt, StudentAttendance, StudentFace, Timetable
from app.utils import face
from app.utils.checkin_session import make_session_token
from app.utils.schedule import day_abbr
from app.utils.student_code import current_code
from tests.conftest import auth_header, make_user

CAMPUS = {"lat": 2.032389, "lng": 45.307389}


def _unit(seed: int):
    v = np.random.default_rng(seed).standard_normal(128).astype(np.float32)
    return v / np.linalg.norm(v)


def _entry(lecturer, batch="BCE08", course="Structures"):
    """A class for `batch` that started a few minutes ago (so check-in is on time)."""
    now = datetime.now()
    start = (now - timedelta(minutes=5)).time() if now.time() >= time(0, 5) else time(0, 0)
    end = (now + timedelta(hours=1)).time() if now.time() < time(22, 59) else time(23, 59)
    entry = Timetable(
        lecturer_id=lecturer.id, course_name=course, batch=batch,
        days=day_abbr(date.today()), start_time=start, end_time=end,
    )
    db.session.add(entry)
    db.session.commit()
    return entry


def _student(email="stu@example.com", batch="BCE08", seed=1, enrolled=True, **extra):
    user = make_user(email, role="student", batch=batch, **extra)
    if enrolled:
        db.session.add(StudentFace(user_id=user.id, embeddings=face.pack([_unit(seed)] * 3), model_version="test"))
        db.session.commit()
    return user


def _frames(**fields):
    return {**fields, "frontal": (io.BytesIO(b"jpeg"), "f.jpg"), "turned": (io.BytesIO(b"jpeg"), "t.jpg")}


@pytest.fixture()
def face_score(monkeypatch):
    """Stub face.verify; tests set .value to the similarity it returns."""
    class Score:
        value = 0.9

    monkeypatch.setattr(face, "verify", lambda frontal, turned, direction, enrolled: Score.value)
    return Score


def _through_location(client, user, entry):
    headers = auth_header(user)
    resp = client.post("/api/student/checkin/start", json={"s": make_session_token(entry.id, date.today())}, headers=headers)
    assert resp.status_code == 200, resp.json
    resp = client.post("/api/student/checkin/code", json={"ticket": resp.json["ticket"], "code": current_code(entry.id, date.today())}, headers=headers)
    assert resp.status_code == 200, resp.json
    resp = client.post("/api/student/checkin/location", json={"ticket": resp.json["ticket"], **CAMPUS}, headers=headers)
    assert resp.status_code == 200, resp.json
    return resp.json["ticket"]


# ---------- per-session codes and QR tokens ----------

def test_each_session_has_its_own_code(app, lecturer):
    a, b = _entry(lecturer), _entry(lecturer, batch="BARE05")
    assert current_code(a.id, date.today()) != current_code(b.id, date.today())
    assert len(current_code(a.id, date.today())) == 6


def test_code_from_another_batch_is_rejected(client, lecturer):
    mine, other = _entry(lecturer), _entry(lecturer, batch="BARE05")
    student = _student()
    start = client.post("/api/student/checkin/start", json={"s": make_session_token(mine.id, date.today())}, headers=auth_header(student))
    resp = client.post("/api/student/checkin/code", json={"ticket": start.json["ticket"], "code": current_code(other.id, date.today())}, headers=auth_header(student))
    assert resp.status_code == 403


def test_qr_of_another_batch_is_refused_professionally(client, lecturer):
    other = _entry(lecturer, batch="BARE05", course="Hydraulics")
    resp = client.post("/api/student/checkin/start", json={"s": make_session_token(other.id, date.today())}, headers=auth_header(_student()))
    assert resp.status_code == 403
    assert resp.json["reason"] == "wrong_batch"
    assert "BARE05" in resp.json["error"] and "your own lecturer" in resp.json["error"]


def test_tampered_session_token_is_rejected(client, lecturer):
    token = make_session_token(_entry(lecturer).id, date.today())
    resp = client.post("/api/student/checkin/start", json={"s": token[:-2] + "xx"}, headers=auth_header(_student()))
    assert resp.status_code == 400


def test_lecturer_only_sees_own_session_code_and_qr(client, lecturer):
    mine = _entry(lecturer)
    theirs = _entry(make_user("other@example.com"), batch="BARE05")
    assert client.get(f"/api/me/class-code?timetable_id={mine.id}", headers=auth_header(lecturer)).json["code"] == current_code(mine.id, date.today())
    assert client.get(f"/api/me/class-code?timetable_id={theirs.id}", headers=auth_header(lecturer)).status_code == 404
    qr = client.get(f"/api/me/class-qr.png?timetable_id={mine.id}", headers=auth_header(lecturer))
    assert qr.status_code == 200 and qr.mimetype == "image/png"
    classes = client.get("/api/me/classes-today", headers=auth_header(lecturer)).json
    assert [c["id"] for c in classes["classes"]] == [mine.id]


# ---------- step-by-step check-in ----------

def test_full_checkin_marks_student_present(client, lecturer, face_score):
    entry, student = _entry(lecturer), _student()
    ticket = _through_location(client, student, entry)
    resp = client.post("/api/student/checkin/complete", data=_frames(ticket=ticket), headers=auth_header(student))
    assert resp.status_code == 200, resp.json
    assert resp.json["status"] == "on_time"
    record = StudentAttendance.query.filter_by(student_id=student.id, timetable_id=entry.id).one()
    assert record.checkin_distance_m is not None

    again = client.post("/api/student/checkin/start", json={"s": make_session_token(entry.id, date.today())}, headers=auth_header(student))
    assert again.status_code == 409


def test_steps_cannot_be_skipped(client, lecturer, face_score):
    entry, student = _entry(lecturer), _student()
    start = client.post("/api/student/checkin/start", json={"s": make_session_token(entry.id, date.today())}, headers=auth_header(student))
    ticket = start.json["ticket"]
    assert client.post("/api/student/checkin/location", json={"ticket": ticket, **CAMPUS}, headers=auth_header(student)).status_code == 400
    assert client.post("/api/student/checkin/complete", data=_frames(ticket=ticket), headers=auth_header(student)).status_code == 400


def test_ticket_is_bound_to_the_student(client, lecturer, face_score):
    entry = _entry(lecturer)
    ticket = _through_location(client, _student(), entry)
    friend = _student("friend@example.com", seed=2)
    resp = client.post("/api/student/checkin/complete", data=_frames(ticket=ticket), headers=auth_header(friend))
    assert resp.status_code == 400


def test_off_campus_location_is_rejected(client, lecturer):
    entry, student = _entry(lecturer), _student()
    start = client.post("/api/student/checkin/start", json={"s": make_session_token(entry.id, date.today())}, headers=auth_header(student))
    code = client.post("/api/student/checkin/code", json={"ticket": start.json["ticket"], "code": current_code(entry.id, date.today())}, headers=auth_header(student))
    resp = client.post("/api/student/checkin/location", json={"ticket": code.json["ticket"], "lat": 2.05, "lng": 45.35}, headers=auth_header(student))
    assert resp.status_code == 403
    assert "outside the campus" in resp.json["error"]


def test_face_mismatch_is_refused_then_locked(client, lecturer, face_score):
    entry, student = _entry(lecturer), _student()
    face_score.value = 0.1
    ticket = _through_location(client, student, entry)
    for remaining in (2, 1, 0):
        resp = client.post("/api/student/checkin/complete", data=_frames(ticket=ticket), headers=auth_header(student))
        assert resp.status_code == 403
        assert "does not match the face registered" in resp.json["error"]
        assert resp.json["attempts_remaining"] == remaining
    resp = client.post("/api/student/checkin/complete", data=_frames(ticket=ticket), headers=auth_header(student))
    assert resp.status_code == 429
    assert FaceCheckAttempt.query.filter_by(student_id=student.id, result="mismatch").count() == 3
    assert StudentAttendance.query.filter_by(student_id=student.id).first() is None


def test_student_without_face_must_enroll_first(client, lecturer):
    entry, student = _entry(lecturer), _student(enrolled=False)
    resp = client.post("/api/student/checkin/start", json={"s": make_session_token(entry.id, date.today())}, headers=auth_header(student))
    assert resp.status_code == 403
    assert resp.json["reason"] == "face_not_enrolled"


def test_face_step_can_be_turned_off(client, lecturer, admin):
    client.put("/api/admin/settings", json={"student_face_verification": "off"}, headers=auth_header(admin))
    entry, student = _entry(lecturer), _student(enrolled=False)
    ticket = _through_location(client, student, entry)
    resp = client.post("/api/student/checkin/complete", data={"ticket": ticket}, headers=auth_header(student))
    assert resp.status_code == 200, resp.json


# ---------- face enrollment ----------

@pytest.fixture()
def enroll_returns(monkeypatch):
    """Stub face.enroll; tests set .embeddings to what it returns."""
    class Result:
        embeddings = [_unit(7)] * 3

    monkeypatch.setattr(face, "enroll", lambda frontal, turned, direction: (Result.embeddings, np.zeros((60, 60, 3), np.uint8)))
    return Result


def _enroll_form(**fields):
    return {
        **fields, "direction": "left",
        "frontal": [(io.BytesIO(b"jpeg"), f"f{i}.jpg") for i in range(3)],
        "turned": (io.BytesIO(b"jpeg"), "t.jpg"),
    }


def test_signed_in_student_enrolls_once(client, enroll_returns):
    student = _student(enrolled=False)
    resp = client.post("/api/student/face", data=_enroll_form(), headers=auth_header(student))
    assert resp.status_code == 201, resp.json
    assert resp.json["user"]["face_enrolled"] is True
    assert client.post("/api/student/face", data=_enroll_form(), headers=auth_header(student)).status_code == 409


def test_same_face_cannot_register_two_accounts(client, enroll_returns):
    _student("first@example.com", seed=7)  # already enrolled with _unit(7)
    second = _student("second@example.com", enrolled=False)
    resp = client.post("/api/student/face", data=_enroll_form(), headers=auth_header(second))
    assert resp.status_code == 409
    assert "another student account" in resp.json["error"]


def test_enroll_right_after_signup_with_token(client, lecturer, enroll_returns):
    _entry(lecturer)
    signup = client.post("/api/auth/register-student", data={
        "name": "New Student", "email": "new@student.test", "password": "long-enough-pass",
        "student_id_number": "S123", "batch": "BCE08", "face_consent": "true",
    })
    assert signup.status_code == 201, signup.json
    resp = client.post("/api/auth/enroll-face", data=_enroll_form(enroll_token=signup.json["enroll_token"]))
    assert resp.status_code == 201, resp.json
    assert StudentFace.query.count() == 1
    assert client.post("/api/auth/enroll-face", data=_enroll_form(enroll_token="forged")).status_code == 400


def test_unreadable_frame_is_rejected():
    with pytest.raises(face.FaceError):
        face._decode(b"<html>not an image</html>")


# ---------- admin ----------

def test_admin_can_reset_a_students_face(client, admin):
    student = _student()
    resp = client.delete(f"/api/admin/students/{student.id}/face", headers=auth_header(admin))
    assert resp.status_code == 200 and resp.json["face_enrolled"] is False
    assert client.delete(f"/api/admin/students/{student.id}/face", headers=auth_header(admin)).status_code == 404
    assert client.delete(f"/api/admin/students/{student.id}/face", headers=auth_header(student)).status_code == 403


def test_face_settings_are_validated(client, admin):
    put = lambda body: client.put("/api/admin/settings", json=body, headers=auth_header(admin)).status_code
    assert put({"student_face_verification": "maybe"}) == 400
    assert put({"face_match_threshold": "1.5"}) == 400
    assert put({"face_max_attempts_per_session": "0"}) == 400
    assert put({"face_match_threshold": "0.45", "face_max_attempts_per_session": "5"}) == 200


def test_admin_can_show_any_sessions_qr_and_code(client, admin, lecturer):
    entry = _entry(lecturer)
    classes = client.get("/api/me/classes-today", headers=auth_header(admin)).json
    assert [c["id"] for c in classes["classes"]] == [entry.id]
    assert client.get(f"/api/me/class-code?timetable_id={entry.id}", headers=auth_header(admin)).json["code"] == current_code(entry.id, date.today())
    assert client.get(f"/api/me/class-qr.png?timetable_id={entry.id}", headers=auth_header(admin)).status_code == 200
