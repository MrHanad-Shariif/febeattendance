"""Committees & task management: server-side permissions, task audit trail,
notifications/email queue, meetings, minutes archive and information sharing."""
import io
from datetime import datetime, timedelta

import pytest

from app.extensions import db
from app.models import (
    Committee, CommitteeMember, EmailOutbox, FacultyRole, InformationPost, Meeting, Notification, Setting, Task,
    TaskEvent,
)
from tests.conftest import auth_header, make_user

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


@pytest.fixture()
def people(app):
    """A committee with a chairperson and two members, a Dean who is NOT on
    it, an Administration Team member, a system admin and a student."""
    chair = make_user("chair@example.com")
    member = make_user("member@example.com")
    other = make_user("other@example.com")
    outsider = make_user("outsider@example.com")
    dean = make_user("dean@example.com")
    team = make_user("team@example.com")
    admin = make_user("admin@example.com", role="admin")
    student = make_user("student@example.com", role="student", student_id_number="S1", batch="B1")

    committee = Committee(name="Laboratory Committee", kind="committee", chairperson_id=chair.id)
    committee.memberships = [
        CommitteeMember(user_id=chair.id, role="chairperson"),
        CommitteeMember(user_id=member.id, role="member"),
        CommitteeMember(user_id=other.id, role="member"),
    ]
    db.session.add(committee)
    db.session.add_all([FacultyRole(user_id=dean.id, role="dean"), FacultyRole(user_id=team.id, role="admin_team")])
    db.session.commit()
    return dict(chair=chair, member=member, other=other, outsider=outsider, dean=dean, team=team,
                admin=admin, student=student, committee=committee)


