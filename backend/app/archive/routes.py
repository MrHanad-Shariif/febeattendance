"""The faculty archive: memos, meeting agendas, meeting minutes, reports and
other official documents, for committees and for offices.

Who sees what (utils/permissions.py):
* a committee's documents: its chairperson and secretary, system admins, the
  Dean and the Administration Team (unchanged), plus anyone with archive:view;
* office documents (no committee): archive:view, and their author;
* confidential documents additionally need archive_confidential:view (the
  author and the committee's own officers keep access).

Documents move draft -> issued -> archived. A memo is written in FEBEMS
(rendered to PDF on the faculty letterhead) or uploaded; anything else is
uploaded, and agendas and task reports are still filed automatically by
meetings and tasks. Published minutes can be archived in one step. Nothing is
overwritten: every change keeps the previous details and file as a version.
Reference numbers and identical files cannot be filed twice.
"""
import hashlib
import os
import shutil
import uuid
from datetime import date

from flask import current_app, jsonify, request

from app.archive import archive_bp
from app.extensions import db
from app.models import ArchiveDocument, ArchiveDocumentVersion, Committee, CommitteeMember, MeetingMinutes, utcnow
from app.utils.archive import next_reference, render_memo
from app.utils.authz import current_user, roles_required
from app.utils.constants import DEPARTMENTS
from app.utils.permissions import (
    archive_committee_ids, can_add_to_archive, can_delete_archive_document, can_edit_archive_document,
    can_file_office_documents, can_view_archive_document, can_view_minutes, is_admin, require,
)
from app.utils.rbac import has_permission
from app.utils.uploads import PRIVATE_DIR, delete_document, save_document, save_generated_document, send_document
from app.utils.validation import ValidationError, clean_choice, clean_int, clean_text, parse_iso_date

STAFF_ROLES = ("admin", "lecturer")
DETAIL_FIELDS = ("title", "reference_no", "category", "other_type", "document_date", "issued_date", "status",
                 "sending_office", "recipient", "department", "prepared_by", "approved_by", "tags", "academic_year",
                 "confidential", "summary", "memo_to", "memo_from", "memo_cc", "body", "committee_id")


def _memo_file_name(doc) -> str:
    # "FEBE/QAC/MEMO/2026/001" would otherwise be cut to "001" as a path.
    return f"Memo {(doc.reference_no or '').replace('/', '-')}.pdf"


def _payload():
    if request.files or request.form:
        return request.form
    return request.get_json(silent=True) or {}


def _doc_dict(doc: ArchiveDocument, user) -> dict:
    data = doc.to_dict()
    data["can_delete"] = can_delete_archive_document(user, doc)
    data["can_edit"] = can_edit_archive_document(user, doc)
    return data


def _details(doc) -> dict:
    out = {}
    for f in DETAIL_FIELDS:
        v = getattr(doc, f)
        out[f] = v.isoformat() if isinstance(v, date) else v
    return out


def _record_version(doc, user, action, note=None):
    doc.versions.append(ArchiveDocumentVersion(
        version=doc.version or 1, action=action, details=_details(doc), note=note,
        actor_id=user.id if user else None, actor_name=user.name if user else None,
    ))


def _sha256(file_storage) -> str | None:
    if not file_storage or not file_storage.filename:
        return None
    h = hashlib.sha256()
    for chunk in iter(lambda: file_storage.stream.read(65536), b""):
        h.update(chunk)
    file_storage.stream.seek(0)
    return h.hexdigest()


def _check_duplicates(reference_no=None, sha=None, exclude_id=None):
    if reference_no:
        q = ArchiveDocument.query.filter(db.func.lower(ArchiveDocument.reference_no) == reference_no.lower())
        if exclude_id:
            q = q.filter(ArchiveDocument.id != exclude_id)
        other = q.first()
        if other:
            raise ValidationError(f"Reference {reference_no} is already used by \"{other.title}\". "
                                  "Each document needs its own reference.", status=409)
    if sha:
        q = ArchiveDocument.query.filter(ArchiveDocument.file_sha256 == sha)
        if exclude_id:
            q = q.filter(ArchiveDocument.id != exclude_id)
        other = q.first()
        if other:
            raise ValidationError(f"This file is already in the archive as {other.reference_no or other.title}.", status=409)


