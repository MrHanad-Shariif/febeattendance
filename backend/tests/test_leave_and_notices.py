"""Lecturer leave requests (mandatory reason, review workflow, no
self-approval), leave notifications and countdown, and the class
cancellation notices students get -- only for official absences."""
import io
from datetime import date, timedelta

import pytest

from app.extensions import db
from app.models import ClassNotice, LeaveRequest, LecturerAbsence, Notification
from app.utils.absences import AbsenceIndex
from app.utils.leave import countdown, send_leave_reminders, sync_class_notices
from app.utils.rbac import grant_super_admin
from tests.conftest import auth_header
from tests.test_absences_and_reports import TODAY, _set, world  # noqa: F401 (fixture)

URL = "/api/lecturer/leave-requests"


def _body(**extra):
    body = {"kind": "leave", "reason": "medical_leave", "start_date": (TODAY + timedelta(days=1)).isoformat(),
            "end_date": (TODAY + timedelta(days=3)).isoformat(), "remarks": "Surgery scheduled at the hospital"}
    body.update(extra)
    return body


def _submit(client, lecturer, **extra):
    return client.post(URL, data=_body(**extra), headers=auth_header(lecturer))


def _notes(user, type_=None):
    q = Notification.query.filter_by(user_id=user.id)
    if type_:
        q = q.filter_by(type=type_)
    return q.all()


def test_a_reason_is_mandatory(client, world):
    for remarks in ("", "   ", "sick"):
        resp = _submit(client, world["a"], remarks=remarks)
        assert resp.status_code == 400 and "reason" in resp.json["error"].lower()
    assert LeaveRequest.query.count() == 0


def test_dates_are_validated(client, world):
    assert _submit(client, world["a"], end_date=TODAY.isoformat()).status_code == 400  # end before start
    assert _submit(client, world["a"], start_date=(TODAY - timedelta(days=2)).isoformat()).status_code == 400
    same_day = _submit(client, world["a"], kind="same_day", start_date=(TODAY + timedelta(days=1)).isoformat())
    assert same_day.status_code == 400
    ok = _submit(client, world["a"], kind="same_day", start_date=TODAY.isoformat(), end_date=TODAY.isoformat())
    assert ok.status_code == 201 and ok.json["kind"] == "same_day"


def test_only_own_classes_can_be_chosen(client, world):
    resp = _submit(client, world["a"], timetable_ids=str(world["t3"].id))  # t3 is lecturer B's
    assert resp.status_code == 400


def test_pending_request_cancels_nothing(client, world):
    resp = _submit(client, world["a"])
    assert resp.status_code == 201 and resp.json["status"] == "pending"
    assert LecturerAbsence.query.count() == 0
    sync_class_notices()
    assert ClassNotice.query.count() == 0
    assert _notes(world["s1"]) == []
    assert AbsenceIndex().covering(world["t1"], TODAY + timedelta(days=1)) is None
    assert any("leave request" in n.title.lower() for n in _notes(world["admin"]))  # reviewer told
    assert any("pending review" in (n.message or "") for n in _notes(world["a"]))


def test_overlapping_open_request_is_refused(client, world):
    assert _submit(client, world["a"]).status_code == 201
    resp = _submit(client, world["a"], start_date=(TODAY + timedelta(days=2)).isoformat(),
                   end_date=(TODAY + timedelta(days=5)).isoformat())
    assert resp.status_code == 409


def test_approval_creates_the_absence_and_tells_lecturer_and_students(client, world):
    req_id = _submit(client, world["a"]).json["id"]
    h = auth_header(world["admin"])
    resp = client.post(f"/api/admin/leave-requests/{req_id}/decision", json={"decision": "approve"}, headers=h)
    assert resp.status_code == 200, resp.json
    req = db.session.get(LeaveRequest, req_id)
    assert req.status == "approved" and req.absence is not None
    assert req.absence.created_by_id == world["admin"].id and req.absence.remarks == req.remarks

    # Lecturer A teaches Statics (BCE08) and Hydraulics (BCE09) every day: 3 days x 2 classes.
    notices = ClassNotice.query.filter_by(status="cancelled").all()
    assert len(notices) == 6 and {n.course_name for n in notices} == {"Statics", "Hydraulics"}
    s1 = [n for n in _notes(world["s1"], "class_notice")]
    s9 = [n for n in _notes(world["s9"], "class_notice")]
    assert len(s1) == 1 and "Statics" in s1[0].title and "not be marked absent" in s1[0].message
    assert len(s9) == 1 and "Hydraulics" in s9[0].title
    assert any(n.title == "Your leave request was approved" for n in _notes(world["a"], "leave"))

    # Running the sweep again does not announce anything twice.
    assert sync_class_notices()["notified"] == 0
    assert len(_notes(world["s1"], "class_notice")) == 1
    assert AbsenceIndex().covering(world["t1"], TODAY + timedelta(days=2)) is not None


