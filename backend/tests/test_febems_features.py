"""FEBEMS additions: committee secretary and scope of work, the committee
archive (memos, agendas, standard task reports), course catalogue, lecturer
timetable, semester name and class assignments."""
import io
from datetime import datetime, time, timedelta

import pytest

from app.extensions import db
from app.models import (
    ArchiveDocument, Assignment, AssignmentSubmission, Committee, CommitteeMember, Course, FacultyRole, Setting,
    Task, Timetable,
)
from app.utils.rbac import grant_super_admin
from app.utils.settings import get_all_settings
from tests.conftest import auth_header, make_user


def _later(**delta):
    return (datetime.now() + timedelta(**delta)).strftime("%Y-%m-%dT%H:%M")


@pytest.fixture()
def people(app):
    chair = make_user("chair@example.com")
    secretary = make_user("secretary@example.com")
    member = make_user("member@example.com")
    other_chair = make_user("otherchair@example.com")
    dean = make_user("dean@example.com")
    team = make_user("team@example.com")
    admin = make_user("admin@example.com", role="admin")
    grant_super_admin(admin)

    committee = Committee(name="Quality Assurance Committee", chairperson_id=chair.id)
    committee.memberships = [
        CommitteeMember(user_id=chair.id, role="chairperson"),
        CommitteeMember(user_id=secretary.id, role="secretary"),
        CommitteeMember(user_id=member.id, role="member"),
    ]
    other = Committee(name="Laboratory Committee", chairperson_id=other_chair.id)
    other.memberships = [CommitteeMember(user_id=other_chair.id, role="chairperson")]
    db.session.add_all([committee, other])
    db.session.add_all([FacultyRole(user_id=dean.id, role="dean"), FacultyRole(user_id=team.id, role="admin_team")])
    db.session.commit()
    return dict(chair=chair, secretary=secretary, member=member, other_chair=other_chair, dean=dean, team=team,
                admin=admin, committee=committee, other=other)


# ---------- Branding and semester ----------

def test_system_name_and_semester_defaults(app):
    settings = get_all_settings()
    assert settings["site_name"] == "FEBEMS"
    assert settings["semester_name"] == "October 2026 - February 2027"


def test_semester_endpoint(client, people):
    res = client.get("/api/semester", headers=auth_header(people["member"]))
    assert res.get_json()["semester_name"] == "October 2026 - February 2027"


# ---------- Secretary and scope of work ----------

def test_admin_sets_secretary_and_scope_of_work(client, people):
    c = people["other"]
    res = client.put(f"/api/committees/{c.id}", headers=auth_header(people["admin"]),
                     json={"secretary_id": people["member"].id, "scope_of_work": "Maintain all labs."})
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["secretary_name"] == people["member"].name
    assert body["scope_of_work"] == "Maintain all labs."
    assert CommitteeMember.query.filter_by(committee_id=c.id, user_id=people["member"].id).one().role == "secretary"


def test_chairperson_cannot_also_be_secretary(client, people):
    c = people["committee"]
    res = client.put(f"/api/committees/{c.id}", headers=auth_header(people["admin"]),
                     json={"secretary_id": people["chair"].id})
    assert res.status_code == 400


def test_secretary_has_chairperson_permissions(client, people):
    c = people["committee"]
    res = client.post(f"/api/committees/{c.id}/tasks", headers=auth_header(people["secretary"]),
                      json={"title": "Audit", "assigned_to_id": people["member"].id, "deadline": _later(days=2)})
    assert res.status_code == 201, res.get_json()
    res = client.post(f"/api/committees/{c.id}/meetings", headers=auth_header(people["secretary"]),
                      json={"title": "Monthly", "date": _later(days=5)[:10], "agenda": "1. Opening"})
    assert res.status_code == 201, res.get_json()
    assert client.get("/api/tasks?scope=managed", headers=auth_header(people["secretary"])).get_json()
    me = client.get("/api/auth/me", headers=auth_header(people["secretary"])).get_json()
    assert c.id in me["capabilities"]["chaired_committee_ids"]
    assert me["capabilities"]["can_view_archive"] is True
    # An ordinary member still can't.
    res = client.post(f"/api/committees/{c.id}/tasks", headers=auth_header(people["member"]),
                      json={"title": "X", "assigned_to_id": people["member"].id})
    assert res.status_code == 403


