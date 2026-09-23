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


def compute_course_stats(student_id: int, batch: str, course_name: str, settings: dict | None = None) -> dict:
    """Attendance stats for one student in one course. The percentage used
    for the 25% retake/blocking rule is measured against the course's fixed
    total sessions for the whole semester (see total_sessions_for_course),
    not just the sessions that have happened so far."""
    settings = settings if settings is not None else get_all_settings()
    lates_equal_absent = get_setting_int("student_lates_equal_absent", settings)
    threshold_percent = get_setting_int("student_absence_threshold_percent", settings)

    records = course_records_query(student_id, batch, course_name).all()

    on_time = sum(1 for r in records if r.status == "on_time")
    late = sum(1 for r in records if r.status == "late")
    raw_absent = sum(1 for r in records if r.status == "absent")
    present_excused = sum(1 for r in records if r.status == "present")

    sessions_held = len(records)
    total_sessions = total_sessions_for_course(batch, course_name, settings) or sessions_held
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
    rows = Timetable.query.filter_by(batch=batch).with_entities(Timetable.course_name).distinct().all()
    return [(batch, r[0]) for r in rows]
