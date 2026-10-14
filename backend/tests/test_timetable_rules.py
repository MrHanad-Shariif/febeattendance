"""Timetable rules: clash prevention (lecturer and room), combined classes,
standard durations and daily periods, and planned/held/remaining sessions."""
from datetime import date, datetime, time, timedelta

import pytest

from app.extensions import db
from app.models import Attendance, Setting, Timetable
from app.utils.timetable_rules import clean_periods, course_sessions, find_clashes
from app.utils.validation import ValidationError
from tests.conftest import auth_header, make_user

URL = "/api/admin/timetable"


def _body(lecturer, **extra):
    body = {"lecturer_id": lecturer.id, "course_name": "Statics", "batch": "BCE08", "room": "R101",
            "days": ["Mon", "Wed"], "start_time": "07:30", "end_time": "09:00"}
    body.update(extra)
    return body


def test_same_lecturer_same_time_is_refused(client, admin, lecturer):
    h = auth_header(admin)
    assert client.post(URL, json=_body(lecturer), headers=h).status_code == 201
    resp = client.post(URL, json=_body(lecturer, course_name="Hydraulics", batch="BCE09", room="R202",
                                       days=["Wed"], start_time="08:00", end_time="10:00"), headers=h)
    assert resp.status_code == 409
    assert "same lecturer" in resp.json["error"] and resp.json["clashes"][0]["days"] == ["Wed"]


def test_same_room_same_time_is_refused(client, admin, lecturer):
    other = make_user("other@example.com")
    h = auth_header(admin)
    client.post(URL, json=_body(lecturer), headers=h)
    resp = client.post(URL, json=_body(other, course_name="Surveying", room="r101 "), headers=h)
    assert resp.status_code == 409 and resp.json["clashes"][0]["clash"] == ["room"]


def test_back_to_back_and_other_days_are_fine(client, admin, lecturer):
    h = auth_header(admin)
    client.post(URL, json=_body(lecturer), headers=h)
    assert client.post(URL, json=_body(lecturer, course_name="B", start_time="09:00", end_time="10:30"), headers=h).status_code == 201
    assert client.post(URL, json=_body(lecturer, course_name="C", days=["Tue"]), headers=h).status_code == 201


def test_combined_class_needs_confirmation(client, admin, lecturer):
    h = auth_header(admin)
    client.post(URL, json=_body(lecturer), headers=h)
    resp = client.post(URL, json=_body(lecturer, batch="BCE09", confirm_combined=True), headers=h)
    assert resp.status_code == 201


def test_editing_into_a_clash_is_refused_but_unrelated_edits_are_not(client, admin, lecturer):
    h = auth_header(admin)
    client.post(URL, json=_body(lecturer), headers=h)
    second = client.post(URL, json=_body(lecturer, course_name="B", days=["Tue"]), headers=h).json
    assert client.put(f"{URL}/{second['id']}", json={"days": ["Mon"]}, headers=h).status_code == 409
    assert client.put(f"{URL}/{second['id']}", json={"note": "Lab group A"}, headers=h).status_code == 200


def test_duration_sets_the_end_time(client, admin, lecturer):
    h = auth_header(admin)
    resp = client.post(URL, json=_body(lecturer, end_time=None, duration_hours=2.5, start_time="11:00"), headers=h)
    assert resp.status_code == 201 and resp.json["end_time"] == "13:30"
    bad = client.post(URL, json=_body(lecturer, course_name="X", days=["Sat"], duration_hours=4), headers=h)
    assert bad.status_code == 400


def test_periods_setting(client, admin):
    assert clean_periods("7:30-9:00, 09:30-11:00") == "07:30-09:00,09:30-11:00"
    for bad in ("", "9-8", "07:30-09:00,08:30-10:00", "morning"):
        with pytest.raises(ValidationError):
            clean_periods(bad)
    h = auth_header(admin)
    assert client.put("/api/admin/settings", json={"timetable_periods": "08:00-09:00,08:30-10:00"}, headers=h).status_code == 400
    assert client.put("/api/admin/settings", json={"timetable_periods": "07:30-09:00,09:30-11:00,11:30-13:00,13:30-15:00"},
                      headers=h).status_code == 200
    periods = client.get("/api/admin/timetable/periods", headers=h).json
    assert len(periods["periods"]) == 4 and periods["periods"][0]["hours"] == 1.5 and periods["durations"] == [1.5, 2, 2.5, 3]