# ---------- Archive ----------

def _complete_task(client, people):
    c = people["committee"]
    task_id = client.post(f"/api/committees/{c.id}/tasks", headers=auth_header(people["chair"]),
                          json={"title": "Prepare accreditation file", "assigned_to_id": people["member"].id,
                                "deadline": _later(days=2)}).get_json()["id"]
    res = client.post(f"/api/tasks/{task_id}/complete", headers=auth_header(people["member"]), data={
        "completion_note": "Compiled every course file.",
        "report_outcomes": "File ready for the visit.",
        "report_challenges": "Two course files were missing.",
        "report_recommendations": "Collect files at mid-semester.",
    })
    assert res.status_code == 200, res.get_json()
    return task_id


def test_completing_a_task_files_the_standard_report(client, people, app):
    task_id = _complete_task(client, people)
    doc = ArchiveDocument.query.filter_by(task_id=task_id, category="report").one()
    assert doc.reference_no == f"FEBE/QAC/RPT/{datetime.now().year}/001"
    assert doc.source == "created"
    task = Task.query.get(task_id)
    assert task.report_outcomes == "File ready for the visit."

    # The member who did the work can download their report from the task...
    detail = client.get(f"/api/tasks/{task_id}", headers=auth_header(people["member"])).get_json()
    assert detail["report"]["reference_no"] == doc.reference_no
    pdf = client.get(f"/api/tasks/{task_id}/report", headers=auth_header(people["member"]))
    assert pdf.status_code == 200 and pdf.data.startswith(b"%PDF")
    # ...but can't open the committee archive.
    assert client.get(f"/api/archive/{doc.id}", headers=auth_header(people["member"])).status_code == 403


def test_archive_visibility(client, people):
    _complete_task(client, people)
    c = people["committee"]

    def visible(who):
        res = client.get("/api/archive?category=report", headers=auth_header(people[who]))
        return [d["committee_id"] for d in res.get_json()]

    assert visible("chair") == [c.id]
    assert visible("secretary") == [c.id]
    assert visible("member") == []          # ordinary members: no archive
    assert visible("other_chair") == []     # other committees' officers: not ours
    assert visible("dean") == [c.id]        # Dean, Administration Team and admins see all
    assert visible("team") == [c.id]
    assert visible("admin") == [c.id]
    names = [x["name"] for x in client.get("/api/archive/committees", headers=auth_header(people["other_chair"])).get_json()]
    assert names == ["Laboratory Committee"]


def test_secretary_creates_memo_as_pdf(client, people):
    c = people["committee"]
    res = client.post("/api/archive/memos", headers=auth_header(people["secretary"]), json={
        "committee_id": c.id, "memo_to": "All heads of department", "subject": "Course file deadline",
        "body": "Please submit course files by 15 October 2026 – thank you.",
    })
    assert res.status_code == 201, res.get_json()
    memo = res.get_json()
    assert memo["category"] == "memo" and memo["reference_no"].startswith("FEBE/QAC/MEMO/")
    assert "Secretary" in memo["memo_from"]
    pdf = client.get(memo["url"].replace("/api", "/api", 1), headers=auth_header(people["dean"]))
    assert pdf.status_code == 200 and pdf.data.startswith(b"%PDF")
    # Members and other committees' officers can't write into this archive.
    for who in ("member", "other_chair"):
        res = client.post("/api/archive/memos", headers=auth_header(people[who]),
                          json={"committee_id": c.id, "memo_to": "x", "subject": "x", "body": "x"})
        assert res.status_code == 403


