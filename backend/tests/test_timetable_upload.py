"""Timetable upload (one sheet per batch), batch/room lists, one batch's
week with dates, and classes shared by two batches ("BTE13&BEE11")."""
import io
from datetime import date, datetime, time

import openpyxl
import pytest

from app.extensions import db
from app.models import Batch, Course, Room, StudentAttendance, Timetable
from tests.conftest import auth_header, make_user


def workbook(sheets: dict) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


HEADER = ["Day", "Time", "Instructor", "Subject", "ROOM"]


@pytest.fixture()
def lecturers(app):
    return make_user("a@example.com", name="Abdirahman Hussein Mohamed"), make_user("b@example.com", name="Ali Ismail Gurhan")


def make_user(email, name, role="lecturer", **extra):
    from tests.conftest import make_user as base
    user = base(email, role=role, **extra)
    user.name = name
    db.session.commit()
    return user


def faculty_file(extra_bce08=()):
    return workbook({
        "BCE08": [["Class Name", None, "BCE08"], HEADER,
                  ["Sat", "12:45 PM -14:15 PM", "Abdirahman Hussein Mohamed", "Foundation Engineering", 302.0],
                  [None, "14:15 PM - 15:45 PM", "Abdirahman Hussein Mohamed", "Foundation Engineering", 302.0],
                  [None, "15:45 PM - 17:15 PM", None, None, None],
                  ["Mon", "12:45 PM -14:15 PM", "Ali Ismail Gurhan", "Water Resources Management", 302.0],
                  ["Tue", "12:45 PM -14:15 PM", None, "Research methodology", 302.0],
                  *extra_bce08,
                  ["NB: The time table is subject to change if need arise"]],
        "BTE13&BEE11": [["Class Name", None, "BTE13&BEE11"], HEADER,
                        ["Sun", "7:30 AM - 9:00 AM", "Dr. Someone New", "Arabic II", 301.0]],
        "ROOM MNGT": [["Room", "Capacity"], ["301", 40]],
    })


def upload(client, user, data, path="/api/admin/timetable/upload", **form):
    return client.post(path, headers=auth_header(user), content_type="multipart/form-data",
                       data={"file": (io.BytesIO(data), "timetable.xlsx"), **form})


def test_preview_saves_nothing(client, admin, lecturers):
    res = upload(client, admin, faculty_file(), path="/api/admin/timetable/upload/preview")
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["counts"]["classes"] == 4
    assert body["counts"]["unassigned"] == 2  # no instructor, and an unknown one
    assert body["skipped_sheets"] == ["ROOM MNGT"]
    assert body["unknown_instructors"] == [{"name": "Dr. Someone New", "classes": ["Arabic II (BTE13&BEE11)"]}]
    assert Timetable.query.count() == 0 and Room.query.count() == 0


def test_upload_builds_timetable_and_lists(client, admin, lecturers):
    res = upload(client, admin, faculty_file())
    assert res.status_code == 200, res.get_json()
    foundation = Timetable.query.filter_by(course_name="Foundation Engineering").one()
    assert (foundation.batch, foundation.days, foundation.sessions, foundation.room) == ("BCE08", "Sat", 2, "302")
    assert (foundation.start_time, foundation.end_time) == (time(12, 45), time(15, 45))
    assert foundation.lecturer_id == lecturers[0].id
    arabic = Timetable.query.filter_by(course_name="Arabic II").one()
    assert arabic.lecturer_id is None and "Dr. Someone New" in arabic.note
    assert {r.name for r in Room.query.all()} == {"301", "302"}
    assert {b.code for b in Batch.query.all()} >= {"BCE08", "BTE13&BEE11", "BTE13", "BEE11"}
    assert Course.query.filter_by(name="Water Resources Management", batch="BCE08").one().lecturer_id == lecturers[1].id
    # Students sign up to single batches only.
    assert client.get("/api/auth/batches").get_json() == ["BCE08", "BEE11", "BTE13"]