def test_reject_and_more_info_need_a_comment(client, world):
    req_id = _submit(client, world["a"]).json["id"]
    h = auth_header(world["admin"])
    for decision in ("reject", "more_info"):
        assert client.post(f"/api/admin/leave-requests/{req_id}/decision", json={"decision": decision}, headers=h).status_code == 400
    resp = client.post(f"/api/admin/leave-requests/{req_id}/decision",
                       json={"decision": "more_info", "comment": "Please attach the hospital letter"}, headers=h)
    assert resp.json["status"] == "more_info"
    # The lecturer adds the document and resubmits.
    resp = client.put(f"{URL}/{req_id}", data={**_body(), "document": (io.BytesIO(b"%PDF-1.4 letter"), "letter.pdf")},
                      headers=auth_header(world["a"]))
    assert resp.status_code == 200 and resp.json["status"] == "pending" and resp.json["document_name"] == "letter.pdf"
    resp = client.post(f"/api/admin/leave-requests/{req_id}/decision",
                       json={"decision": "reject", "comment": "Not enough cover this week"}, headers=h)
    assert resp.json["status"] == "rejected" and LecturerAbsence.query.count() == 0
    assert [e["action"] for e in resp.json["events"]] == ["submitted", "more_info", "resubmitted", "rejected"]
    assert client.put(f"{URL}/{req_id}", data=_body(), headers=auth_header(world["a"])).status_code == 409


def test_lecturers_cannot_approve_their_own_request(client, world):
    grant_super_admin(world["a"])  # even with every permission
    req_id = _submit(client, world["a"]).json["id"]
    resp = client.post(f"/api/admin/leave-requests/{req_id}/decision", json={"decision": "approve"},
                       headers=auth_header(world["a"]))
    assert resp.status_code == 403 and LecturerAbsence.query.count() == 0


def test_lecturer_only_sees_and_changes_own_requests(client, world):
    req_id = _submit(client, world["a"]).json["id"]
    assert client.post(f"{URL}/{req_id}/withdraw", headers=auth_header(world["b"])).status_code == 403
    assert client.get(f"/api/leave-requests/{req_id}/document", headers=auth_header(world["b"])).status_code == 403
    assert client.get("/api/admin/leave-requests", headers=auth_header(world["b"])).status_code == 403
    mine = client.get("/api/lecturer/leave", headers=auth_header(world["b"])).json
    assert mine["requests"] == []
    assert client.post(f"{URL}/{req_id}/withdraw", headers=auth_header(world["a"])).json["status"] == "withdrawn"


def _record(client, world, **extra):
    body = {"lecturer_id": world["a"].id, "start_date": TODAY.isoformat(),
            "end_date": (TODAY + timedelta(days=2)).isoformat(), "reason": "official_duty", "remarks": "Conference"}
    body.update(extra)
    resp = client.post("/api/admin/lecturer-absences", json=body, headers=auth_header(world["admin"]))
    assert resp.status_code == 201, resp.json
    return resp.json["id"]


def test_recorded_absence_notifies_lecturer_with_countdown(client, world):
    _record(client, world)
    note = next(n for n in _notes(world["a"], "leave"))
    assert "official duty" in note.title.lower()
    assert "3 days remaining" in note.message
    data = client.get("/api/lecturer/leave", headers=auth_header(world["a"])).json
    assert data["current"]["countdown"]["days_remaining"] == 3 and data["current"]["countdown"]["phase"] == "active"


def test_today_cancellation_is_flagged_for_students(client, world):
    _record(client, world)
    rows = client.get("/api/student/class-notices", headers=auth_header(world["s1"])).json
    assert rows[0]["is_today"] and rows[0]["status"] == "cancelled" and rows[0]["course_name"] == "Statics"
    assert all(r["batch"] == "BCE08" for r in rows)  # s1 never sees BCE09's Hydraulics
    assert "TODAY" in _notes(world["s1"], "class_notice")[0].title