def test_upload_to_archive_and_delete(client, people):
    c = people["committee"]
    res = client.post("/api/archive", headers=auth_header(people["chair"]), data={
        "committee_id": str(c.id), "category": "report", "title": "Annual report",
        "file": (io.BytesIO(b"%PDF-1.4\n%%EOF\n"), "annual.pdf"),
    }, content_type="multipart/form-data")
    assert res.status_code == 201, res.get_json()
    doc_id = res.get_json()["id"]
    assert client.delete(f"/api/archive/{doc_id}", headers=auth_header(people["member"])).status_code == 403
    assert client.delete(f"/api/archive/{doc_id}", headers=auth_header(people["chair"])).status_code == 200


def test_scheduled_meeting_agenda_is_archived(client, people):
    c = people["committee"]
    res = client.post(f"/api/committees/{c.id}/meetings", headers=auth_header(people["chair"]),
                      json={"title": "Accreditation prep", "date": _later(days=3)[:10], "agenda": "1. Opening\n2. Files"})
    meeting_id = res.get_json()["id"]
    doc = ArchiveDocument.query.filter_by(meeting_id=meeting_id).one()
    assert doc.category == "agenda" and doc.source == "created"
    pdf = client.get(f"/api/archive/{doc.id}/document", headers=auth_header(people["secretary"]))
    assert pdf.data.startswith(b"%PDF")


# ---------- Courses and lecturer timetable ----------

def test_admin_course_catalogue_and_lecturer_timetable(client, people):
    lecturer = people["member"]
    res = client.post("/api/admin/course-catalogue", headers=auth_header(people["admin"]), json={
        "code": "CE301", "name": "Structural Analysis", "batch": "BCE08", "credit_hours": 3, "lecturer_id": lecturer.id,
    })
    assert res.status_code == 201, res.get_json()
    assert res.get_json()["semester"] == "October 2026 - February 2027"
    db.session.add(Timetable(lecturer_id=lecturer.id, course_name="Structural Analysis", batch="BCE08",
                             days="Sat,Mon", start_time=time(8, 0), end_time=time(10, 0)))
    db.session.commit()
    tt = client.get("/api/me/timetable", headers=auth_header(lecturer)).get_json()
    assert tt["semester_name"] == "October 2026 - February 2027"
    assert [c["code"] for c in tt["courses"]] == ["CE301"]
    assert tt["entries"][0]["days"] == ["Sat", "Mon"]
    # Lecturers without timetable permissions can't manage the catalogue.
    assert client.post("/api/admin/course-catalogue", headers=auth_header(lecturer),
                       json={"name": "X"}).status_code == 403


# ---------- Assignments ----------

@pytest.fixture()
def course(app):
    lecturer = make_user("lect@example.com")
    db.session.add(Course(name="Hydraulics", batch="BCE08", lecturer_id=lecturer.id))
    db.session.commit()
    s1 = make_user("s1@example.com", role="student", student_id_number="S1", batch="BCE08")
    s2 = make_user("s2@example.com", role="student", student_id_number="S2", batch="BCE08")
    outsider = make_user("s3@example.com", role="student", student_id_number="S3", batch="BAR01")
    return dict(lecturer=lecturer, s1=s1, s2=s2, outsider=outsider)


def _new_assignment(client, course, **extra):
    body = {"course_name": "Hydraulics", "batch": "BCE08", "title": "Lab report 1", "deadline": _later(days=2), **extra}
    return client.post("/api/assignments", headers=auth_header(course["lecturer"]), json=body)


def _upload(client, student, assignment_id, name="work.exe", data=b"MZ\x90\x00binary"):
    return client.post(f"/api/assignments/{assignment_id}/submission", headers=auth_header(student),
                       data={"files": (io.BytesIO(data), name), "note": "My work"}, content_type="multipart/form-data")


def test_lecturer_sets_assignment_only_for_own_class(client, course):
    assert _new_assignment(client, course).status_code == 201
    res = _new_assignment(client, course, batch="BAR01")
    assert res.status_code == 403
    assert _new_assignment(client, course, deadline=_later(hours=-1)).status_code == 400