def test_reupload_replaces_but_keeps_unchanged_rows(client, admin, lecturers):
    upload(client, admin, faculty_file())
    kept_id = Timetable.query.filter_by(course_name="Foundation Engineering").one().id
    gone_id = Timetable.query.filter_by(course_name="Research methodology").one().id
    student = make_user("s@example.com", name="S", role="student", batch="BCE08")
    db.session.add(StudentAttendance(student_id=student.id, timetable_id=kept_id, date=date.today(),
                                     scheduled_start=datetime.now(), status="on_time"))
    db.session.add(StudentAttendance(student_id=student.id, timetable_id=gone_id, date=date.today(),
                                     scheduled_start=datetime.now(), status="absent"))
    db.session.commit()

    smaller = workbook({"BCE08": [HEADER, ["Sat", "12:45 PM -14:15 PM", "Abdirahman Hussein Mohamed", "Foundation Engineering", 302],
                                  [None, "14:15 PM - 15:45 PM", "Abdirahman Hussein Mohamed", "Foundation Engineering", 302]]})
    refused = upload(client, admin, smaller)
    assert refused.status_code == 409 and Timetable.query.count() == 4

    res = upload(client, admin, smaller, delete_history="1")
    assert res.status_code == 200, res.get_json()
    assert [t.id for t in Timetable.query.all()] == [kept_id]
    assert StudentAttendance.query.count() == 1  # the kept class's history survives


def test_bad_files(client, admin):
    assert upload(client, admin, b"not excel").status_code == 400
    empty = workbook({"Sheet": [["hello"]]})
    assert upload(client, admin, empty).status_code == 400


def test_upload_permissions(client, lecturer):
    assert upload(client, lecturer, faculty_file()).status_code == 403


def test_batch_week_has_dates(client, admin, lecturers):
    upload(client, admin, faculty_file())
    res = client.get("/api/admin/timetable/batch-week?batch=BCE08&date=2026-10-14", headers=auth_header(admin))
    body = res.get_json()
    assert body["week_start"] == "2026-10-10" and body["days"][0]["day"] == "Saturday"
    sat = body["days"][0]["classes"]
    assert sat[0]["course_name"] == "Foundation Engineering" and sat[0]["room"] == "302"
    assert body["days"][2]["date"] == "2026-10-12" and body["days"][2]["classes"][0]["lecturer_name"] == "Ali Ismail Gurhan"
    # The shared class shows for each of its batches.
    bte = client.get("/api/admin/timetable/batch-week?batch=BTE13&date=2026-10-14", headers=auth_header(admin)).get_json()
    assert bte["days"][1]["classes"][0]["course_name"] == "Arabic II"


def test_combined_batch_student_sees_shared_class(client, admin, lecturers):
    upload(client, admin, faculty_file())
    student = make_user("bee@example.com", name="Bee", role="student", batch="BEE11")
    res = client.get("/api/student/timetable", headers=auth_header(student))
    assert res.status_code == 200
    body = res.get_json()
    rows = body if isinstance(body, list) else body.get("entries", body.get("classes", []))
    assert any(r["course_name"] == "Arabic II" for r in rows)


def test_batches_and_rooms_crud(client, admin):
    assert client.post("/api/admin/rooms", headers=auth_header(admin), json={"name": "Lab 1", "capacity": 30}).status_code == 201
    assert client.post("/api/admin/rooms", headers=auth_header(admin), json={"name": "lab 1"}).status_code == 409
    room = client.get("/api/admin/rooms", headers=auth_header(admin)).get_json()[0]
    assert client.put(f"/api/admin/rooms/{room['id']}", headers=auth_header(admin), json={"name": "Lab 2"}).get_json()["name"] == "Lab 2"

    res = client.post("/api/admin/batches", headers=auth_header(admin), json={"code": "bce15", "department": "Civil"})
    assert res.status_code == 201 and res.get_json()["code"] == "BCE15"
    db.session.add(Timetable(course_name="X", batch="BCE15", room="Lab 2", days="Sat", start_time=time(8)))
    db.session.commit()
    batch_id = res.get_json()["id"]
    assert client.delete(f"/api/admin/batches/{batch_id}", headers=auth_header(admin)).status_code == 409
    assert client.delete(f"/api/admin/rooms/{room['id']}", headers=auth_header(admin)).status_code == 409
    # Renaming a batch follows through to the timetable.
    client.put(f"/api/admin/batches/{batch_id}", headers=auth_header(admin), json={"code": "BCE16"})
    assert Timetable.query.one().batch == "BCE16"


def test_class_without_lecturer(client, admin):
    res = client.post("/api/admin/timetable", headers=auth_header(admin), json={
        "course_name": "Surveying", "batch": "BCE08", "days": ["Sat"], "start_time": "08:00", "end_time": "09:30"})
    assert res.status_code == 201 and res.get_json()["lecturer_name"] is None
