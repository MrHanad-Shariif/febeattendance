"""Leave and absence communication: what lecturers and students are told.

* Lecturers are notified (in-app + email) whenever an official absence or
  leave of theirs is recorded, changed, ended early or cancelled, with the
  dates, status and days remaining; a reminder goes before it ends.
* Students are told about each class session that is officially cancelled
  because the lecturer is absent -- and told again if that changes. Only
  LecturerAbsence rows count: a pending leave request never cancels a class.
  Sessions are announced once each (ClassNotice), within the next
  `class_notice_days_ahead` days; later ones are announced by the sweep as
  they come into that window.

Days are calendar days in campus time (the server's local date), counting
both the first and the last day of the leave.
"""
from collections import defaultdict
from datetime import date as date_cls, datetime, timedelta

from app.extensions import db
from app.models import ClassNotice, LecturerAbsence, Timetable, User, utcnow
from app.utils.absences import AbsenceIndex, affected_sessions
from app.utils.batches import members
from app.utils.notify import notify
from app.utils.settings import get_all_settings, get_setting_int, get_setting_str


def users_with_permission(code: str) -> list[User]:
    from app.utils.rbac import has_permission

    staff = User.query.filter(User.role.in_(("admin", "lecturer")), User.status == "active").all()
    return [u for u in staff if has_permission(u, code)]


def countdown(absence, today: date_cls | None = None) -> dict:
    """Status and day counts for one absence (or leave request)."""
    today = today or date_cls.today()
    end = getattr(absence, "actual_end_date", None) or absence.end_date
    start = absence.start_date
    if getattr(absence, "state", None) == "cancelled":
        phase = "cancelled"
    elif today < start:
        phase = "upcoming"
    elif end is not None and today > end:
        phase = "completed"
    else:
        phase = "active"
    total = (end - start).days + 1 if end else None
    return {
        "phase": phase,
        "phase_label": {"upcoming": "Upcoming", "active": "On leave now", "completed": "Completed",
                        "cancelled": "Cancelled"}[phase],
        "total_days": total,
        "starts_in_days": (start - today).days if phase == "upcoming" else 0,
        # Including today: on the last day of leave, 1 day remains.
        "days_remaining": ((end - today).days + 1 if end else None) if phase == "active"
        else (total if phase == "upcoming" else 0),
        "ongoing": end is None,
        "return_date": (end + timedelta(days=1)).isoformat() if end else None,
    }


def _date_range(a) -> str:
    end = a.actual_end_date or a.end_date
    if end is None:
        return f"from {a.start_date:%d %b %Y} (end date not yet known)"
    if end == a.start_date:
        return f"on {a.start_date:%d %b %Y}"
    return f"{a.start_date:%d %b %Y} to {end:%d %b %Y}"


ACTION_TITLES = {
    "created": "Your {kind} has been recorded",
    "approved": "Your leave request was approved",
    "edited": "Your {kind} was updated",
    "closed": "Your {kind} has been ended",
    "cancelled": "Your {kind} was cancelled",
}


def notify_lecturer_of_absence(absence: LecturerAbsence, action: str, note: str | None = None) -> None:
    """Tell the lecturer about a change to their official absence/leave."""
    settings = get_all_settings()
    c = countdown(absence)
    kind = absence.reason_label.lower()
    title = ACTION_TITLES[action].format(kind=kind)
    if c["phase"] == "active" and not c["ongoing"]:
        remaining = f"{c['days_remaining']} day{'s' if c['days_remaining'] != 1 else ''} remaining (returning {date_cls.fromisoformat(c['return_date']):%d %b %Y})."
    elif c["phase"] == "upcoming":
        remaining = f"Starts in {c['starts_in_days']} day{'s' if c['starts_in_days'] != 1 else ''}."
    elif c["ongoing"] and c["phase"] == "active":
        remaining = "No end date yet: the Academic Office will record your return."
    else:
        remaining = ""
    lines = [
        f"Type: {absence.reason_label} ({'justified' if absence.justified else 'unjustified'}).",
        f"Dates: {_date_range(absence)}.",
        f"Status: {c['phase_label'] if action != 'cancelled' else 'Cancelled'}. {remaining}".strip(),
    ]
    if absence.remarks:
        lines.append(f"Reason / remarks: {absence.remarks}")
    if note:
        lines.append(f"Note from the Academic Office: {note}")
    if action != "cancelled":
        lines.append("Your affected class sessions are exempted, and the students in those classes have been told "
                     "that the classes are cancelled.")
    else:
        lines.append("Your classes in these dates take place as normal again, and the students have been told.")
    lines.append(f"Questions: {get_setting_str('academic_office_contact', settings)}.")
    notify([absence.lecturer], type="leave", title=title, message=" ".join(lines[:3]), link="/my-leave",
           related_id=absence.id, email_subject=f"FEBEMS Leave – {title}"[:255], email_lines=lines)


# ---------- class cancellation notices for students ----------

def _students_of(batch: str | None) -> list[User]:
    codes = members(batch)
    if not codes:
        return []
    return User.query.filter(User.role == "student", User.status == "active", User.batch.in_(codes)).all()