def _clean_meta(data, doc=None) -> dict:
    """The descriptive fields shared by every document type."""
    def get(key, label, max_len):
        if key in data:
            return clean_text(data.get(key), label, max_len=max_len)
        return getattr(doc, key) if doc is not None else None

    out = {
        "sending_office": get("sending_office", "Sending office", 200),
        "recipient": get("recipient", "Recipient", 500),
        "department": get("department", "Department", 100),
        "prepared_by": get("prepared_by", "Prepared by", 200),
        "approved_by": get("approved_by", "Approved by", 200),
        "academic_year": get("academic_year", "Academic year", 20),
    }
    if "tags" in data:
        raw = data.get("tags")
        tags = raw if isinstance(raw, list) else str(raw or "").split(",")
        out["tags"] = ", ".join(dict.fromkeys(t.strip()[:50] for t in tags if t and t.strip()))[:500] or None
    if "confidential" in data:
        out["confidential"] = str(data.get("confidential")).lower() in ("1", "true", "yes", "on")
    if "issued_date" in data:
        out["issued_date"] = parse_iso_date(data["issued_date"], "Issued date") if data.get("issued_date") else None
    return out


def _clean_type(data, doc=None) -> tuple[str, str | None]:
    category = clean_choice(data.get("category") if "category" in data else (doc.category if doc else None),
                            "Document type", ArchiveDocument.CATEGORIES)
    other = clean_text(data.get("other_type") if "other_type" in data else (doc.other_type if doc else None),
                       "Document type", max_len=100)
    if category == "other" and not other:
        raise ValidationError("Say what kind of document it is (e.g. official letter, circular, proposal)")
    return category, (other if category == "other" else None)


def _clean_status(data, default="archived") -> str:
    status = data.get("status") or default
    if status not in ArchiveDocument.STATUSES:
        raise ValidationError("Status must be draft, issued or archived")
    return status


def _apply_status(doc, status):
    doc.status = status
    if status in ("issued", "archived") and not doc.issued_date:
        doc.issued_date = doc.document_date or date.today()
    if status == "archived" and not doc.archived_at:
        doc.archived_at = utcnow()


def _committee_or_office(data, user) -> Committee | None:
    """The committee a new document belongs to, or None for an office document."""
    raw = data.get("committee_id")
    if raw in (None, "", "none", "null"):
        require(can_file_office_documents(user), "You can only file documents for committees you chair.")
        return None
    committee = Committee.query.get_or_404(clean_int(raw, "Committee", minimum=1) or 0)
    require(can_add_to_archive(user, committee) or has_permission(user, "archive:add"),
            "Only this committee's chairperson or secretary can add to its archive.")
    return committee


@archive_bp.get("/archive/committees")
@roles_required(*STAFF_ROLES)
def archive_committees():
    """Committees whose archive the user can open, with document counts."""
    user = current_user()
    ids = None if has_permission(user, "archive:view") else archive_committee_ids(user)
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
            "can_add": can_add_to_archive(user, c) or has_permission(user, "archive:add"),
        }
        for c in committees
    ])


@archive_bp.get("/archive/options")
@roles_required(*STAFF_ROLES)
def archive_options():
    user = current_user()
    years = sorted({y for (y,) in ArchiveDocument.query.with_entities(ArchiveDocument.academic_year).distinct() if y},
                   reverse=True)
    offices = sorted({o for (o,) in ArchiveDocument.query.with_entities(ArchiveDocument.sending_office).distinct() if o})
    return jsonify({
        "categories": [{"value": k, "label": v} for k, v in ArchiveDocument.CATEGORY_LABELS.items()],
        "statuses": [{"value": k, "label": v} for k, v in ArchiveDocument.STATUS_LABELS.items()],
        "departments": DEPARTMENTS,
        "academic_years": years,
        "offices": offices,
        "can_file_office": can_file_office_documents(user),
        "can_view_confidential": has_permission(user, "archive_confidential:view"),
        "can_view_office": has_permission(user, "archive:view"),
    })


