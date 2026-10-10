"""Lecturer absences: which teaching sessions they cover, conflicts, and the
review list for attendance rows that already existed.

A *session* is one timetable row meeting on one date. An absence covers a
session when it is not cancelled, the date is inside its effective range
(start_date .. actual_end_date / end_date, open-ended while ongoing) and the
row belongs to the absent lecturer and passes the absence's optional scope
lists (sessions, classes, courses, weekdays).

Covered sessions are exempted: students are not marked absent and the
session leaves their percentages; the lecturer's attendance for it counts
as a justified absence (when the absence is marked justified). Stored
attendance rows are never rewritten -- rows that already existed are listed
as AbsenceReviewItem rows, exempted by default until an admin chooses
"keep as recorded".
"""
from collections import defaultdict
from datetime import date as date_cls, timedelta

from flask import g, has_app_context

from app.extensions import db
from app.models import AbsenceReviewItem, Attendance, LecturerAbsence, StudentAttendance, Timetable, User, utcnow
from app.utils.schedule import day_abbr, teaches_on
from app.utils.settings import get_all_settings, get_no_class_dates, get_setting_str
from app.utils.validation import ValidationError, clean_text, parse_iso_date

VALID_DAYS = ("Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri")
# How far ahead an ongoing absence is projected for previews and conflict checks.
OPEN_ENDED_HORIZON_DAYS = 180


def matches_scope(absence, entry, d: date_cls) -> bool:
    """Does `absence` (a LecturerAbsence or a plain object with the same
    fields) apply to timetable row `entry` meeting on `d`? Dates are not
    checked here."""
    if entry.lecturer_id is None or entry.lecturer_id != absence.lecturer_id:
        return False
    if absence.timetable_ids and entry.id not in absence.timetable_ids:
        return False
    if absence.batches and entry.batch not in absence.batches:
        return False
    if absence.courses and entry.course_name not in absence.courses:
        return False
    if absence.days and day_abbr(d) not in absence.days:
        return False
    return True


class AbsenceIndex:
    """Every non-cancelled absence, grouped by lecturer, plus the review
    decisions, so a report can ask "is this session exempted?" thousands of
    times with two queries in total."""

    def __init__(self):
        absences = LecturerAbsence.query.filter(LecturerAbsence.state != "cancelled").all()
        self.by_lecturer = defaultdict(list)
        for a in absences:
            self.by_lecturer[a.lecturer_id].append(a)
        ids = [a.id for a in absences]
        self.kept = set()
        self.flagged = {}
        if ids:
            for item in AbsenceReviewItem.query.filter(AbsenceReviewItem.absence_id.in_(ids)).all():
                self.flagged[(item.kind, item.record_id)] = item
                if item.resolution == "kept":
                    self.kept.add((item.absence_id, item.kind, item.record_id))

    @classmethod
    def current(cls) -> "AbsenceIndex":
        """One index per request / job run (cached on flask.g)."""
        if not has_app_context():
            return cls()
        index = g.get("_absence_index")
        if index is None:
            index = g._absence_index = cls()
        return index

    @staticmethod
    def invalidate():
        if has_app_context():
            g.pop("_absence_index", None)

    def covering(self, entry, d: date_cls):
        if entry is None or entry.lecturer_id is None:
            return None
        for a in self.by_lecturer.get(entry.lecturer_id, ()):
            if a.covers_date(d) and matches_scope(a, entry, d):
                return a
        return None

    def has_any(self) -> bool:
        return bool(self.by_lecturer)

    def exempting(self, kind: str, record, entry, d: date_cls):
        """The absence that exempts this stored attendance row's session,
        unless an admin chose to keep the row as recorded."""
        a = self.covering(entry, d)
        if a is None or (a.id, kind, record.id) in self.kept:
            return None
        return a

    def review_item(self, kind: str, record_id: int):
        return self.flagged.get((kind, record_id))


def split_day_classes(entries, d: date_cls, index: AbsenceIndex | None = None):
    """(teaching, covered) for one lecturer's classes on `d`: the classes
    they are expected to teach, and {timetable_id: absence} for the rest."""
    index = index or AbsenceIndex.current()
    teaching, covered = [], {}
    for e in entries:
        a = index.covering(e, d)
        if a is None:
            teaching.append(e)
        else:
            covered[e.id] = a
    return teaching, covered


def is_session_exempt(entry, d: date_cls, index: AbsenceIndex | None = None):
    return (index or AbsenceIndex.current()).covering(entry, d)