def sync_class_notices(lecturer_id: int | None = None, today: date_cls | None = None) -> dict:
    """Bring the class notices in line with the official absences and tell
    students what changed: newly cancelled sessions, and sessions whose
    cancellation was withdrawn. Past sessions are never touched."""
    today = today or date_cls.today()
    settings = get_all_settings()
    horizon = today + timedelta(days=max(1, get_setting_int("class_notice_days_ahead", settings)) - 1)
    AbsenceIndex.invalidate()

    absences = LecturerAbsence.query.filter(LecturerAbsence.state != "cancelled")
    if lecturer_id:
        absences = absences.filter(LecturerAbsence.lecturer_id == lecturer_id)
    covered = {}  # (timetable_id, date) -> (entry, absence)
    for a in absences.all():
        for e, d in affected_sessions(a, date_from=today, date_to=horizon, settings=settings):
            covered.setdefault((e.id, d), (e, a))

    existing = ClassNotice.query.filter(ClassNotice.date >= today, ClassNotice.date <= horizon)
    if lecturer_id:
        ids = [t.id for t in Timetable.query.filter_by(lecturer_id=lecturer_id).all()]
        existing = existing.filter(ClassNotice.timetable_id.in_(ids or [-1]))
    existing = {(n.timetable_id, n.date): n for n in existing.all()}

    now = utcnow()
    newly_cancelled, reinstated = defaultdict(list), defaultdict(list)
    for key, (e, a) in covered.items():
        n = existing.get(key)
        if n is not None and n.status == "cancelled":
            n.absence_id = a.id
            continue
        if n is None:
            n = ClassNotice(timetable_id=e.id, date=key[1], history=[])
            db.session.add(n)
        n.absence_id, n.status, n.notified_at, n.reinstated_at = a.id, "cancelled", now, None
        n.batch, n.course_name, n.room = e.batch, e.course_name, e.room
        n.lecturer_name = e.lecturer.name if e.lecturer else None
        n.start_time, n.end_time = e.start_time, e.end_time
        n.history = (n.history or []) + [{"status": "cancelled", "at": now.isoformat(timespec="seconds")}]
        newly_cancelled[(e.batch, e.course_name, n.lecturer_name)].append(n)
    for key, n in existing.items():
        if key not in covered and n.status == "cancelled":
            n.status, n.reinstated_at = "reinstated", now
            n.history = (n.history or []) + [{"status": "reinstated", "at": now.isoformat(timespec="seconds")}]
            reinstated[(n.batch, n.course_name, n.lecturer_name)].append(n)

    sent = 0
    for (batch, course, lecturer), notices in newly_cancelled.items():
        sent += _tell_students(batch, course, lecturer, notices, cancelled=True)
    for (batch, course, lecturer), notices in reinstated.items():
        sent += _tell_students(batch, course, lecturer, notices, cancelled=False)
    db.session.commit()
    return {"cancelled": sum(map(len, newly_cancelled.values())), "reinstated": sum(map(len, reinstated.values())),
            "notified": sent}


def _session_text(n: ClassNotice) -> str:
    when = f"{n.date:%a %d %b}"
    if n.start_time:
        when += f", {n.start_time:%H:%M}" + (f"–{n.end_time:%H:%M}" if n.end_time else "")
    return when


def _tell_students(batch, course, lecturer, notices, cancelled: bool) -> int:
    notices = sorted(notices, key=lambda n: (n.date, n.start_time or datetime.min.time()))
    sessions = "; ".join(_session_text(n) for n in notices[:6]) + (f" (+{len(notices) - 6} more)" if len(notices) > 6 else "")
    today = date_cls.today()
    soon = " TODAY" if any(n.date == today for n in notices) else ""
    if cancelled:
        title = f"Class cancelled{soon}: {course} ({batch})"
        message = (f"{course} with {lecturer or 'your lecturer'} is cancelled on: {sessions}. The lecturer is unavailable. "
                   "You will not be marked absent for these sessions.")
        lines = [message, "If the cancellation changes, you will be told here and by email."]
    else:
        title = f"Class will take place: {course} ({batch})"
        message = (f"The cancellation of {course} with {lecturer or 'your lecturer'} was withdrawn. The class takes place "
                   f"as scheduled on: {sessions}. Normal attendance applies.")
        lines = [message]
    return notify(_students_of(batch), type="class_notice", title=title, message=message, link="/",
                  related_id=notices[0].id, email_subject=f"FEBEMS – {title}"[:255], email_lines=lines,
                  include_students=True)


def student_class_notices(student: User, today: date_cls | None = None) -> list[dict]:
    """Cancelled (and recently reinstated) sessions for the student's class,
    today and ahead; today's first."""
    today = today or date_cls.today()
    if not student.batch:
        return []
    rows = ClassNotice.query.filter(ClassNotice.date >= today).order_by(ClassNotice.date, ClassNotice.start_time).all()
    out = []
    for n in rows:
        if student.batch not in members(n.batch):
            continue
        if n.status == "reinstated" and n.reinstated_at and n.reinstated_at < utcnow() - timedelta(days=7):
            continue
        out.append({**n.to_dict(), "is_today": n.date == today})
    return out


# ---------- reminders ----------

def send_leave_reminders(today: date_cls | None = None) -> int:
    """Remind lecturers N days before their leave ends (once per end date)."""
    today = today or date_cls.today()
    days = get_setting_int("leave_reminder_days_before")
    if days <= 0:
        return 0
    sent = 0
    for a in LecturerAbsence.query.filter(LecturerAbsence.state != "cancelled").all():
        end = a.actual_end_date or a.end_date
        if end is None or a.start_date > today or end < today or a.reminder_sent_for == end:
            continue
        if (end - today).days + 1 > days:
            continue
        left = (end - today).days + 1
        notify([a.lecturer], type="leave", title=f"Your {a.reason_label.lower()} ends soon",
               message=(f"{left} day{'s' if left != 1 else ''} remaining. Your last day is {end:%A %d %b %Y}; "
                        f"you are expected back on {end + timedelta(days=1):%A %d %b %Y}. "
                        "If you need longer, submit a new request or contact the Academic Office."),
               link="/my-leave", related_id=a.id, email_subject=f"FEBEMS Leave – {a.reason_label} ends {end:%d %b %Y}")
        a.reminder_sent_for = end
        sent += 1
    db.session.commit()
    return sent
