"""Committee archive: reference numbers and the documents the system files
by itself -- the standard task report when a member completes a task, and a
meeting's agenda when a meeting is scheduled -- plus generated memos.

Every generated document uses the single template in utils/pdf.py.
"""
import re

from app.extensions import db
from app.models import ArchiveDocument, Committee, Meeting, Task, User, utcnow
from app.utils.pdf import FebeDocument, fmt_date, fmt_datetime
from app.utils.uploads import delete_document, save_generated_document

CATEGORY_CODES = {"memo": "MEMO", "agenda": "AGD", "report": "RPT"}


def committee_code(committee: Committee) -> str:
    """Initials of the committee name, e.g. 'Quality Assurance Committee' -> 'QAC'."""
    words = re.findall(r"[A-Za-z0-9]+", committee.name or "")
    code = "".join(w[0] for w in words if w.lower() not in {"of", "and", "the", "for", "&"}).upper()
    return (code or "COM")[:8]


def next_reference(committee: Committee, category: str, year: int) -> str:
    count = ArchiveDocument.query.filter(
        ArchiveDocument.committee_id == committee.id,
        ArchiveDocument.category == category,
        db.extract("year", ArchiveDocument.document_date) == year,
    ).count()
    return f"FEBE/{committee_code(committee)}/{CATEGORY_CODES[category]}/{year}/{count + 1:03d}"


def _safe_name(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9 _-]+", "", text or "").strip()[:80] or "document"


# ---------- Standard task completion report ----------

def _timeliness(task: Task) -> str:
    if not task.deadline or not task.completed_at:
        return "No deadline set" if not task.deadline else "-"
    if task.completed_at <= task.deadline:
        return "Completed on time"
    late = task.completed_at - task.deadline
    days, hours, minutes = late.days, late.seconds // 3600, (late.seconds % 3600) // 60
    parts = [f"{n} {unit}{'s' if n != 1 else ''}" for n, unit in ((days, "day"), (hours, "hour")) if n]
    return f"Completed late ({' '.join(parts) or f'{minutes} minutes'} after the deadline)"


def render_task_report(task: Task, reference_no: str) -> bytes:
    committee = task.committee
    secretary = committee.secretary.user if committee.secretary else None
    doc = FebeDocument("Task Completion Report", reference_no, committee.name)
    doc.title_band(task.title, task.completed_at)
    doc.details([
        ("Committee", committee.name),
        ("Task", task.title),
        ("Priority", (task.priority or "").capitalize()),
        ("Assigned to", task.assigned_to.name if task.assigned_to else "-"),
        ("Assigned by", task.assigned_by.name if task.assigned_by else "-"),
        ("Date assigned", fmt_datetime(task.assigned_at)),
        ("Deadline", fmt_datetime(task.deadline)),
        ("Date completed", fmt_datetime(task.completed_at)),
        ("Completed by", task.completed_by.name if task.completed_by else "-"),
        ("Timeliness", _timeliness(task)),
    ])
    doc.section("1. Task description", task.description)
    doc.section("2. Work carried out", task.completion_note)
    doc.section("3. Outcomes and results", task.report_outcomes)
    doc.section("4. Challenges encountered", task.report_challenges, "None reported.")
    doc.section("5. Recommendations and next steps", task.report_recommendations, "None.")
    doc.bullet_list(
        "6. Supporting documents",
        [f"{a.file_name} (uploaded {fmt_datetime(a.uploaded_at)})" for a in task.attachments],
        "No supporting documents attached.",
    )
    doc.signatures([
        ("Prepared by (committee member)", task.completed_by.name if task.completed_by else None),
        ("Reviewed by (secretary)", secretary.name if secretary else None),
        ("Approved by (chairperson)", committee.chairperson.name if committee.chairperson else None),
    ])
    return doc.output_bytes()


def file_task_report(task: Task, actor: User) -> ArchiveDocument:
    """Generate the task report and file it (or refresh it, if the task was
    reopened and completed again) in the committee archive."""
    doc = ArchiveDocument.query.filter_by(task_id=task.id, category="report", source="created").first()
    completed = (task.completed_at or utcnow()).date()
    reference_no = doc.reference_no if doc else next_reference(task.committee, "report", completed.year)
    with db.session.no_autoflush:
        name, path = save_generated_document(
            render_task_report(task, reference_no), "archive", f"Task report - {_safe_name(task.title)}.pdf",
        )
    old_path = None
    if doc is None:
        doc = ArchiveDocument(
            committee=task.committee, category="report", source="created", task_id=task.id,
            reference_no=reference_no, created_by_id=actor.id,
        )
        db.session.add(doc)
    else:
        old_path = doc.file_path
    doc.title = f"Task report: {task.title}"[:255]
    doc.document_date = completed
    doc.summary = task.completion_note
    doc.file_name, doc.file_path = name, path
    delete_document(old_path)
    db.session.flush()
    return doc