def test_student_submits_any_file_type_and_lecturer_comments(client, course):
    aid = _new_assignment(client, course).get_json()["id"]
    res = _upload(client, course["s1"], aid)
    assert res.status_code == 201, res.get_json()
    view = res.get_json()
    assert view["submitted"] and view["submission"]["files"][0]["file_name"] == "work.exe"

    # Served strictly as a download.
    file_url = view["submission"]["files"][0]["url"].replace("/api", "/api", 1)
    dl = client.get(file_url, headers=auth_header(course["lecturer"]))
    assert dl.status_code == 200 and dl.mimetype == "application/octet-stream"
    assert "attachment" in dl.headers["Content-Disposition"]
    assert client.get(file_url, headers=auth_header(course["s2"])).status_code == 403

    sub_id = view["submission"]["id"]
    res = client.put(f"/api/assignments/submissions/{sub_id}/comment", headers=auth_header(course["lecturer"]),
                     json={"comment": "Good work, add units to table 2."})
    assert res.status_code == 200
    mine = client.get(f"/api/assignments/{aid}", headers=auth_header(course["s1"])).get_json()
    assert mine["submission"]["lecturer_comment"] == "Good work, add units to table 2."

    roster = client.get(f"/api/assignments/{aid}", headers=auth_header(course["lecturer"])).get_json()["roster"]
    assert {r["student_id"]: r["submitted"] for r in roster} == {course["s1"].id: True, course["s2"].id: False}


def test_other_batch_cannot_see_or_submit(client, course):
    aid = _new_assignment(client, course).get_json()["id"]
    assert client.get(f"/api/assignments/{aid}", headers=auth_header(course["outsider"])).status_code == 403
    assert _upload(client, course["outsider"], aid).status_code == 403
    assert client.get("/api/assignments", headers=auth_header(course["outsider"])).get_json() == []


def test_submissions_close_at_deadline_and_extensions_reopen(client, course):
    aid = _new_assignment(client, course).get_json()["id"]
    assignment = Assignment.query.get(aid)
    assignment.deadline = datetime.now() - timedelta(minutes=1)
    db.session.commit()

    res = _upload(client, course["s1"], aid)
    assert res.status_code == 403 and "closed" in res.get_json()["error"]

    # Extra time for one student only.
    res = client.post(f"/api/assignments/{aid}/extensions", headers=auth_header(course["lecturer"]),
                      json={"student_id": course["s1"].id, "deadline": _later(days=1), "reason": "Medical"})
    assert res.status_code == 201, res.get_json()
    assert _upload(client, course["s1"], aid).status_code == 201
    assert _upload(client, course["s2"], aid).status_code == 403

    # Moving the whole deadline re-opens it for everyone.
    res = client.put(f"/api/assignments/{aid}", headers=auth_header(course["lecturer"]), json={"deadline": _later(days=3)})
    assert res.status_code == 200
    assert _upload(client, course["s2"], aid).status_code == 201
    assert AssignmentSubmission.query.count() == 2


def test_only_owner_manages_assignment(client, course):
    aid = _new_assignment(client, course).get_json()["id"]
    other = make_user("otherlect@example.com")
    assert client.get(f"/api/assignments/{aid}", headers=auth_header(other)).status_code == 403
    assert client.put(f"/api/assignments/{aid}", headers=auth_header(other), json={"title": "x"}).status_code == 403
    assert client.post(f"/api/assignments/{aid}/extensions", headers=auth_header(other),
                       json={"student_id": course["s1"].id, "deadline": _later(days=4)}).status_code == 403


def test_init_db_upgrades_old_site_name_and_descriptions(app):
    from app import _update_renamed_defaults

    db.session.merge(Setting(key="site_name", value="University attendance", description="old"))
    db.session.merge(Setting(key="campus_lat", value="2.1", description="old"))
    db.session.commit()
    _update_renamed_defaults()
    assert Setting.query.get("site_name").value == "FEBEMS"
    lat = Setting.query.get("campus_lat")
    assert lat.value == "2.1" and "student check-ins" in lat.description