# ---------- input validation ----------

def _clean_list(value, label: str, item_type=str, allowed=None) -> list:
    if value in (None, "", []):
        return []
    if not isinstance(value, list):
        raise ValidationError(f"{label} must be a list")
    out = []
    for v in value:
        if item_type is int:
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise ValidationError(f"{label} contains an invalid value")
        else:
            v = str(v).strip()
            if not v:
                continue
        if allowed is not None and v not in allowed:
            raise ValidationError(f"{label} contains an invalid value: {v}")
        if v not in out:
            out.append(v)
    return out


def clean_absence_input(data: dict, existing: LecturerAbsence | None = None) -> dict:
    """Validated fields for creating (existing=None) or editing an absence."""
    def pick(key):
        if key in data:
            return data.get(key)
        return getattr(existing, key) if existing is not None else None

    lecturer_id = pick("lecturer_id")
    try:
        lecturer_id = int(lecturer_id)
    except (TypeError, ValueError):
        raise ValidationError("Choose a lecturer")
    lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first()
    if lecturer is None:
        raise ValidationError("Choose a lecturer")

    start = pick("start_date")
    start = start if isinstance(start, date_cls) else parse_iso_date(start, "start_date") if start else None
    if start is None:
        raise ValidationError("Start date is required")

    ongoing = bool(data.get("ongoing")) if "ongoing" in data else (existing is not None and existing.end_date is None)
    end = None
    if not ongoing:
        end = pick("end_date")
        end = end if isinstance(end, date_cls) or end is None else parse_iso_date(end, "end_date") if end else None
        if end is None:
            raise ValidationError("Enter an expected end date, or mark the absence as ongoing")
        if end < start:
            raise ValidationError("The end date cannot be before the start date")
        if (end - start).days > 366:
            raise ValidationError("An absence cannot be longer than a year; record it as ongoing instead")

    reason = pick("reason")
    if reason not in LecturerAbsence.REASONS:
        raise ValidationError("Choose a reason")
    custom_reason = clean_text(pick("custom_reason"), "Custom reason", max_len=200)
    if reason == "other" and not custom_reason:
        raise ValidationError("Describe the reason")
    if reason != "other":
        custom_reason = None

    justified = pick("justified")
    justified = True if justified is None else bool(justified)

    timetable_ids = _clean_list(pick("timetable_ids"), "Sessions", int)
    if timetable_ids:
        found = {t.id for t in Timetable.query.filter(Timetable.id.in_(timetable_ids)).all() if t.lecturer_id == lecturer_id}
        if set(timetable_ids) - found:
            raise ValidationError("Every selected session must be one of this lecturer's classes")

    return {
        "lecturer_id": lecturer_id,
        "start_date": start,
        "end_date": end,
        "reason": reason,
        "custom_reason": custom_reason,
        "remarks": clean_text(pick("remarks"), "Remarks", max_len=1000),
        "justified": justified,
        "timetable_ids": timetable_ids or None,
        "batches": _clean_list(pick("batches"), "Classes") or None,
        "courses": _clean_list(pick("courses"), "Subjects") or None,
        "days": _clean_list(pick("days"), "Days", allowed=VALID_DAYS) or None,
    }


class Draft:
    """An unsaved absence with the same fields LecturerAbsence has, for
    previews and conflict checks before anything is written."""

    state = "recorded"
    actual_end_date = None

    def __init__(self, fields: dict, absence_id: int | None = None, actual_end_date=None):
        self.id = absence_id
        self.__dict__.update(fields)
        self.actual_end_date = actual_end_date

    effective_end = LecturerAbsence.effective_end
    covers_date = LecturerAbsence.covers_date


# ---------- affected sessions ----------

def projection_end(absence, settings=None) -> date_cls:
    """Last date to enumerate: the effective end, or for an ongoing absence
    the semester's end (at least a month ahead, at most the horizon)."""
    end = absence.effective_end
    if end is not None:
        return end
    settings = settings if settings is not None else get_all_settings()
    horizon = absence.start_date + timedelta(days=OPEN_ENDED_HORIZON_DAYS)
    try:
        sem_end = date_cls.fromisoformat(get_setting_str("semester_end_date", settings))
    except ValueError:
        sem_end = None
    if sem_end and sem_end >= absence.start_date + timedelta(days=30):
        return min(sem_end, horizon)
    return horizon


