"""Committee archive: memos, meeting agendas and reports in one place.

A committee's archive is open to its chairperson and secretary only (not to
ordinary members, and not to other committees' officers), and to system
admins, the Dean and the Administration Team, who see every committee's.
Memos can be written in the system (rendered to PDF with the standard
FEBEMS template) or uploaded as a file; agendas and reports can be uploaded,
and are also filed automatically when a meeting is scheduled or a task is
completed.
"""
from datetime import date

from flask import jsonify, request

from app.archive import archive_bp
from app.extensions import db
from app.models import ArchiveDocument, Committee, CommitteeMember
from app.utils.archive import next_reference, render_memo
from app.utils.authz import current_user, roles_required
from app.utils.permissions import (
    archive_committee_ids, can_add_to_archive, can_delete_archive_document, can_view_archive, is_admin, require,
)
from app.utils.uploads import delete_document, save_document, save_generated_document, send_document
from app.utils.validation import ValidationError, clean_choice, clean_int, clean_text, parse_iso_date

STAFF_ROLES = ("admin", "lecturer")


def _payload():
    if request.files or request.form:
        return request.form
    return request.get_json(silent=True) or {}


def _doc_dict(doc: ArchiveDocument, user) -> dict:
    data = doc.to_dict()
    data["can_delete"] = can_delete_archive_document(user, doc)
    return data


@archive_bp.get("/archive/committees")
@roles_required(*STAFF_ROLES)
def archive_committees():
    """Committees whose archive the user can open, with document counts."""
    user = current_user()
    ids = archive_committee_ids(user)
    query = Committee.query
    if ids is not None:
        query = query.filter(Committee.id.in_(ids or [-1]))
    committees = query.order_by(Committee.kind.desc(), Committee.name).all()
    counts = {}
    for committee_id, category, n in (
        db.session.query(ArchiveDocument.committee_id, ArchiveDocument.category, db.func.count())
        .group_by(ArchiveDocument.committee_id, ArchiveDocument.category)
    ):
        counts.setdefault(committee_id, {})[category] = n
    return jsonify([
        {
            "id": c.id,
            "name": c.name,
            "kind": c.kind,
            "kind_label": Committee.KIND_LABELS.get(c.kind, c.kind),
            "status": c.status,
            "counts": {cat: counts.get(c.id, {}).get(cat, 0) for cat in ArchiveDocument.CATEGORIES},
            "can_add": can_add_to_archive(user, c),
        }
        for c in committees
    ])


@archive_bp.get("/archive")
@roles_required(*STAFF_ROLES)
def list_archive():
    """?category=memo|agenda|report  &committee_id=  &q=  &from=&to= (document date)."""
    user = current_user()
    args = request.args
    query = ArchiveDocument.query
    ids = archive_committee_ids(user)
    if ids is not None:
        query = query.filter(ArchiveDocument.committee_id.in_(ids or [-1]))
    if args.get("category"):
        query = query.filter(ArchiveDocument.category == clean_choice(args["category"], "category", ArchiveDocument.CATEGORIES))
    if args.get("committee_id"):
        query = query.filter(ArchiveDocument.committee_id == clean_int(args["committee_id"], "committee_id"))
    if args.get("from"):
        query = query.filter(ArchiveDocument.document_date >= parse_iso_date(args["from"], "from"))
    if args.get("to"):
        query = query.filter(ArchiveDocument.document_date <= parse_iso_date(args["to"], "to"))
    if args.get("q"):
        like = f"%{args['q'].strip()[:100]}%"
        query = query.filter(
            ArchiveDocument.title.ilike(like) | ArchiveDocument.reference_no.ilike(like)
            | ArchiveDocument.summary.ilike(like) | ArchiveDocument.body.ilike(like)
        )
    docs = query.order_by(ArchiveDocument.document_date.desc(), ArchiveDocument.id.desc()).all()
    return jsonify([_doc_dict(d, user) for d in docs])


@archive_bp.get("/archive/<int:doc_id>")
@roles_required(*STAFF_ROLES)
def get_archive_document(doc_id):
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_view_archive(user, doc.committee))
    return jsonify(_doc_dict(doc, user))


