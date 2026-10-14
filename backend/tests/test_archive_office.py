"""The independent faculty archive: office documents, the four types with
"Other (specify)", draft/issued/archived, confidential records, version
history, duplicate prevention, search, and archiving published minutes."""
import io
import os
from datetime import date

import pytest

from app.extensions import db
from app.models import ArchiveDocument, Committee, CommitteeMember, MeetingMinutes, Permission, Role
from tests.conftest import auth_header, make_user

PDF = b"%PDF-1.4 official letter"


def grant(user, *codes, name=None):
    role = Role(name=name or f"r-{user.id}-{len(codes)}", description="test")
    role.permissions = Permission.query.filter(Permission.code.in_(codes)).all()
    assert len(role.permissions) == len(codes)
    db.session.add(role)
    user.roles.append(role)
    db.session.commit()


@pytest.fixture()
def staff(app):
    registrar = make_user("registrar@example.com")  # files and manages office documents
    grant(registrar, "archive:view", "archive:add", "archive:edit")
    reader = make_user("reader@example.com")
    grant(reader, "archive:view")
    secret = make_user("secret@example.com")
    grant(secret, "archive:view", "archive_confidential:view")
    nobody = make_user("nobody@example.com")
    chair = make_user("chair@example.com")
    committee = Committee(name="Quality Assurance Committee", chairperson_id=chair.id)
    committee.memberships = [CommitteeMember(user_id=chair.id, role="chairperson")]
    db.session.add(committee)
    db.session.commit()
    return dict(registrar=registrar, reader=reader, secret=secret, nobody=nobody, chair=chair, committee=committee)


def upload(client, user, data=PDF, name="letter.pdf", **fields):
    body = {"committee_id": "none", "category": "other", "other_type": "Official letter", "title": "Letter to Ministry",
            "sending_office": "Office of the Dean", "recipient": "Ministry of Education", "tags": "ministry, accreditation",
            "academic_year": "2026/2027", "department": "Civil Engineering", **fields,
            "file": (io.BytesIO(data), name)}
    return client.post("/api/archive", data=body, headers=auth_header(user))


def test_office_document_without_a_committee(client, staff):
    resp = upload(client, staff["registrar"])
    assert resp.status_code == 201, resp.json
    d = resp.json
    assert d["committee_id"] is None and d["type_label"] == "Official letter" and d["status"] == "archived"
    assert d["reference_no"] == f"FEBE/OD/DOC/{date.today().year}/001"  # "Office of the Dean"
    assert d["tags"] == ["ministry", "accreditation"] and d["recipient"] == "Ministry of Education"
    assert [x["id"] for x in client.get("/api/archive", headers=auth_header(staff["reader"])).json] == [d["id"]]
    assert client.get("/api/archive", headers=auth_header(staff["nobody"])).json == []
    assert client.get(f"/api/archive/{d['id']}/document", headers=auth_header(staff["nobody"])).status_code == 403


def test_other_needs_its_type_and_types_are_checked(client, staff):
    assert upload(client, staff["registrar"], other_type="").status_code == 400
    assert upload(client, staff["registrar"], category="poster").status_code == 400
    for category in ("memo", "agenda", "minutes", "report"):
        resp = upload(client, staff["registrar"], data=PDF + category.encode(), category=category, other_type="ignored")
        assert resp.status_code == 201 and resp.json["other_type"] is None


def test_filing_office_documents_needs_permission(client, staff):
    assert upload(client, staff["reader"]).status_code == 403
    assert upload(client, staff["nobody"]).status_code == 403
    # A chairperson still files for their committee as before.
    resp = upload(client, staff["chair"], committee_id=str(staff["committee"].id), category="report")
    assert resp.status_code == 201


def test_duplicates_are_refused(client, staff):
    first = upload(client, staff["registrar"], reference_no="FEBE/DEAN/2026/001")
    assert first.status_code == 201
    same_ref = upload(client, staff["registrar"], data=PDF + b"x", reference_no="febe/dean/2026/001")
    assert same_ref.status_code == 409 and "already used" in same_ref.json["error"]
    same_file = upload(client, staff["registrar"])
    assert same_file.status_code == 409 and "already in the archive" in same_file.json["error"]


def test_confidential_documents_need_the_permission(client, staff):
    doc_id = upload(client, staff["registrar"], confidential="true").json["id"]
    assert client.get("/api/archive", headers=auth_header(staff["reader"])).json == []
    assert client.get(f"/api/archive/{doc_id}", headers=auth_header(staff["reader"])).status_code == 403
    assert client.get(f"/api/archive/{doc_id}", headers=auth_header(staff["secret"])).status_code == 200
    assert client.get(f"/api/archive/{doc_id}", headers=auth_header(staff["registrar"])).status_code == 200  # author


