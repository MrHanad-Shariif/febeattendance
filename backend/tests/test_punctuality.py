"""Lecturer late minutes per session, equivalent sessions (90 by default),
Academic Office review, makeup sessions and audited corrections."""
from datetime import date, datetime, time, timedelta

import pytest

from app.extensions import db
from app.models import Attendance, AttendanceCorrection, MakeupSession, Notification, Setting, StudentFace, Timetable
from app.utils.punctuality import lecturer_summary
from tests.conftest import auth_header, make_user

TODAY = date.today()
EVERY_DAY = "Sat,Sun,Mon,Tue,Wed,Thu,Fri"


@pytest.fixture()
def world(app, admin, lecturer):
    t1 = Timetable(lecturer_id=lecturer.id, course_name="Statics", batch="BCE08", room="R101", days=EVERY_DAY,
                   start_time=time(7, 30), end_time=time(9, 0))
    t2 = Timetable(lecturer_id=lecturer.id, course_name="Hydraulics", batch="BCE09", room="R102", days=EVERY_DAY,
                   start_time=time(9, 30), end_time=time(11, 0))
    db.session.add_all([t1, t2])
    student = make_user("s1@example.com", role="student", batch="BCE08")
    s = Setting.query.get("semester_start_date")
    s.value = (TODAY - timedelta(days=30)).isoformat()
    Setting.query.get("semester_end_date").value = (TODAY + timedelta(days=60)).isoformat()
    db.session.commit()
    return dict(admin=admin, lecturer=lecturer, t1=t1, t2=t2, student=student)


def _day(lecturer, days_ago, arrive, status="late"):
    d = TODAY - timedelta(days=days_ago)
    r = Attendance(lecturer_id=lecturer.id, date=d, scheduled_start=datetime.combine(d, time(7, 30)),
                   scheduled_end=datetime.combine(d, time(11, 0)), status=status,
                   checkin_at=datetime.combine(d, arrive) if arrive else None,
                   checkout_at=datetime.combine(d, time(11, 0)) if arrive else None)
    db.session.add(r)
    db.session.commit()
    return r


def test_late_minutes_are_measured_per_session(world):
    _day(world["lecturer"], 1, time(7, 45))  # 15 minutes late for 07:30; already there for 09:30
    _day(world["lecturer"], 2, time(7, 20), "on_time")  # early: 0
    s = lecturer_summary(world["lecturer"].id, TODAY - timedelta(days=2), TODAY - timedelta(days=1))
    assert s["late_minutes"] == 15 and s["late_sessions"] == 1
    assert s["scheduled_sessions"] == 4 and s["conducted_sessions"] == 4
    assert s["equivalent_sessions"] == 0 and not s["needs_review"]


def test_absences_are_not_counted_as_late_minutes(world):
    _day(world["lecturer"], 1, None, "absent")
    s = lecturer_summary(world["lecturer"].id, TODAY - timedelta(days=1), TODAY - timedelta(days=1))
    assert s["late_minutes"] == 0 and s["absences"] == 2


def test_ninety_minutes_make_one_equivalent_session_and_flag_review(client, world):
    for i in range(1, 7):  # 6 days x 15 minutes = 90
        _day(world["lecturer"], i, time(7, 45))
    q = {"period": "range", "from": (TODAY - timedelta(days=6)).isoformat(), "to": (TODAY - timedelta(days=1)).isoformat()}
    data = client.get(f"/api/admin/punctuality/{world['lecturer'].id}", query_string=q, headers=auth_header(world["admin"])).json
    s = data["summary"]
    assert s["late_minutes"] == 90 and s["equivalent_sessions"] == 1 and s["needs_review"]
    assert len(data["sessions"]) == 12 and all("late_minutes" in r for r in data["sessions"])
    # Configurable threshold: 45 minutes -> 2 equivalent sessions.
    client.put("/api/admin/settings", json={"late_minutes_per_equivalent_session": "45"}, headers=auth_header(world["admin"]))
    s = client.get(f"/api/admin/punctuality/{world['lecturer'].id}", query_string=q, headers=auth_header(world["admin"])).json["summary"]
    assert s["equivalent_sessions"] == 2


def test_review_clears_the_flag_and_keeps_the_record(client, world):
    for i in range(1, 7):
        _day(world["lecturer"], i, time(7, 45))
    q = {"period": "range", "from": (TODAY - timedelta(days=6)).isoformat(), "to": (TODAY - timedelta(days=1)).isoformat()}
    h = auth_header(world["admin"])
    assert client.post(f"/api/admin/punctuality/{world['lecturer'].id}/review", query_string=q,
                       json={"decision": "no_action"}, headers=h).status_code == 400  # comment needed
    resp = client.post(f"/api/admin/punctuality/{world['lecturer'].id}/review", query_string=q,
                       json={"decision": "makeup_required", "comment": "One makeup class"}, headers=h)
    assert resp.status_code == 201 and resp.json["late_minutes"] == 90
    s = client.get(f"/api/admin/punctuality/{world['lecturer'].id}", query_string=q, headers=h).json["summary"]
    assert not s["needs_review"] and s["late_minutes"] == 90  # lateness itself is kept
    assert Notification.query.filter_by(user_id=world["lecturer"].id).count() == 1


