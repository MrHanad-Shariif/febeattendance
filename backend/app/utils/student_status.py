"""Student attendance rules: per-session check-in status, the "2 lates = 1
absent" conversion, and the 25%-absence retake/blocking rule.

A "course" for these purposes is identified by (batch, course_name), since
the same course can span multiple Timetable rows (e.g. different days/times)
and a student's percentage is tracked against the course as a whole, not any
single row.
"""
from datetime import date as date_cls, datetime, timedelta

from app.models import Timetable, StudentAttendance
from app.utils.schedule import teaches_on
from app.utils.settings import get_all_settings, get_setting_int, get_setting_str, get_no_class_dates
from app.utils.status import minutes_between


def compute_student_checkin_status(scheduled_start: datetime, checkin_at: datetime, settings: dict | None = None) -> str:
    settings = settings if settings is not None else get_all_settings()
    late_after = get_setting_int("student_late_after_minutes", settings)
    absent_after = get_setting_int("student_absent_after_minutes", settings)

    minutes_late = minutes_between(checkin_at, scheduled_start)

    if absent_after > 0 and minutes_late > absent_after:
        return "absent"
    if late_after > 0 and minutes_late > late_after:
        return "late"
    return "on_time"


def should_mark_student_absent(scheduled_start: datetime, now: datetime, settings: dict | None = None) -> bool:
    settings = settings if settings is not None else get_all_settings()
    absent_after = get_setting_int("student_absent_after_minutes", settings)
    if absent_after <= 0:
        return False
    return minutes_between(now, scheduled_start) > absent_after


def course_records_query(student_id: int, batch: str, course_name: str):
    return (
        StudentAttendance.query
        .join(Timetable, StudentAttendance.timetable_id == Timetable.id)
        .filter(
            StudentAttendance.student_id == student_id,
            Timetable.batch == batch,
            Timetable.course_name == course_name,
        )
    )


def _estimate_entry_sessions(entry, start: date_cls, end: date_cls, no_class_dates: set) -> int:
    total = 0
    d = start
    while d <= end:
        if teaches_on(entry, d, no_class_dates):
            total += entry.sessions
        d += timedelta(days=1)
    return total


def total_sessions_for_course(batch: str, course_name: str, settings: dict | None = None) -> int:
    """The FIXED total number of sessions this course meets across the whole
    semester (past and future combined) -- e.g. 34 for a course held twice a
    week for a ~17 week term. This is the denominator for the 25% rule: it
    doesn't shrink or grow as the term progresses, so a couple of early
    absences don't look like a huge percentage just because few sessions
    have happened yet.

    Each Timetable row's own `semester_total_sessions` is used when admin has
    set it (the reliable source, since only admin knows the real number once
    exam weeks/holidays are finalized); rows without one fall back to a rough
    estimate from semester_start_date/semester_end_date."""
    settings = settings if settings is not None else get_all_settings()
    entries = Timetable.query.filter_by(batch=batch, course_name=course_name).all()
    if not entries:
        return 0

    no_class_dates = get_no_class_dates(settings)
    start = end = None
    try:
        start = date_cls.fromisoformat(get_setting_str("semester_start_date", settings))
        end = date_cls.fromisoformat(get_setting_str("semester_end_date", settings))
        if end < start:
            start = end = None
    except ValueError:
        pass

    total = 0
    for entry in entries:
        if entry.semester_total_sessions:
            total += entry.semester_total_sessions
        elif start and end:
            total += _estimate_entry_sessions(entry, start, end, no_class_dates)
    return total


def exempted_sessions_for_course(batch: str, course_name: str, settings: dict | None = None, index=None) -> int:
    """How many of this course's sessions in the semester a lecturer
    absence covers. Those sessions are not held, so they come off the
    planned total as well as out of every student's absences."""
    from app.utils.absences import AbsenceIndex

    index = index or AbsenceIndex.current()
    if not index.has_any():
        return 0
    cache = index.__dict__.setdefault("course_exempt_cache", {})
    if (batch, course_name) in cache:
        return cache[(batch, course_name)]
    settings = settings if settings is not None else get_all_settings()
    try:
        start = date_cls.fromisoformat(get_setting_str("semester_start_date", settings))
        end = date_cls.fromisoformat(get_setting_str("semester_end_date", settings))
    except ValueError:
        return 0
    no_class_dates = get_no_class_dates(settings)
    entries = [e for e in Timetable.query.filter_by(batch=batch, course_name=course_name).all()
               if e.lecturer_id in index.by_lecturer]
    # An ongoing absence (no end date) only takes off sessions already
    # passed: its future is unknown, and projecting it to the semester's end
    # would shrink the planned total and inflate everyone's percentage.
    today = date_cls.today()
    count = 0
    for entry in entries:
        d = start
        while d <= end:
            if teaches_on(entry, d, no_class_dates):
                a = index.covering(entry, d)
                if a is not None and (a.effective_end is not None or d <= today):
                    count += 1
            d += timedelta(days=1)
    cache[(batch, course_name)] = count
    return count