# ---------- Memos ----------

def render_memo(doc: ArchiveDocument) -> bytes:
    pdf = FebeDocument("Internal Memo", doc.reference_no, doc.committee.name)
    pdf.title_band(doc.title, doc.document_date)
    pdf.details([
        ("To", doc.memo_to),
        ("From", doc.memo_from),
        ("CC", doc.memo_cc),
        ("Date", fmt_date(doc.document_date)),
        ("Subject", doc.title),
    ], label_width=30)
    pdf.paragraph(doc.body)
    pdf.signatures([("Issued by", doc.created_by.name if doc.created_by else None)])
    return pdf.output_bytes()


# ---------- Meeting agendas ----------

def render_agenda(meeting: Meeting, reference_no: str) -> bytes:
    committee = meeting.committee
    when = fmt_date(meeting.date)
    if meeting.start_time:
        when += f", {meeting.start_time:%H:%M}" + (f" - {meeting.end_time:%H:%M}" if meeting.end_time else "")
    pdf = FebeDocument("Meeting Agenda", reference_no, committee.name)
    pdf.title_band(meeting.title, meeting.date)
    pdf.details([
        ("Committee", committee.name),
        ("Meeting", meeting.title),
        ("Date and time", when),
        ("Venue", meeting.location),
        ("Convened by", meeting.created_by.name if meeting.created_by else None),
        ("Chairperson", committee.chairperson.name if committee.chairperson else None),
        ("Secretary", committee.secretary.user.name if committee.secretary and committee.secretary.user else None),
    ])
    pdf.section("Agenda", meeting.agenda, "No agenda items were entered.")
    return pdf.output_bytes()


def file_meeting_agenda(meeting: Meeting, actor: User | None = None) -> ArchiveDocument | None:
    """Keep the meeting's archive agenda in step with the meeting: the
    uploaded agenda file if there is one, otherwise a PDF generated from the
    agenda text. Meetings with neither are not filed."""
    if not meeting.agenda_file_path and not meeting.agenda:
        return None
    doc = ArchiveDocument.query.filter_by(meeting_id=meeting.id, category="agenda").first()
    reference_no = doc.reference_no if doc else next_reference(meeting.committee, "agenda", meeting.date.year)
    old_generated = doc.file_path if doc is not None and doc.source == "created" else None

    if meeting.agenda_file_path:
        # Point at the meeting's own file; it is replaced, never shared, when a new one is uploaded.
        source, (file_name, file_path) = "uploaded", (meeting.agenda_file_name, meeting.agenda_file_path)
    else:
        with db.session.no_autoflush:
            file_name, file_path = save_generated_document(
                render_agenda(meeting, reference_no), "archive", f"Agenda - {_safe_name(meeting.title)}.pdf",
            )
        source = "created"

    if doc is None:
        doc = ArchiveDocument(
            committee=meeting.committee, category="agenda", meeting_id=meeting.id, reference_no=reference_no,
            created_by_id=(actor.id if actor else meeting.created_by_id),
        )
        db.session.add(doc)
    doc.title = f"Agenda: {meeting.title}"[:255]
    doc.document_date = meeting.date
    doc.summary = meeting.agenda
    doc.source, doc.file_name, doc.file_path = source, file_name, file_path
    if old_generated and old_generated != file_path:
        delete_document(old_generated)
    db.session.flush()
    return doc


def backfill_meeting_agendas():
    """File agendas of meetings scheduled before the archive existed (idempotent)."""
    filed = {mid for (mid,) in db.session.query(ArchiveDocument.meeting_id).filter(ArchiveDocument.meeting_id.isnot(None))}
    for meeting in Meeting.query.order_by(Meeting.id).all():
        if meeting.id not in filed and (meeting.agenda_file_path or meeting.agenda):
            file_meeting_agenda(meeting)
    db.session.commit()