def test_makeup_session_assign_reschedule_complete(client, world):
    h = auth_header(world["admin"])
    body = {"lecturer_id": world["lecturer"].id, "timetable_id": world["t1"].id,
            "scheduled_date": (TODAY + timedelta(days=3)).isoformat(), "start_time": "14:00", "end_time": "15:30"}
    m = client.post("/api/admin/makeup-sessions", json=body, headers=h)
    assert m.status_code == 201, m.json
    assert m.json["course_name"] == "Statics" and m.json["room"] == "R101"
    titles = [n.title for n in Notification.query.filter_by(user_id=world["student"].id).all()]
    assert titles == ["Makeup class: Statics (BCE08)"]
    resp = client.put(f"/api/admin/makeup-sessions/{m.json['id']}", json={"scheduled_date": (TODAY + timedelta(days=4)).isoformat()}, headers=h)
    assert [x["action"] for x in resp.json["history"]] == ["assigned", "rescheduled"]
    assert "rescheduled to" in Notification.query.filter_by(user_id=world["student"].id).order_by(Notification.id.desc()).first().message
    assert client.post(f"/api/admin/makeup-sessions/{m.json['id']}/complete", json={}, headers=h).status_code == 400  # future
    row = db.session.get(MakeupSession, m.json["id"])
    row.scheduled_date = TODAY
    db.session.commit()
    done = client.post(f"/api/admin/makeup-sessions/{m.json['id']}/complete", json={"note": "Held"}, headers=h).json
    assert done["status"] == "completed"
    assert client.post(f"/api/admin/makeup-sessions/{m.json['id']}/cancel", json={"reason": "x"}, headers=h).status_code == 409


def test_makeup_must_be_one_of_the_lecturers_classes(client, world):
    other = make_user("other@example.com")
    resp = client.post("/api/admin/makeup-sessions", json={"lecturer_id": other.id, "timetable_id": world["t1"].id,
                                                           "scheduled_date": TODAY.isoformat()}, headers=auth_header(world["admin"]))
    assert resp.status_code == 400


def test_correction_recalculates_and_is_audited(client, world):
    r = _day(world["lecturer"], 1, time(8, 10))  # 40 late
    h = auth_header(world["admin"])
    assert client.put(f"/api/admin/attendance/{r.id}/correct", json={"checkin_at": "07:35"}, headers=h).status_code == 400  # reason
    resp = client.put(f"/api/admin/attendance/{r.id}/correct", json={"checkin_at": "07:35", "reason": "Kiosk was offline"}, headers=h)
    assert resp.status_code == 200 and resp.json["status"] == "on_time"
    c = AttendanceCorrection.query.one()
    assert c.old_value["checkin_at"].endswith("08:10") and c.new_value["checkin_at"].endswith("07:35") and c.reason
    s = lecturer_summary(world["lecturer"].id, TODAY - timedelta(days=1), TODAY - timedelta(days=1))
    assert s["late_minutes"] == 5  # recalculated
    client.put(f"/api/admin/attendance/{r.id}/remarks", json={"remarks": "Traffic"}, headers=h)
    assert AttendanceCorrection.query.count() == 2


def test_duplicate_daily_records_are_impossible(world):
    _day(world["lecturer"], 1, time(7, 45))
    with pytest.raises(Exception):
        _day(world["lecturer"], 1, time(7, 50))
    db.session.rollback()


@pytest.mark.parametrize("fmt", ["pdf", "xlsx"])
def test_punctuality_exports(client, world, fmt):
    _day(world["lecturer"], 1, time(7, 45))
    h = auth_header(world["admin"])
    assert client.get(f"/api/admin/punctuality/export?format={fmt}", headers=h).status_code == 200
    resp = client.get(f"/api/admin/punctuality/{world['lecturer'].id}/export?format={fmt}", headers=h)
    assert resp.status_code == 200 and "FEBE_Punctuality_" in resp.headers["Content-Disposition"]


def test_permissions(client, world):
    assert client.get("/api/admin/punctuality", headers=auth_header(world["lecturer"])).status_code == 403
    assert client.post("/api/admin/makeup-sessions", json={}, headers=auth_header(world["student"])).status_code in (401, 403)