def affected_sessions(absence, date_from: date_cls | None = None, date_to: date_cls | None = None,
                      settings=None) -> list[tuple]:
    """[(timetable row, date)] covered by `absence`, in date/time order,
    within [date_from, date_to] (default: the absence's whole range)."""
    settings = settings if settings is not None else get_all_settings()
    no_class_dates = get_no_class_dates(settings)
    start = max(absence.start_date, date_from) if date_from else absence.start_date
    end = projection_end(absence, settings)
    if date_to:
        end = min(end, date_to)
    entries = [e for e in Timetable.query.filter_by(lecturer_id=absence.lecturer_id).all() if e.start_time]
    out = []
    d = start
    while d <= end:
        for e in sorted(entries, key=lambda e: e.start_time):
            if teaches_on(e, d, no_class_dates) and matches_scope(absence, e, d):
                out.append((e, d))
        d += timedelta(days=1)
    return out


def summarize_sessions(sessions, today: date_cls | None = None) -> dict:
    today = today or date_cls.today()
    by_class = {}
    for e, d in sessions:
        key = (e.batch or "—", e.course_name)
        row = by_class.setdefault(key, {"batch": key[0], "course_name": key[1], "sessions": 0, "periods": 0,
                                        "past_sessions": 0, "timetable_ids": set()})
        row["sessions"] += 1
        row["periods"] += e.sessions or 1
        row["timetable_ids"].add(e.id)
        if d < today:
            row["past_sessions"] += 1
    classes = []
    for row in sorted(by_class.values(), key=lambda r: (r["batch"], r["course_name"])):
        row["timetable_ids"] = sorted(row["timetable_ids"])
        classes.append(row)
    return {
        "total_sessions": len(sessions),
        "past_sessions": sum(1 for _, d in sessions if d < today),
        "classes": classes,
        "batches": sorted({c["batch"] for c in classes}),
        "courses": sorted({c["course_name"] for c in classes}),
    }


def session_list(sessions, limit: int = 400) -> list[dict]:
    return [
        {
            "date": d.isoformat(),
            "day": day_abbr(d),
            "timetable_id": e.id,
            "batch": e.batch,
            "course_name": e.course_name,
            "room": e.room,
            "start_time": e.start_time.strftime("%H:%M") if e.start_time else None,
            "end_time": e.end_time.strftime("%H:%M") if e.end_time else None,
        }
        for e, d in sessions[:limit]
    ]


def find_conflicts(absence, exclude_id: int | None = None) -> list[LecturerAbsence]:
    """Other non-cancelled absences of the same lecturer that cover at least
    one of the same sessions (or, when neither has any session in the
    overlap, simply overlap in dates with the same scope)."""
    others = LecturerAbsence.query.filter(
        LecturerAbsence.lecturer_id == absence.lecturer_id,
        LecturerAbsence.state != "cancelled",
    ).all()
    settings = get_all_settings()
    mine_end = projection_end(absence, settings)
    conflicts = []
    for other in others:
        if exclude_id is not None and other.id == exclude_id:
            continue
        other_end = projection_end(other, settings)
        lo, hi = max(absence.start_date, other.start_date), min(mine_end, other_end)
        if lo > hi:
            continue
        mine = {(e.id, d) for e, d in affected_sessions(absence, lo, hi, settings)}
        theirs = {(e.id, d) for e, d in affected_sessions(other, lo, hi, settings)}
        if mine & theirs:
            conflicts.append(other)
        elif not mine and not theirs and _same_scope(absence, other):
            conflicts.append(other)
    return conflicts


def _same_scope(a, b) -> bool:
    return all(sorted(getattr(a, k) or []) == sorted(getattr(b, k) or [])
               for k in ("timetable_ids", "batches", "courses", "days"))


# ---------- review of rows that already existed ----------