@archive_bp.get("/archive")
@roles_required(*STAFF_ROLES)
def list_archive():
    """Filters: category, committee_id (or "none" for office documents), q,
    from/to (document date), status, recipient, department, author,
    academic_year, tag, confidential=1|0."""
    user = current_user()
    args = request.args
    query = ArchiveDocument.query
    if args.get("category"):
        query = query.filter(ArchiveDocument.category == clean_choice(args["category"], "category", ArchiveDocument.CATEGORIES))
    if args.get("committee_id") == "none":
        query = query.filter(ArchiveDocument.committee_id.is_(None))
    elif args.get("committee_id"):
        query = query.filter(ArchiveDocument.committee_id == clean_int(args["committee_id"], "committee_id"))
    if args.get("status"):
        query = query.filter(ArchiveDocument.status == clean_choice(args["status"], "status", ArchiveDocument.STATUSES))
    if args.get("from"):
        query = query.filter(ArchiveDocument.document_date >= parse_iso_date(args["from"], "from"))
    if args.get("to"):
        query = query.filter(ArchiveDocument.document_date <= parse_iso_date(args["to"], "to"))
    if args.get("academic_year"):
        query = query.filter(ArchiveDocument.academic_year == args["academic_year"][:20])
    if args.get("department"):
        query = query.filter(ArchiveDocument.department == args["department"][:100])
    if args.get("confidential") in ("0", "1"):
        query = query.filter(ArchiveDocument.confidential.is_(args["confidential"] == "1"))
    for key, cols in (("recipient", (ArchiveDocument.recipient, ArchiveDocument.memo_to)),
                      ("author", (ArchiveDocument.prepared_by, ArchiveDocument.memo_from)),
                      ("tag", (ArchiveDocument.tags,))):
        if args.get(key):
            like = f"%{args[key].strip()[:100]}%"
            query = query.filter(db.or_(*[c.ilike(like) for c in cols]))
    if args.get("q"):
        like = f"%{args['q'].strip()[:100]}%"
        query = query.filter(db.or_(
            ArchiveDocument.title.ilike(like), ArchiveDocument.reference_no.ilike(like),
            ArchiveDocument.summary.ilike(like), ArchiveDocument.body.ilike(like), ArchiveDocument.tags.ilike(like),
            ArchiveDocument.recipient.ilike(like), ArchiveDocument.memo_to.ilike(like),
            ArchiveDocument.sending_office.ilike(like), ArchiveDocument.other_type.ilike(like),
            ArchiveDocument.prepared_by.ilike(like),
        ))
    docs = query.order_by(ArchiveDocument.document_date.desc(), ArchiveDocument.id.desc()).all()
    return jsonify([_doc_dict(d, user) for d in docs if can_view_archive_document(user, d)])


@archive_bp.get("/archive/<int:doc_id>")
@roles_required(*STAFF_ROLES)
def get_archive_document(doc_id):
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_view_archive_document(user, doc))
    return jsonify({**_doc_dict(doc, user), "versions": [v.to_dict() for v in reversed(doc.versions)]})


@archive_bp.get("/archive/<int:doc_id>/document")
@roles_required(*STAFF_ROLES)
def download_archive_document(doc_id):
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_view_archive_document(user, doc))
    return send_document(doc.file_path, doc.file_name, inline=request.args.get("inline") == "1")


