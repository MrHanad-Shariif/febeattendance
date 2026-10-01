"""In-app notifications + queued emails for the committees module.

`notify()` is the one entry point. It writes a Notification row per user and,
when an email subject is given, queues an EmailOutbox row addressed to the
user's registered email (never an address typed into a form). The
flush_email_outbox job sends the queue in batches, so faculty-wide notices
don't slow down or fail the request that triggered them.

Callers commit the session; everything here only adds rows.
"""
from flask import current_app
from markupsafe import escape

from app.extensions import db
from app.models import EmailOutbox, Notification, User, utcnow
from app.utils.settings import get_all_settings, get_setting_str

FACULTY_NAME = "Faculty of Engineering and Built Environment (FEBE)"
SYSTEM_NAME = "FEBEMS"

# Brief item 31: fixed subject lines.
SUBJECTS = {
    "task_assigned": "New Task Assigned – {title}",
    "task_completed": "Task Completed – {title}",
    "task_updated": "Task Updated – {title}",
    "task_due_soon": "Task Due Soon – {title}",
    "task_overdue": "Task Overdue – {title}",
    "meeting_scheduled": "Meeting Scheduled – {title}",
    "meeting_updated": "Meeting Updated – {title}",
    "meeting_cancelled": "Meeting Cancelled – {title}",
    "minutes_published": "FEBEMS Meeting Minutes Published – {title}",
    "information": "FEBEMS Information Sharing – {title}",
    "assignment_new": "New Assignment – {title}",
    "assignment_extended": "Assignment Deadline Extended – {title}",
    "assignment_comment": "Lecturer Comment on Your Assignment – {title}",
    "special_exam_approved": "Special Exam Request Approved – {title}",
    "special_exam_declined": "Special Exam Request Declined – {title}",
}


def subject_for(key: str, title: str) -> str:
    return SUBJECTS[key].format(title=title)[:255]


def _email_html(user: User, heading: str, lines: list[str], link: str | None) -> str:
    """Plain, FEBEMS-branded email body. Every value is escaped."""
    body = "".join(f"<p style=\"margin:0 0 10px\">{escape(line)}</p>" for line in lines if line)
    button = ""
    if link:
        url = f"{current_app.config['FRONTEND_BASE_URL']}{link}"
        button = (
            f'<p style="margin:18px 0"><a href="{escape(url)}" '
            'style="background:#15803d;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">'
            "Open in FEBEMS</a></p>"
        )
    return f"""
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#0f172a">
          <p style="margin:0 0 4px;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.04em">
            {escape(FACULTY_NAME)}</p>
          <h2 style="margin:0 0 16px;font-size:18px">{escape(heading)}</h2>
          <p style="margin:0 0 10px">Hello {escape(user.name)},</p>
          {body}
          {button}
          <p style="margin:24px 0 0;font-size:12px;color:#64748b">
            This is an automatic message from FEBEMS, the Faculty of Engineering and Built Environment Management System.</p>
        </div>
    """


def notify(
    users,
    *,
    type: str,
    title: str,
    message: str | None = None,
    link: str | None = None,
    related_id: int | None = None,
    email_subject: str | None = None,
    email_lines: list[str] | None = None,
    exclude: User | None = None,
    include_students: bool = False,
) -> int:
    """Notify each distinct, active user (students only when include_students
    is set). Returns how many were notified."""
    # Paused or outside sending hours still queues (flush_outbox holds it);
    # only "off" stops the email being queued at all.
    if email_subject and not _queueing_emails():
        email_subject = None
    seen: set[int] = set()
    count = 0
    for user in users:
        if user is None or user.id in seen or user.status != "active" or (user.role == "student" and not include_students):
            continue
        if exclude is not None and user.id == exclude.id:
            continue
        seen.add(user.id)
        db.session.add(Notification(
            user_id=user.id, type=type, title=title[:255],
            message=(message or "")[:1000] or None, link=link, related_record_id=related_id,
        ))
        if email_subject and user.email and not user.email.endswith("@example.invalid"):
            db.session.add(EmailOutbox(
                user_id=user.id,
                subject=email_subject,
                html=_email_html(user, title, email_lines or ([message] if message else []), link),
            ))
        count += 1
    return count


def _queueing_emails(settings: dict | None = None) -> bool:
    settings = settings if settings is not None else get_all_settings()
    return (get_setting_str("email_mode", settings) != "off"
            and get_setting_str("email_notifications", settings) != "off")


def flush_outbox(batch_size: int = 50) -> int:
    """Send up to batch_size pending emails, as Settings > Email allows.
    Switched off: waiting emails are cancelled. Paused or outside sending
    hours: they stay pending until sending is allowed. Returns how many
    were sent."""
    from app.utils.email import _send, email_allowed

    settings = get_all_settings()
    if not _queueing_emails(settings):
        EmailOutbox.query.filter_by(status="pending").update(
            {"status": "cancelled", "last_error": "Not sent: email was switched off in Settings"},
            synchronize_session=False,
        )
        db.session.commit()
        return 0
    if not email_allowed("notification", settings):
        return 0

    sent = 0
    pending = (
        EmailOutbox.query.filter_by(status="pending")
        .order_by(EmailOutbox.id)
        .limit(batch_size)
        .all()
    )
    for item in pending:
        item.attempts += 1
        try:
            _send(item.subject, item.user.email, item.html)
            item.status = "sent"
            item.sent_at = utcnow()
            sent += 1
        except Exception as exc:  # noqa: BLE001 -- one bad address must not stop the batch
            item.last_error = str(exc)[:500]
            if item.attempts >= EmailOutbox.MAX_ATTEMPTS:
                item.status = "failed"
            current_app.logger.warning("Email %s to user %s failed: %s", item.id, item.user_id, exc)
        db.session.commit()
    return sent