def sync_review_items(absence: LecturerAbsence, today: date_cls | None = None) -> int:
    """List every stored attendance row (student and lecturer) for a session
    this absence covers up to today; remove pending items it no longer
    covers. Rows are not modified. Returns how many items are pending."""
    today = today or date_cls.today()
    existing = {(i.kind, i.record_id): i for i in absence.review_items}
    wanted = set()

    if absence.state != "cancelled" and absence.start_date <= today:
        sessions = affected_sessions(absence, date_to=today)
        if sessions:
            dates = sorted({d for _, d in sessions})
            pairs = {(e.id, d) for e, d in sessions}
            ids = sorted({e.id for e, _ in sessions})
            rows = StudentAttendance.query.filter(
                StudentAttendance.timetable_id.in_(ids),
                StudentAttendance.date >= dates[0], StudentAttendance.date <= dates[-1],
            ).all()
            for r in rows:
                if (r.timetable_id, r.date) in pairs:
                    wanted.add(("student", r.id))
                    if ("student", r.id) not in existing:
                        absence.review_items.append(AbsenceReviewItem(
                            kind="student", record_id=r.id, timetable_id=r.timetable_id,
                            date=r.date, original_status=r.status,
                        ))
            for r in Attendance.query.filter(
                Attendance.lecturer_id == absence.lecturer_id, Attendance.date.in_(dates)
            ).all():
                wanted.add(("lecturer", r.id))
                if ("lecturer", r.id) not in existing:
                    absence.review_items.append(AbsenceReviewItem(
                        kind="lecturer", record_id=r.id, date=r.date, original_status=r.status,
                    ))

    for key, item in existing.items():
        if key not in wanted and item.resolution == "pending":
            absence.review_items.remove(item)
    AbsenceIndex.invalidate()
    return sum(1 for i in absence.review_items if i.resolution == "pending")


def review_items_payload(absence: LecturerAbsence) -> list[dict]:
    items = sorted(absence.review_items, key=lambda i: (i.date, i.kind, i.record_id))
    student_ids = [i.record_id for i in items if i.kind == "student"]
    students = {r.id: r for r in StudentAttendance.query.filter(StudentAttendance.id.in_(student_ids)).all()} if student_ids else {}
    out = []
    for i in items:
        row = {
            "id": i.id,
            "kind": i.kind,
            "record_id": i.record_id,
            "date": i.date.isoformat(),
            "original_status": i.original_status,
            "resolution": i.resolution,
            "resolved_by_name": i.resolved_by.name if i.resolved_by else None,
            "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None,
        }
        if i.kind == "student":
            r = students.get(i.record_id)
            row.update({
                "person_name": r.student.name if r and r.student else "(deleted)",
                "course_name": r.timetable_entry.course_name if r and r.timetable_entry else None,
                "batch": r.timetable_entry.batch if r and r.timetable_entry else None,
                "current_status": r.status if r else None,
            })
        else:
            r = Attendance.query.get(i.record_id)
            row.update({
                "person_name": absence.lecturer.name if absence.lecturer else None,
                "course_name": "Lecturer daily check-in",
                "batch": None,
                "current_status": r.status if r else None,
            })
        out.append(row)
    return out


def resolve_review_items(absence: LecturerAbsence, item_ids: list[int], resolution: str, actor) -> int:
    if resolution not in ("exempted", "kept", "pending"):
        raise ValidationError("Resolution must be exempted, kept or pending")
    changed = 0
    for item in absence.review_items:
        if item.id in item_ids and item.resolution != resolution:
            item.resolution = resolution
            item.resolved_by_id = actor.id if resolution != "pending" else None
            item.resolved_at = utcnow() if resolution != "pending" else None
            changed += 1
    AbsenceIndex.invalidate()
    return changed


def record_absence_event(absence: LecturerAbsence, actor, action: str, old=None, new=None, note: str | None = None):
    from app.models import LecturerAbsenceEvent

    absence.events.append(LecturerAbsenceEvent(
        actor_id=actor.id if actor else None, actor_name=actor.name if actor else "System",
        action=action, old_value=old, new_value=new, note=note,
    ))


def snapshot(absence) -> dict:
    """The editable fields as JSON, for the audit trail."""
    return {
        "lecturer_id": absence.lecturer_id,
        "start_date": absence.start_date.isoformat() if absence.start_date else None,
        "end_date": absence.end_date.isoformat() if absence.end_date else None,
        "actual_end_date": absence.actual_end_date.isoformat() if getattr(absence, "actual_end_date", None) else None,
        "reason": absence.reason,
        "custom_reason": absence.custom_reason,
        "remarks": absence.remarks,
        "justified": absence.justified,
        "timetable_ids": absence.timetable_ids or [],
        "batches": absence.batches or [],
        "courses": absence.courses or [],
        "days": absence.days or [],
    }


def sync_after_checkin(lecturer_id: int, d: date_cls):
    """A lecturer checked in on a day an absence covers: list the new row
    for review so an admin can close the absence or keep it."""
    index = AbsenceIndex()
    for a in index.by_lecturer.get(lecturer_id, ()):
        if a.covers_date(d):
            sync_review_items(a)
    db.session.commit()