@archive_bp.get("/archive/<int:doc_id>/versions/<int:version_id>/document")
@roles_required(*STAFF_ROLES)
def download_archive_version(doc_id, version_id):
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_view_archive_document(user, doc))
    v = ArchiveDocumentVersion.query.filter_by(id=version_id, document_id=doc.id).first_or_404()
    if not v.file_path:
        raise ValidationError("That version kept the same file", status=404)
    return send_document(v.file_path, v.file_name or "document", inline=request.args.get("inline") == "1")


def _officer_title(user, committee: Committee | None, office: str | None = None) -> str:
    if committee is None:
        return f"{user.name}, {office}" if office else user.name
    m = CommitteeMember.query.filter_by(committee_id=committee.id, user_id=user.id).first()
    role = CommitteeMember.LABELS.get(m.role) if m and m.role != "member" else ("Administrator" if is_admin(user) else "")
    return f"{user.name}, {role}, {committee.name}" if role else f"{user.name}, {committee.name}"


@archive_bp.post("/archive/memos")
@roles_required(*STAFF_ROLES)
def create_memo():
    """Write a memo in the system; it is rendered to PDF and filed as a
    draft, as issued, or straight into the archive (the default)."""
    user = current_user()
    data = request.get_json(silent=True) or {}
    committee = _committee_or_office(data, user)
    meta = _clean_meta(data)
    if committee is None and not meta["sending_office"]:
        raise ValidationError("Say which office the memo is from")
    doc_date = parse_iso_date(data.get("document_date"), "Date") if data.get("document_date") else date.today()
    doc = ArchiveDocument(
        committee=committee, category="memo", source="created",
        title=clean_text(data.get("subject"), "Subject", max_len=255, required=True),
        document_date=doc_date,
        memo_to=clean_text(data.get("memo_to"), "To", max_len=500, required=True),
        memo_from=clean_text(data.get("memo_from"), "From", max_len=500) or _officer_title(user, committee, meta["sending_office"]),
        memo_cc=clean_text(data.get("memo_cc"), "CC", max_len=500),
        body=clean_text(data.get("body"), "Memo text", max_len=20000, required=True),
        created_by=user, updated_by=user, **meta,
    )
    doc.recipient = doc.recipient or doc.memo_to
    doc.prepared_by = doc.prepared_by or user.name
    _apply_status(doc, _clean_status(data))
    doc.reference_no = clean_text(data.get("reference_no"), "Reference", max_len=100) or next_reference(
        committee, "memo", doc_date.year, meta["sending_office"])
    _check_duplicates(doc.reference_no)
    doc.summary = doc.body[:500]
    doc.file_name, doc.file_path = save_generated_document(render_memo(doc), "archive", _memo_file_name(doc))
    _record_version(doc, user, "created")
    db.session.add(doc)
    db.session.commit()
    return jsonify(_doc_dict(doc, user)), 201


@archive_bp.post("/archive")
@roles_required(*STAFF_ROLES)
def upload_archive_document():
    """Upload any document (multipart: committee_id or none, category,
    other_type, title, document_date, reference_no, summary, status, the
    descriptive fields, file)."""
    user = current_user()
    data = _payload()
    committee = _committee_or_office(data, user)
    category, other_type = _clean_type(data)
    meta = _clean_meta(data)
    doc_date = parse_iso_date(data.get("document_date"), "Date") if data.get("document_date") else date.today()
    upload = request.files.get("file")
    sha = _sha256(upload)
    reference_no = clean_text(data.get("reference_no"), "Reference", max_len=100)
    _check_duplicates(reference_no, sha)
    saved = save_document(upload, "archive")
    if not saved:
        raise ValidationError("Attach the document (PDF, Word, Excel, PowerPoint, PNG or JPG)")
    doc = ArchiveDocument(
        committee=committee, category=category, other_type=other_type, source="uploaded",
        title=clean_text(data.get("title"), "Title", max_len=255, required=True),
        document_date=doc_date,
        summary=clean_text(data.get("summary"), "Summary", max_len=5000),
        file_name=saved[0], file_path=saved[1], file_sha256=sha, created_by=user, updated_by=user, **meta,
    )
    _apply_status(doc, _clean_status(data))
    doc.reference_no = reference_no or next_reference(committee, category, doc_date.year, meta["sending_office"])
    _record_version(doc, user, "created")
    db.session.add(doc)
    db.session.commit()
    return jsonify(_doc_dict(doc, user)), 201