def test_cancelling_the_absence_reinstates_the_classes(client, world):
    absence_id = _record(client, world)
    client.post(f"/api/admin/lecturer-absences/{absence_id}/cancel", json={"reason": "Recorded by mistake"},
                headers=auth_header(world["admin"]))
    assert {n.status for n in ClassNotice.query.all()} == {"reinstated"}
    titles = [n.title for n in _notes(world["s1"], "class_notice")]
    assert len(titles) == 2 and titles[1].startswith("Class will take place")
    assert any(n.title.startswith("Your official duty was cancelled") for n in _notes(world["a"], "leave"))


def test_shortening_the_absence_reinstates_only_the_dropped_days(client, world):
    absence_id = _record(client, world)
    client.put(f"/api/admin/lecturer-absences/{absence_id}", json={"end_date": TODAY.isoformat()},
               headers=auth_header(world["admin"]))
    by_date = {n.date: n.status for n in ClassNotice.query.filter_by(course_name="Statics").all()}
    assert by_date[TODAY] == "cancelled"
    assert by_date[TODAY + timedelta(days=1)] == by_date[TODAY + timedelta(days=2)] == "reinstated"


def test_notices_only_within_the_window(client, world):
    _set("class_notice_days_ahead", "2")
    db.session.commit()
    _record(client, world, end_date=(TODAY + timedelta(days=9)).isoformat())
    assert {n.date for n in ClassNotice.query.all()} == {TODAY, TODAY + timedelta(days=1)}
    # The next day's sweep announces the next session only.
    sync_class_notices(today=TODAY + timedelta(days=1))
    assert TODAY + timedelta(days=2) in {n.date for n in ClassNotice.query.all()}


def test_countdown_counts_calendar_days():
    class A:
        state, actual_end_date = "recorded", None
        start_date, end_date = date(2026, 10, 10), date(2026, 10, 20)

    assert countdown(A, date(2026, 10, 8)) == {**countdown(A, date(2026, 10, 8)), "phase": "upcoming", "starts_in_days": 2, "total_days": 11}
    assert countdown(A, date(2026, 10, 14))["days_remaining"] == 7
    assert countdown(A, date(2026, 10, 20))["days_remaining"] == 1
    assert countdown(A, date(2026, 10, 21))["phase"] == "completed"
    A.end_date = None
    assert countdown(A, date(2026, 10, 14))["ongoing"] is True


def test_leave_ending_reminder_is_sent_once(client, world):
    absence_id = _record(client, world, end_date=(TODAY + timedelta(days=1)).isoformat())  # 2 days remain
    assert send_leave_reminders() == 1
    assert send_leave_reminders() == 0
    assert any("ends soon" in n.title for n in _notes(world["a"], "leave"))
    # Extending the leave allows a new reminder for the new end date.
    client.put(f"/api/admin/lecturer-absences/{absence_id}", json={"end_date": (TODAY + timedelta(days=5)).isoformat()},
               headers=auth_header(world["admin"]))
    assert send_leave_reminders() == 0
    assert send_leave_reminders(today=TODAY + timedelta(days=4)) == 1


def test_leave_request_settings_validate(client, world):
    put = lambda body: client.put("/api/admin/settings", json=body, headers=auth_header(world["admin"])).status_code
    assert put({"leave_reminder_days_before": "-1"}) == 400
    assert put({"class_notice_days_ahead": "0"}) == 400
    assert put({"academic_office_contact": ""}) == 400
    assert put({"leave_reminder_days_before": "0", "class_notice_days_ahead": "21"}) == 200


def test_students_read_their_own_notifications(client, world):
    _record(client, world)
    summary = client.get("/api/notifications/summary", headers=auth_header(world["s1"])).json
    assert summary["class_notice"] == 1 and summary["total"] == 1
    rows = client.get("/api/notifications", headers=auth_header(world["s1"])).json
    assert len(rows) == 1 and rows[0]["type"] == "class_notice"
    lecturer = client.get("/api/notifications/summary", headers=auth_header(world["a"])).json
    assert lecturer["leave"] >= 1 and lecturer["total"] == sum(v for k, v in lecturer.items() if k != "total")


def test_pending_request_has_no_countdown(client, world):
    data = _submit(client, world["a"]).json
    assert data["countdown"] is None