def _assign(client, people, who="chair", **extra):
    body = {"title": "Prepare lab inventory", "assigned_to_id": people["member"].id,
            "deadline": (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M"), **extra}
    return client.post(f"/api/committees/{people['committee'].id}/tasks", json=body, headers=auth_header(people[who]))


# ---------- Permissions (brief items 35 and 37) ----------

def test_chairperson_can_assign_and_member_is_notified(client, people):
    res = _assign(client, people)
    assert res.status_code == 201, res.get_json()
    task = Task.query.one()
    assert task.assigned_to_id == people["member"].id and task.assigned_by_id == people["chair"].id
    note = Notification.query.filter_by(user_id=people["member"].id).one()
    assert note.type == "task" and note.link == f"/tasks/{task.id}"
    email = EmailOutbox.query.filter_by(user_id=people["member"].id).one()
    assert email.subject == "New Task Assigned – Prepare lab inventory"
    actions = [e.action for e in TaskEvent.query.filter_by(task_id=task.id).order_by(TaskEvent.id)]
    assert actions == ["created", "assigned", "notification_sent"]


def test_member_cannot_assign_tasks(client, people):
    assert _assign(client, people, who="member").status_code == 403
    assert Task.query.count() == 0


def test_dean_is_not_chairperson_of_every_committee(client, people):
    assert _assign(client, people, who="dean").status_code == 403
    assert _assign(client, people, who="admin").status_code == 403


def test_dean_override_is_explicit(client, people):
    db.session.merge(Setting(key="dean_task_override", value="on"))
    db.session.commit()
    assert _assign(client, people, who="dean").status_code == 201


def test_cannot_assign_to_non_member(client, people):
    res = _assign(client, people, assigned_to_id=people["outsider"].id)
    assert res.status_code == 403


def test_chair_of_one_committee_cannot_act_on_another(client, people):
    other = Committee(name="Operational Committee", chairperson_id=people["outsider"].id)
    other.memberships = [CommitteeMember(user_id=people["outsider"].id, role="chairperson"),
                         CommitteeMember(user_id=people["member"].id)]
    db.session.add(other)
    db.session.commit()
    # Laboratory chair targets the Operational committee by changing the id in the URL.
    res = client.post(f"/api/committees/{other.id}/tasks",
                      json={"title": "x", "assigned_to_id": people["member"].id}, headers=auth_header(people["chair"]))
    assert res.status_code == 403
    # ...and cannot edit a task that belongs to it.
    client.post(f"/api/committees/{other.id}/tasks", json={"title": "Op task", "assigned_to_id": people["member"].id},
                headers=auth_header(people["outsider"]))
    op_task = Task.query.filter_by(title="Op task").one()
    res = client.put(f"/api/tasks/{op_task.id}", json={"deadline": "2030-01-01"}, headers=auth_header(people["chair"]))
    assert res.status_code == 403


def test_students_are_locked_out(client, people):
    h = auth_header(people["student"])
    for url in ("/api/committees", "/api/tasks", "/api/meetings", "/api/minutes", "/api/notices",
                "/api/notifications", "/api/reports"):
        assert client.get(url, headers=h).status_code == 403, url


def test_only_admins_manage_committees(client, people):
    body = {"name": "New committee", "chairperson_id": people["chair"].id}
    assert client.post("/api/committees", json=body, headers=auth_header(people["dean"])).status_code == 403
    assert client.post("/api/committees", json=body, headers=auth_header(people["chair"])).status_code == 403
    res = client.post("/api/committees", json=body, headers=auth_header(people["admin"]))
    assert res.status_code == 201
    assert res.get_json()["chairperson_id"] == people["chair"].id
    assert any(m["role"] == "chairperson" for m in res.get_json()["members"])


def test_changing_chairperson_moves_authority(client, people):
    c = people["committee"]
    res = client.put(f"/api/committees/{c.id}", json={"chairperson_id": people["member"].id},
                     headers=auth_header(people["admin"]))
    assert res.status_code == 200
    assert _assign(client, people, who="chair").status_code == 403  # former chair
    res = client.post(f"/api/committees/{c.id}/tasks", json={"title": "t", "assigned_to_id": people["other"].id},
                      headers=auth_header(people["member"]))
    assert res.status_code == 201


def test_one_account_many_roles_in_capabilities(client, people):
    db.session.add(FacultyRole(user_id=people["chair"].id, role="admin_team"))
    db.session.commit()
    caps = client.get("/api/auth/me", headers=auth_header(people["chair"])).get_json()["capabilities"]
    assert caps["is_admin_team"] is True and caps["is_dean"] is False
    assert caps["chaired_committee_ids"] == [people["committee"].id]


def test_committee_visibility(client, people):
    cid = people["committee"].id
    assert client.get(f"/api/committees/{cid}", headers=auth_header(people["member"])).status_code == 200
    assert client.get(f"/api/committees/{cid}", headers=auth_header(people["dean"])).status_code == 200
    assert client.get(f"/api/committees/{cid}", headers=auth_header(people["outsider"])).status_code == 403
    assert client.get("/api/committees?scope=all", headers=auth_header(people["member"])).status_code == 403


# ---------- Task lifecycle + audit trail (item 32) ----------

def test_task_lifecycle_audit_and_completion_notifies_chair(client, people):
    _assign(client, people)
    task = Task.query.one()

    # Chair edits, moves the deadline and reassigns.
    h_chair = auth_header(people["chair"])
    assert client.put(f"/api/tasks/{task.id}", json={"title": "Prepare full lab inventory"}, headers=h_chair).status_code == 200
    assert client.put(f"/api/tasks/{task.id}", json={"deadline": "2031-05-01"}, headers=h_chair).status_code == 200
    assert client.put(f"/api/tasks/{task.id}", json={"assigned_to_id": people["other"].id}, headers=h_chair).status_code == 200

    # The previous assignee can no longer complete it; the new one can, with evidence.
    assert client.post(f"/api/tasks/{task.id}/complete", json={}, headers=auth_header(people["member"])).status_code == 403
    res = client.post(
        f"/api/tasks/{task.id}/complete",
        data={"completion_note": "Done", "files": (io.BytesIO(PDF), "inventory.pdf")},
        headers=auth_header(people["other"]), content_type="multipart/form-data",
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["status"] == "completed" and body["completed_by_name"] == people["other"].name
    assert body["completed_at"] and body["attachments"][0]["file_name"] == "inventory.pdf"

    actions = [e["action"] for e in body["history"]]
    for expected in ("created", "assigned", "edited", "deadline_changed", "reassigned", "file_uploaded", "completed"):
        assert expected in actions, expected
    assert EmailOutbox.query.filter_by(user_id=people["chair"].id, subject="Task Completed – Prepare full lab inventory").count() == 1

    # Evidence is only downloadable by people who can see the task.
    url = body["attachments"][0]["url"]
    assert client.get(url, headers=auth_header(people["chair"])).status_code == 200
    assert client.get(url, headers=auth_header(people["member"])).status_code == 403


def test_member_sees_only_own_tasks_in_committee(client, people):
    _assign(client, people)
    _assign(client, people, title="Other task", assigned_to_id=people["other"].id)
    cid = people["committee"].id
    mine = client.get(f"/api/committees/{cid}/tasks", headers=auth_header(people["member"])).get_json()
    assert [t["title"] for t in mine] == ["Prepare lab inventory"]
    all_tasks = client.get(f"/api/committees/{cid}/tasks", headers=auth_header(people["chair"])).get_json()
    assert len(all_tasks) == 2


def test_deadline_sweep_marks_overdue_once(app, client, people):
    from app.jobs import task_deadline_sweep

    _assign(client, people, deadline="2020-01-01")
    task = Task.query.one()
    assert task.to_dict()["display_status"] == "overdue"
    task_deadline_sweep(app)
    task_deadline_sweep(app)
    assert Notification.query.filter(Notification.title.like("Task overdue%")).count() == 2  # assignee + chair, once


# ---------- Meetings, minutes, information sharing (items 28 and 29) ----------

def _schedule(client, people, who="chair"):
    return client.post(
        f"/api/committees/{people['committee'].id}/meetings",
        data={"title": "Lab review", "date": "2026-10-10", "start_time": "10:00", "end_time": "11:00",
              "location": "Room 5", "agenda": "1. Inventory", "agenda_file": (io.BytesIO(PDF), "agenda.pdf")},
        headers=auth_header(people[who]), content_type="multipart/form-data",
    )


def test_meeting_scheduling_is_for_the_chair(client, people):
    assert _schedule(client, people, who="member").status_code == 403
    assert _schedule(client, people, who="dean").status_code == 403
    res = _schedule(client, people)
    assert res.status_code == 201, res.get_json()
    subjects = {e.subject for e in EmailOutbox.query.all()}
    assert subjects == {"Meeting Scheduled – Lab review"}
    assert EmailOutbox.query.count() == 2  # both members, not the chair who scheduled it
    agenda = res.get_json()["agenda_url"]
    assert client.get(agenda, headers=auth_header(people["member"])).status_code == 200
    assert client.get(agenda, headers=auth_header(people["outsider"])).status_code == 403


def _publish(client, people, meeting_id, who="team", visibility="committee"):
    return client.post(
        "/api/minutes",
        data={"meeting_id": str(meeting_id), "visibility": visibility, "summary": "Inventory approved",
              "file": (io.BytesIO(PDF), "minutes.pdf")},
        headers=auth_header(people[who]), content_type="multipart/form-data",
    )


def test_publishing_minutes_archives_and_shares(client, people):
    meeting_id = _schedule(client, people).get_json()["id"]
    assert _publish(client, people, meeting_id, who="chair").status_code == 403  # not Administration Team
    res = _publish(client, people, meeting_id)
    assert res.status_code == 201, res.get_json()
    minutes = res.get_json()
    assert minutes["published_at"] and minutes["committee_name"] == "Laboratory Committee"

    post = InformationPost.query.filter_by(minutes_id=minutes["id"]).one()
    assert post.category == "meeting_minutes" and post.audience == "committee"
    assert Meeting.query.get(meeting_id).status == "held"
    assert EmailOutbox.query.filter_by(subject="FEBE Meeting Minutes Published – Lab review").count() == 3

    # Committee-only minutes: members yes, outsiders no (list, detail and file).
    assert len(client.get("/api/minutes", headers=auth_header(people["member"])).get_json()) == 1
    assert client.get("/api/minutes", headers=auth_header(people["outsider"])).get_json() == []
    assert client.get(f"/api/minutes/{minutes['id']}/document", headers=auth_header(people["outsider"])).status_code == 403
    assert client.get(f"/api/minutes/{minutes['id']}/document", headers=auth_header(people["member"])).status_code == 200
    # Appears in Information Sharing for members too.
    notices = client.get("/api/notices", headers=auth_header(people["member"])).get_json()
    assert notices[0]["minutes_id"] == minutes["id"]
    assert _publish(client, people, meeting_id).status_code == 409


def test_faculty_minutes_visible_to_all_staff_and_filterable(client, people):
    meeting_id = _schedule(client, people).get_json()["id"]
    _publish(client, people, meeting_id, visibility="faculty")
    h = auth_header(people["outsider"])
    assert len(client.get("/api/minutes", headers=h).get_json()) == 1
    assert len(client.get("/api/minutes?year=2026&kind=committee&q=inventory", headers=h).get_json()) == 1
    assert client.get("/api/minutes?year=2025", headers=h).get_json() == []
    assert client.get("/api/minutes?kind=administration", headers=h).get_json() == []


def test_information_sharing_permissions_and_audience(client, people):
    body = {"title": "Exam timetable", "description": "See attached", "audience": "all_staff"}
    assert client.post("/api/notices", json=body, headers=auth_header(people["member"])).status_code == 403
    res = client.post("/api/notices", json=body, headers=auth_header(people["team"]))
    assert res.status_code == 201
    recipients = {e.user_id for e in EmailOutbox.query.all()}
    assert people["outsider"].id in recipients and people["student"].id not in recipients
    assert people["team"].id not in recipients  # the publisher isn't emailed their own notice
    assert EmailOutbox.query.first().subject == "FEBE Information Sharing – Exam timetable"


# ---------- Notifications + outbox ----------

def test_notification_summary_is_per_user(client, people):
    _assign(client, people)
    summary = client.get("/api/notifications/summary", headers=auth_header(people["member"])).get_json()
    assert summary["task"] == 1 and summary["total"] == 1
    assert client.get("/api/notifications/summary", headers=auth_header(people["other"])).get_json()["total"] == 0
    note_id = Notification.query.filter_by(user_id=people["member"].id).one().id
    # Someone else cannot mark my notification as read.
    client.post("/api/notifications/read", json={"ids": [note_id]}, headers=auth_header(people["other"]))
    assert Notification.query.get(note_id).read_at is None
    client.post("/api/notifications/read", json={"ids": [note_id]}, headers=auth_header(people["member"]))
    assert Notification.query.get(note_id).read_at is not None


def test_outbox_retries_then_fails(app, client, people, monkeypatch):
    from app.utils import email as email_mod
    from app.utils.notify import flush_outbox

    _assign(client, people)
    calls = []

    def boom(subject, recipient, html):
        calls.append(recipient)
        raise RuntimeError("smtp down")

    monkeypatch.setattr(email_mod, "_send", boom)
    for _ in range(3):
        flush_outbox()
    item = EmailOutbox.query.one()
    assert item.status == "failed" and item.attempts == 3
    assert calls == [people["member"].email] * 3


# ---------- Reports ----------

def test_reports_scope(client, people):
    _assign(client, people)
    cid = people["committee"].id
    res = client.get(f"/api/reports/committee_tasks?committee_id={cid}", headers=auth_header(people["chair"]))
    assert res.status_code == 200 and len(res.get_json()["rows"]) == 1
    assert client.get(f"/api/reports/committee_tasks?committee_id={cid}",
                      headers=auth_header(people["member"])).status_code == 403
    assert client.get("/api/reports/faculty_overview", headers=auth_header(people["chair"])).status_code == 403
    overview = client.get("/api/reports/faculty_overview", headers=auth_header(people["dean"]))
    assert overview.status_code == 200 and overview.get_json()["rows"][0]["task_total"] == 1
    csv_res = client.get(f"/api/reports/committee_tasks?committee_id={cid}&format=csv", headers=auth_header(people["chair"]))
    assert csv_res.mimetype == "text/csv" and b"Faculty of Engineering and Built Environment" in csv_res.data


# ---------- Private files ----------

def test_private_documents_not_served_by_generic_uploads_route(client, people):
    for path in ("private/minutes/x.pdf", "./private/minutes/x.pdf", "student_photos/../private/x.pdf"):
        assert client.get(f"/api/uploads/{path}", headers=auth_header(people["admin"])).status_code == 404


def test_rejects_non_document_upload(client, people):
    res = client.post(
        f"/api/committees/{people['committee'].id}/meetings",
        data={"title": "x", "date": "2026-10-10", "agenda_file": (io.BytesIO(b"<script>alert(1)</script>"), "a.pdf")},
        headers=auth_header(people["chair"]), content_type="multipart/form-data",
    )
    assert res.status_code == 400
