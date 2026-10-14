"""Student profile: own fields only, direct edits vs approved requests,
validation and uniqueness, email confirmation without lock-out, the class
change log, admin corrections and the audit trail."""
import pytest

from app.extensions import db
from app.models import Batch, ProfileChange, ProfileChangeRequest, StudentClassChange, User
from tests.conftest import auth_header, make_user


@pytest.fixture()
def student(app):
    db.session.add_all([Batch(code="BCE08"), Batch(code="BCE09")])
    db.session.commit()
    user = make_user("stu@example.com", role="student", student_id_number="C1190001",
                     batch="BCE08", department="Civil Engineering")
    user.name = "Ahmed Ali"
    db.session.commit()
    return user


def _req(client, student, field, value, reason="Misspelt at registration"):
    return client.post("/api/student/profile/requests", json={"field": field, "new_value": value, "reason": reason},
                       headers=auth_header(student))


def _decide(client, admin, req_id, decision, comment=None):
    return client.post(f"/api/admin/profile-requests/{req_id}/decision", json={"decision": decision, "comment": comment},
                       headers=auth_header(admin))


def test_profile_shows_own_details_and_rules(client, student):
    data = client.get("/api/student/profile", headers=auth_header(student)).json
    assert data["profile"]["student_id_number"] == "C1190001" and data["profile"]["faculty"]
    assert data["self_edit"] == ["phone"] and "email" in data["approval"] and "phone" not in data["approval"]


def test_phone_is_edited_directly_and_audited(client, student):
    h = auth_header(student)
    assert client.put("/api/student/profile", json={"phone": "12ab"}, headers=h).status_code == 400
    resp = client.put("/api/student/profile", json={"phone": "+252 61 5551234"}, headers=h)
    assert resp.status_code == 200 and resp.json["phone"] == "+252 61 5551234"
    change = ProfileChange.query.one()
    assert (change.field, change.old_value, change.new_value, change.source) == ("phone", None, "+252 61 5551234", "self")


def test_sensitive_fields_cannot_be_edited_directly(client, student):
    resp = client.put("/api/student/profile", json={"student_id_number": "C999"}, headers=auth_header(student))
    assert resp.status_code == 403
    assert db.session.get(User, student.id).student_id_number == "C1190001"


def test_requests_need_a_reason_and_valid_unique_values(client, student):
    make_user("taken@example.com", role="student", student_id_number="C1190002")
    assert _req(client, student, "name", "Ahmed Ali Hassan", reason="").status_code == 400
    assert _req(client, student, "email", "not-an-email").status_code == 400
    assert _req(client, student, "email", "taken@example.com").status_code == 409
    assert _req(client, student, "student_id_number", "c1190002").status_code == 409
    assert _req(client, student, "department", "Medicine").status_code == 400
    assert _req(client, student, "batch", "NOPE").status_code == 400
    assert _req(client, student, "study_semester", "15").status_code == 400
    assert _req(client, student, "phone", "+252615551234").status_code == 400  # phone is a direct edit
    assert _req(client, student, "name", "Ahmed Ali").status_code == 400  # unchanged
    assert _req(client, student, "name", "Ahmed Ali Hassan").status_code == 201
    assert _req(client, student, "name", "Ahmed A. Hassan").status_code == 409  # one open request per field


def test_approved_name_change_is_applied_and_audited(client, student, admin):
    req_id = _req(client, student, "name", "Ahmed Ali Hassan").json["id"]
    assert _decide(client, admin, req_id, "approve").json["status"] == "approved"
    assert db.session.get(User, student.id).name == "Ahmed Ali Hassan"
    change = ProfileChange.query.filter_by(field="name").one()
    assert change.source == "request" and change.changed_by_name == admin.name and change.request_id == req_id
    titles = [n["title"] for n in client.get("/api/notifications", headers=auth_header(student)).json]
    assert "Profile updated: Full name" in titles


def test_rejection_needs_a_reason_and_changes_nothing(client, student, admin):
    req_id = _req(client, student, "department", "Architecture").json["id"]
    assert _decide(client, admin, req_id, "reject").status_code == 400
    assert _decide(client, admin, req_id, "reject", "Department changes go through the registrar").json["status"] == "rejected"
    assert db.session.get(User, student.id).department == "Civil Engineering"
    assert _decide(client, admin, req_id, "approve").status_code == 409


def test_class_change_uses_the_class_change_log(client, student, admin):
    req_id = _req(client, student, "batch", "BCE09").json["id"]
    _decide(client, admin, req_id, "approve")
    assert db.session.get(User, student.id).batch == "BCE09"
    log = StudentClassChange.query.one()
    assert (log.old_batch, log.new_batch) == ("BCE08", "BCE09") and f"#{req_id}" in log.reason


def test_email_changes_only_after_confirmation(client, student, admin):
    req_id = _req(client, student, "email", "ahmed.new@example.com").json["id"]
    assert _decide(client, admin, req_id, "approve").json["status"] == "awaiting_confirmation"
    assert db.session.get(User, student.id).email == "stu@example.com"  # can still sign in with the old one
    req = db.session.get(ProfileChangeRequest, req_id)
    assert client.post("/api/auth/confirm-email-change/wrong-token").status_code == 400
    resp = client.post(f"/api/auth/confirm-email-change/{req.confirm_token}")
    assert resp.status_code == 200
    assert db.session.get(User, student.id).email == "ahmed.new@example.com"
    assert db.session.get(ProfileChangeRequest, req_id).status == "approved"
    assert ProfileChange.query.filter_by(field="email").one().old_value == "stu@example.com"


def test_students_only_see_their_own_profile_and_cannot_review(client, student, admin):
    other = make_user("other@example.com", role="student")
    req_id = _req(client, student, "program", "BSc Civil Engineering").json["id"]
    assert client.post(f"/api/student/profile/requests/{req_id}/cancel", headers=auth_header(other)).status_code == 404
    assert _decide(client, student, req_id, "approve").status_code == 403
    assert client.get("/api/admin/profile-requests", headers=auth_header(student)).status_code == 403
    assert client.post(f"/api/student/profile/requests/{req_id}/cancel", headers=auth_header(student)).json["status"] == "cancelled"


def test_admin_corrections_are_audited(client, student, admin):
    resp = client.put(f"/api/admin/students/{student.id}", json={"name": "Ahmed Ali Hassan", "program": "BSc Civil Engineering",
                                                                "study_semester": "3"}, headers=auth_header(admin))
    assert resp.status_code == 200 and resp.json["program"] == "BSc Civil Engineering"
    history = client.get(f"/api/admin/students/{student.id}/profile-history", headers=auth_header(admin)).json
    assert {h["field"] for h in history} == {"name", "program", "study_semester"}
    assert all(h["source"] == "admin" for h in history)


def test_profile_field_settings_are_validated(client, admin):
    put = lambda body: client.put("/api/admin/settings", json=body, headers=auth_header(admin)).status_code
    assert put({"student_profile_self_edit": "phone,shoe_size"}) == 400
    assert put({"student_profile_self_edit": "phone,program"}) == 200