def test_upload_preview_reports_clashes(app):
    from app.utils.timetable_rules import plan_clashes

    classes = [
        {"course": "A", "batch": "BCE08", "days": ["Mon"], "start": time(7, 30), "end": time(9), "room": "R1", "lecturer_id": 1},
        {"course": "B", "batch": "BCE09", "days": ["Mon"], "start": time(8), "end": time(10), "room": "R2", "lecturer_id": 1},
        {"course": "C", "batch": "BCE10", "days": ["Mon"], "start": time(8), "end": time(10), "room": "R3", "lecturer_id": 2},
    ]
    warnings = plan_clashes(classes)
    assert len(warnings) == 1 and "same lecturer" in warnings[0]


def _setting(key, value):
    row = Setting.query.get(key)
    row.value = value
    db.session.commit()


def test_planned_held_and_remaining_sessions(app, lecturer):
    today = date.today()
    start = today - timedelta(days=13)
    _setting("semester_start_date", start.isoformat())
    _setting("semester_end_date", (start + timedelta(days=27)).isoformat())  # 4 weeks
    e = Timetable(lecturer_id=lecturer.id, course_name="Statics", batch="BCE08", days="Sat,Sun,Mon,Tue,Wed,Thu,Fri",
                  start_time=time(7, 30), end_time=time(9, 0))
    db.session.add(e)
    for i in range(1, 14, 2):  # attended every other day before today
        d = today - timedelta(days=i)
        db.session.add(Attendance(lecturer_id=lecturer.id, date=d, scheduled_start=datetime.combine(d, time(7, 30)),
                                  status="on_time", checkin_at=datetime.combine(d, time(7, 25))))
    db.session.commit()
    data = course_sessions(today=today)
    c = data["classes"][0]
    assert c["planned_sessions"] == 28 and c["planned_source"] == "from timetable"
    assert c["held_sessions"] == 7 and c["teaching_hours"] == 10.5
    assert c["missed_sessions"] == c["scheduled_so_far"] - 7 and c["missed_sessions"] in (6, 7)  # today depends on the clock
    assert c["remaining_sessions"] == 28 - c["scheduled_so_far"]
    assert data["courses"][0]["target_sessions"] == 34 and data["courses"][0]["differs_from_target"]
    e.semester_total_sessions = 34
    db.session.commit()
    assert course_sessions(today=today)["classes"][0]["planned_source"] == "set by admin"


@pytest.mark.parametrize("fmt", ["pdf", "xlsx"])
def test_course_sessions_export(client, admin, lecturer, fmt):
    db.session.add(Timetable(lecturer_id=lecturer.id, course_name="Statics", batch="BCE08", days="Mon",
                             start_time=time(7, 30), end_time=time(9, 0)))
    db.session.commit()
    resp = client.get(f"/api/admin/timetable/sessions/export?format={fmt}", headers=auth_header(admin))
    assert resp.status_code == 200 and "FEBE_Course_Sessions_" in resp.headers["Content-Disposition"]


def test_clash_list(client, admin, lecturer):
    db.session.add_all([
        Timetable(lecturer_id=lecturer.id, course_name="A", batch="X", days="Mon", start_time=time(8), end_time=time(10)),
        Timetable(lecturer_id=lecturer.id, course_name="B", batch="Y", days="Mon,Tue", start_time=time(9), end_time=time(11)),
    ])
    db.session.commit()
    rows = client.get("/api/admin/timetable/clashes", headers=auth_header(admin)).json
    assert len(rows) == 1 and rows[0]["days"] == ["Mon"] and rows[0]["clash"] == ["lecturer"]


def test_lecturer_with_history_is_disabled_not_deleted(client, admin, lecturer):
    d = date.today() - timedelta(days=1)
    db.session.add(Attendance(lecturer_id=lecturer.id, date=d, scheduled_start=datetime.combine(d, time(8)), status="on_time"))
    db.session.commit()
    resp = client.delete(f"/api/admin/lecturers/{lecturer.id}", headers=auth_header(admin))
    assert resp.status_code == 409 and "Disable" in resp.json["error"]
    fresh = make_user("fresh@example.com")
    assert client.delete(f"/api/admin/lecturers/{fresh.id}", headers=auth_header(admin)).status_code == 200


def test_student_with_a_reset_token_can_be_deleted(client, admin):
    from app.models import PasswordResetToken

    s = make_user("stu@example.com", role="student")
    db.session.add(PasswordResetToken(user_id=s.id, expires_at=datetime.now() + timedelta(hours=1)))
    db.session.commit()
    assert client.delete(f"/api/admin/students/{s.id}", headers=auth_header(admin)).status_code == 200