def counted_records(records, index=None):
    """(counted, exempted): stored rows split by whether a lecturer
    absence exempts their session (and no admin chose to keep the row)."""
    from app.utils.absences import AbsenceIndex

    index = index or AbsenceIndex.current()
    if not index.has_any():
        return list(records), []
    counted, exempted = [], []
    for r in records:
        (exempted if index.exempting("student", r, r.timetable_entry, r.date) else counted).append(r)
    return counted, exempted


def compute_course_stats(student_id: int, batch: str, course_name: str, settings: dict | None = None) -> dict:
    """Attendance stats for one student in one course. The percentage used
    for the 25% retake/blocking rule is measured against the course's fixed
    total sessions for the whole semester (see total_sessions_for_course),
    not just the sessions that have happened so far."""
    settings = settings if settings is not None else get_all_settings()
    records = course_records_query(student_id, batch, course_name).all()
    return stats_from_records(records, batch, course_name, settings)


def stats_from_records(records, batch: str, course_name: str, settings: dict, planned_cache: dict | None = None) -> dict:
    """compute_course_stats from already-loaded rows (one student, one
    course), so bulk reports can load every row in one query.
    `planned_cache` memoises the per-course planned/exempted totals."""
    lates_equal_absent = get_setting_int("student_lates_equal_absent", settings)
    threshold_percent = get_setting_int("student_absence_threshold_percent", settings)

    # Sessions a lecturer absence exempts never count: not as absences, not
    # as attended sessions, and not in the planned total.
    records, exempted_records = counted_records(records)

    on_time = sum(1 for r in records if r.status == "on_time")
    late = sum(1 for r in records if r.status == "late")
    raw_absent = sum(1 for r in records if r.status == "absent")
    present_excused = sum(1 for r in records if r.status == "present")

    sessions_held = len(records)
    key = (batch, course_name)
    if planned_cache is not None and key in planned_cache:
        planned, exempted_sessions = planned_cache[key]
    else:
        planned = total_sessions_for_course(batch, course_name, settings)
        exempted_sessions = exempted_sessions_for_course(batch, course_name, settings)
        if planned_cache is not None:
            planned_cache[key] = (planned, exempted_sessions)
    total_sessions = max(planned - exempted_sessions, sessions_held) if planned else sessions_held
    late_converted_absences = (late // lates_equal_absent) if lates_equal_absent > 0 else 0
    effective_absences = raw_absent + late_converted_absences

    percentage = round((effective_absences / total_sessions) * 100, 1) if total_sessions else 0.0
    blocked = total_sessions > 0 and percentage >= threshold_percent

    return {
        "batch": batch,
        "course_name": course_name,
        "sessions_held": sessions_held,
        "total_sessions": total_sessions,
        "on_time": on_time,
        "late": late,
        "absent": raw_absent,
        "present_excused": present_excused,
        "exempted_sessions": exempted_sessions,
        "exempted_records": len(exempted_records),
        "late_converted_absences": late_converted_absences,
        "effective_absences": effective_absences,
        "absence_percentage": percentage,
        "threshold_percent": threshold_percent,
        "needs_retake": blocked,
        "blocked": blocked,
    }


def is_course_blocked(student_id: int, batch: str, course_name: str, settings: dict | None = None) -> tuple[bool, dict]:
    stats = compute_course_stats(student_id, batch, course_name, settings)
    return stats["blocked"], stats


def all_course_keys_for_batch(batch: str) -> list[tuple[str, str]]:
    """(class batch, course) for every course a student of `batch` takes,
    including classes shared with another batch ("BTE13&BEE11")."""
    from app.utils.batches import batch_filter

    rows = (Timetable.query.filter(batch_filter(Timetable.batch, batch))
            .with_entities(Timetable.batch, Timetable.course_name).distinct().all())
    return sorted((r[0], r[1]) for r in rows)


def course_keys_for_student(student) -> list[tuple[str, str]]:
    """The courses of the student's current class plus every course they
    have attendance in -- so a corrected class (see StudentClassChange)
    keeps the history recorded under the old one."""
    keys = set(all_course_keys_for_batch(student.batch)) if student.batch else set()
    rows = (StudentAttendance.query.join(Timetable, StudentAttendance.timetable_id == Timetable.id)
            .filter(StudentAttendance.student_id == student.id)
            .with_entities(Timetable.batch, Timetable.course_name).distinct().all())
    keys.update((r[0], r[1]) for r in rows if r[0])
    return sorted(keys)