@archive_bp.get("/archive/<int:doc_id>/document")
@roles_required(*STAFF_ROLES)
def download_archive_document(doc_id):
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_view_archive(user, doc.committee))
    return send_document(doc.file_path, doc.file_name, inline=request.args.get("inline") == "1")


def _committee_for_new(data) -> Committee:
    committee = Committee.query.get_or_404(clean_int(data.get("committee_id"), "Committee", minimum=1) or 0)
    require(can_add_to_archive(current_user(), committee),
            "Only this committee's chairperson or secretary can add to its archive.")
    return committee


def _officer_title(user, committee: Committee) -> str:
    m = CommitteeMember.query.filter_by(committee_id=committee.id, user_id=user.id).first()
    role = CommitteeMember.LABELS.get(m.role) if m and m.role != "member" else ("Administrator" if is_admin(user) else "")
    return f"{user.name}, {role}, {committee.name}" if role else f"{user.name}, {committee.name}"


@archive_bp.post("/archive/memos")
@roles_required(*STAFF_ROLES)
def create_memo():
    """Write a memo in the system; it is rendered to PDF and filed."""
    user = current_user()
    data = request.get_json(silent=True) or {}
    committee = _committee_for_new(data)
    doc_date = parse_iso_date(data.get("document_date"), "Date") if data.get("document_date") else date.today()
    doc = ArchiveDocument(
        committee=committee, category="memo", source="created",
        title=clean_text(data.get("subject"), "Subject", max_len=255, required=True),
        document_date=doc_date,
        memo_to=clean_text(data.get("memo_to"), "To", max_len=500, required=True),
        memo_from=clean_text(data.get("memo_from"), "From", max_len=500) or _officer_title(user, committee),
        memo_cc=clean_text(data.get("memo_cc"), "CC", max_len=500),
        body=clean_text(data.get("body"), "Memo text", max_len=20000, required=True),
        created_by=user,
    )
    doc.reference_no = clean_text(data.get("reference_no"), "Reference", max_len=100) or next_reference(
        committee, "memo", doc_date.year)
    doc.summary = doc.body[:500]
    doc.file_name, doc.file_path = save_generated_document(render_memo(doc), "archive", f"Memo {doc.reference_no}.pdf")
    db.session.add(doc)
    db.session.commit()
    return jsonify(_doc_dict(doc, user)), 201


@archive_bp.post("/archive")
@roles_required(*STAFF_ROLES)
def upload_archive_document():
    """Upload a memo, agenda or report (multipart: committee_id, category,
    title, document_date, reference_no, summary, file)."""
    user = current_user()
    data = _payload()
    committee = _committee_for_new(data)
    category = clean_choice(data.get("category"), "Category", ArchiveDocument.CATEGORIES)
    doc_date = parse_iso_date(data.get("document_date"), "Date") if data.get("document_date") else date.today()
    saved = save_document(request.files.get("file"), "archive")
    if not saved:
        raise ValidationError("Attach the document (PDF, Word, Excel, PowerPoint, PNG or JPG)")
    doc = ArchiveDocument(
        committee=committee, category=category, source="uploaded",
        title=clean_text(data.get("title"), "Title", max_len=255, required=True),
        document_date=doc_date,
        summary=clean_text(data.get("summary"), "Summary", max_len=5000),
        file_name=saved[0], file_path=saved[1], created_by=user,
    )
    doc.reference_no = clean_text(data.get("reference_no"), "Reference", max_len=100) or next_reference(
        committee, category, doc_date.year)
    db.session.add(doc)
    db.session.commit()
    return jsonify(_doc_dict(doc, user)), 201


@archive_bp.delete("/archive/<int:doc_id>")
@roles_required(*STAFF_ROLES)
def delete_archive_document(doc_id):
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_delete_archive_document(user, doc))
    if doc.meeting_id or doc.task_id:
        return jsonify({"error": "Agendas and task reports filed by the system are part of the permanent record."}), 409
    delete_document(doc.file_path)
    db.session.delete(doc)
    db.session.commit()
    return jsonify({"message": "Document removed from the archive"})