def _keep_copy(path: str | None) -> str | None:
    """Copy a stored file, so the archive keeps its own copy."""
    if not path:
        return None
    root = current_app.config["UPLOAD_FOLDER"]
    src = os.path.join(root, path)
    if not os.path.exists(src):
        return None
    rel = f"{PRIVATE_DIR}/archive/{uuid.uuid4().hex}{os.path.splitext(path)[1]}"
    os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
    shutil.copyfile(src, os.path.join(root, rel))
    return rel


def _system_filed(doc) -> bool:
    return bool(doc.meeting_id or doc.task_id or doc.minutes_id)


@archive_bp.put("/archive/<int:doc_id>")
@roles_required(*STAFF_ROLES)
def update_archive_document(doc_id):
    """Edit the details (and, for a memo written in FEBEMS, its text), or
    upload a new file. The previous details and file are kept as a version."""
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_edit_archive_document(user, doc), "You cannot edit this document.")
    data = _payload()
    before = _details(doc)
    old_name, old_path = doc.file_name, doc.file_path

    if "title" in data or "subject" in data:
        doc.title = clean_text(data.get("title") or data.get("subject"), "Title", max_len=255, required=True)
    if "summary" in data:
        doc.summary = clean_text(data.get("summary"), "Summary", max_len=5000)
    if data.get("document_date"):
        doc.document_date = parse_iso_date(data["document_date"], "Date")
    if "reference_no" in data:
        ref = clean_text(data.get("reference_no"), "Reference", max_len=100, required=True)
        _check_duplicates(ref, exclude_id=doc.id)
        doc.reference_no = ref
    if not _system_filed(doc) and ("category" in data or "other_type" in data):
        doc.category, doc.other_type = _clean_type(data, doc)
    if "committee_id" in data and not _system_filed(doc):
        doc.committee = _committee_or_office(data, user)
    for k, v in _clean_meta(data, doc).items():
        setattr(doc, k, v)
    generated_memo = doc.category == "memo" and doc.source == "created"
    if generated_memo:
        for key, label, max_len in (("memo_to", "To", 500), ("memo_from", "From", 500), ("memo_cc", "CC", 500),
                                    ("body", "Memo text", 20000)):
            if key in data:
                setattr(doc, key, clean_text(data.get(key), label, max_len=max_len, required=key in ("memo_to", "body")))
        doc.summary = (doc.body or "")[:500]

    upload = request.files.get("file")
    file_changed = False
    if upload and upload.filename:
        if _system_filed(doc):
            raise ValidationError("Documents filed by the system keep their original file.", status=409)
        sha = _sha256(upload)
        _check_duplicates(sha=sha, exclude_id=doc.id)
        saved = save_document(upload, "archive")
        doc.file_name, doc.file_path, doc.file_sha256 = saved[0], saved[1], sha
        file_changed = True
    elif generated_memo and _details(doc) != before:
        doc.file_name, doc.file_path = save_generated_document(render_memo(doc), "archive", _memo_file_name(doc))
        file_changed = True

    if _details(doc) == before and not file_changed:
        return jsonify(_doc_dict(doc, user))
    # The version row holds the state *before* this change, with its file.
    doc.versions.append(ArchiveDocumentVersion(
        version=doc.version or 1, action="replaced" if file_changed else "edited",
        file_name=old_name if file_changed else None, file_path=old_path if file_changed else None,
        details=before, note=clean_text(data.get("change_note"), "Note", max_len=500),
        actor_id=user.id, actor_name=user.name,
    ))
    doc.version = (doc.version or 1) + 1
    doc.updated_by = user
    db.session.commit()
    return jsonify(_doc_dict(doc, user))