def test_memo_draft_issue_archive_and_versions(client, staff):
    h = auth_header(staff["registrar"])
    resp = client.post("/api/archive/memos", json={
        "committee_id": None, "sending_office": "Academic Office", "memo_to": "Ministry of Higher Education",
        "subject": "Accreditation visit", "body": "The faculty confirms the visit on 3 November.", "status": "draft",
    }, headers=h)
    assert resp.status_code == 201, resp.json
    memo = resp.json
    assert memo["status"] == "draft" and memo["issued_date"] is None and memo["version"] == 1
    assert memo["file_name"] == f"Memo {memo['reference_no'].replace('/', '-')}.pdf"

    edited = client.put(f"/api/archive/{memo['id']}", json={"body": "The faculty confirms the visit on 4 November.",
                                                            "change_note": "Date corrected"}, headers=h).json
    assert edited["version"] == 2
    issued = client.post(f"/api/archive/{memo['id']}/status", json={"status": "issued"}, headers=h).json
    assert issued["status"] == "issued" and issued["issued_date"] == date.today().isoformat()
    archived = client.post(f"/api/archive/{memo['id']}/status", json={"status": "archived"}, headers=h).json
    assert archived["status"] == "archived" and archived["archived_at"]
    assert client.post(f"/api/archive/{memo['id']}/status", json={"status": "draft"}, headers=h).status_code == 409
    assert client.post(f"/api/archive/{memo['id']}/status", json={"status": "issued"}, headers=h).status_code == 409

    detail = client.get(f"/api/archive/{memo['id']}", headers=h).json
    actions = [v["action"] for v in detail["versions"]]
    assert actions == ["archived", "issued", "replaced", "created"]  # newest first
    original = next(v for v in detail["versions"] if v["action"] == "replaced")
    assert "3 November" in original["details"]["body"] and original["note"] == "Date corrected"
    # The original file is still there.
    old = client.get(f"/api/archive/{memo['id']}/versions/{original['id']}/document", headers=h)
    assert old.status_code == 200 and old.data.startswith(b"%PDF")


def test_new_file_keeps_the_original(client, staff, app):
    h = auth_header(staff["registrar"])
    doc = upload(client, staff["registrar"]).json
    resp = client.put(f"/api/archive/{doc['id']}", data={"file": (io.BytesIO(PDF + b" signed"), "signed.pdf")}, headers=h)
    assert resp.status_code == 200 and resp.json["file_name"] == "signed.pdf" and resp.json["version"] == 2
    v = client.get(f"/api/archive/{doc['id']}", headers=h).json["versions"][0]
    assert v["file_name"] == "letter.pdf"
    assert client.get(f"/api/archive/{doc['id']}/versions/{v['id']}/document", headers=h).data == PDF


def test_only_drafts_of_office_documents_can_be_deleted(client, staff):
    h = auth_header(staff["registrar"])
    issued = upload(client, staff["registrar"], status="issued").json
    assert client.delete(f"/api/archive/{issued['id']}", headers=h).status_code == 403
    draft = upload(client, staff["registrar"], data=PDF + b"d", status="draft").json
    assert client.delete(f"/api/archive/{draft['id']}", headers=h).status_code == 200


def test_editing_needs_permission(client, staff):
    doc = upload(client, staff["registrar"]).json
    assert client.put(f"/api/archive/{doc['id']}", json={"title": "x"}, headers=auth_header(staff["reader"])).status_code == 403
    assert client.put(f"/api/archive/{doc['id']}", json={"title": "Letter to the Ministry"},
                      headers=auth_header(staff["registrar"])).json["title"] == "Letter to the Ministry"


def test_search_and_filters(client, staff):
    h = auth_header(staff["reader"])
    upload(client, staff["registrar"])
    upload(client, staff["registrar"], data=PDF + b"2", category="memo", title="Exam timetable memo",
           recipient="All heads of department", tags="exams", academic_year="2025/2026", department="Architecture")
    q = lambda **p: [d["title"] for d in client.get("/api/archive", query_string=p, headers=h).json]
    assert q(q="accreditation") == ["Letter to Ministry"]
    assert q(recipient="heads of department") == ["Exam timetable memo"]
    assert q(category="memo") == ["Exam timetable memo"]
    assert q(academic_year="2026/2027") == ["Letter to Ministry"]
    assert q(department="Architecture") == ["Exam timetable memo"]
    assert q(committee_id="none", tag="exams") == ["Exam timetable memo"]
    assert sorted(q(status="archived")) == ["Exam timetable memo", "Letter to Ministry"]


def test_published_minutes_are_archived_once(client, staff, app):
    folder = os.path.join(app.config["UPLOAD_FOLDER"], "private", "minutes")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "m.pdf"), "wb") as f:
        f.write(PDF)
    minutes = MeetingMinutes(committee_id=staff["committee"].id, title="QA meeting 3", meeting_date=date(2026, 10, 1),
                             file_name="QA minutes.pdf", file_path="private/minutes/m.pdf", visibility="committee")
    db.session.add(minutes)
    db.session.commit()
    h = auth_header(staff["chair"])
    resp = client.post(f"/api/archive/minutes/{minutes.id}", headers=h)
    assert resp.status_code == 201, resp.json
    assert resp.json["category"] == "minutes" and resp.json["reference_no"].startswith("FEBE/QAC/MIN/2026/")
    assert client.post(f"/api/archive/minutes/{minutes.id}", headers=h).status_code == 409
    assert client.post(f"/api/archive/minutes/{minutes.id}", headers=auth_header(staff["nobody"])).status_code == 403
    doc = db.session.get(ArchiveDocument, resp.json["id"])
    assert doc.file_path != minutes.file_path  # its own copy
    assert client.delete(f"/api/archive/{doc.id}", headers=h).status_code == 409


def test_committee_documents_can_be_linked_without_living_only_there(client, staff):
    """An office document may be associated with a committee later, and the
    committee's officers then see it in their archive."""
    doc = upload(client, staff["registrar"]).json
    resp = client.put(f"/api/archive/{doc['id']}", json={"committee_id": staff["committee"].id},
                      headers=auth_header(staff["registrar"]))
    assert resp.json["committee_name"] == "Quality Assurance Committee"
    assert [d["id"] for d in client.get("/api/archive", headers=auth_header(staff["chair"])).json] == [doc["id"]]