@archive_bp.post("/archive/<int:doc_id>/status")
@roles_required(*STAFF_ROLES)
def change_status(doc_id):
    """draft -> issued -> archived (a draft may also go straight to archived).
    Issued and archived documents cannot go back to draft."""
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    require(can_edit_archive_document(user, doc), "You cannot change this document's status.")
    data = request.get_json(silent=True) or {}
    status = _clean_status(data, default="")
    order = {"draft": 0, "issued": 1, "archived": 2}
    current = doc.status or "archived"
    if order[status] <= order[current]:
        raise ValidationError(f"This document is already {ArchiveDocument.STATUS_LABELS[current].lower()}", status=409)
    before = _details(doc)
    old_name, old_path = doc.file_name, doc.file_path
    if data.get("issued_date"):
        doc.issued_date = parse_iso_date(data["issued_date"], "Issued date")
    _apply_status(doc, status)
    regenerated = doc.category == "memo" and doc.source == "created" and current == "draft"
    if regenerated:
        # The issued memo no longer says DRAFT.
        doc.file_name, doc.file_path = save_generated_document(render_memo(doc), "archive", _memo_file_name(doc))
    doc.versions.append(ArchiveDocumentVersion(
        version=doc.version or 1, action=status, details=before,
        file_name=old_name if regenerated else None, file_path=old_path if regenerated else None,
        note=clean_text(data.get("note"), "Note", max_len=500), actor_id=user.id, actor_name=user.name,
    ))
    doc.version = (doc.version or 1) + 1
    doc.updated_by = user
    db.session.commit()
    return jsonify(_doc_dict(doc, user))


@archive_bp.post("/archive/minutes/<int:minutes_id>")
@roles_required(*STAFF_ROLES)
def archive_minutes(minutes_id):
    """File published meeting minutes in the archive (once). The published
    file is copied, so the archive keeps it even if the minutes change."""
    user = current_user()
    minutes = MeetingMinutes.query.get_or_404(minutes_id)
    require(can_view_minutes(user, minutes))
    require(can_add_to_archive(user, minutes.committee) or has_permission(user, "archive:add"),
            "Only the committee's chairperson or secretary can archive its minutes.")
    existing = ArchiveDocument.query.filter_by(minutes_id=minutes.id).first()
    if existing:
        raise ValidationError(f"These minutes are already archived as {existing.reference_no}.", status=409)
    path = _keep_copy(minutes.file_path)
    if not path:
        raise ValidationError("The published minutes file could not be found", status=404)
    doc = ArchiveDocument(
        committee=minutes.committee, category="minutes", source="created", minutes_id=minutes.id,
        title=minutes.title, document_date=minutes.meeting_date, summary=minutes.summary,
        file_name=minutes.file_name, file_path=path, created_by=user, updated_by=user,
        prepared_by=minutes.uploaded_by.name if minutes.uploaded_by else None,
    )
    doc.issued_date = minutes.published_at.date() if minutes.published_at else minutes.meeting_date
    _apply_status(doc, "archived")
    doc.reference_no = next_reference(minutes.committee, "minutes", minutes.meeting_date.year)
    _record_version(doc, user, "created", note="Archived from the published minutes")
    db.session.add(doc)
    db.session.commit()
    return jsonify(_doc_dict(doc, user)), 201


@archive_bp.delete("/archive/<int:doc_id>")
@roles_required(*STAFF_ROLES)
def delete_archive_document(doc_id):
    user = current_user()
    doc = ArchiveDocument.query.get_or_404(doc_id)
    if _system_filed(doc):
        return jsonify({"error": "Agendas, minutes and task reports filed by the system are part of the permanent record."}), 409
    require(can_delete_archive_document(user, doc), "Issued documents are part of the record and cannot be deleted.")
    paths = [doc.file_path] + [v.file_path for v in doc.versions if v.file_path]
    db.session.delete(doc)
    db.session.commit()
    for p in paths:
        delete_document(p)
    return jsonify({"message": "Document removed from the archive"})
