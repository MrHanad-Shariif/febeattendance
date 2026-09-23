from datetime import datetime

from app.models import StudentAttendance
from app.utils.schedule import get_batch_classes, scheduled_datetimes
from app.utils.settings import get_all_settings, get_no_class_dates
from app.utils.student_status import should_mark_student_absent, is_course_blocked


def get_student_today_rows(student, today) -> list[dict]:
    """One row per session in the student's batch timetable today, each with
    their own check-in status (students check in per session, not once a
    day). Rows for a course they're currently blocked from (25%+ absence)
    are flagged so the frontend can show the notice instead of a check-in
    button."""
    if not student.batch:
        return []

    settings = get_all_settings()
    no_class_dates = get_no_class_dates(settings)
    now = datetime.now()

    entries = get_batch_classes(student.batch, today, no_class_dates)
    rows = []
    for entry in entries:
        start_dt, end_dt = scheduled_datetimes(entry, today)
        record = StudentAttendance.query.filter_by(student_id=student.id, timetable_id=entry.id, date=today).first()

        if record:
            row = record.to_dict()
        else:
            status = "absent" if should_mark_student_absent(start_dt, now, settings) else "not_yet"
            row = {
                "id": None,
                "student_id": student.id,
                "student_name": student.name,
                "timetable_id": entry.id,
                "course_name": entry.course_name,
                "batch": entry.batch,
                "date": today.isoformat(),
                "scheduled_start": start_dt.isoformat(),
                "scheduled_end": end_dt.isoformat() if end_dt else None,
                "checkin_at": None,
                "checkin_distance_m": None,
                "status": status,
                "status_label": StudentAttendance.STATUS_LABELS.get(status, status),
                "remarks": None,
            }

        blocked, stats = is_course_blocked(student.id, entry.batch, entry.course_name, settings)
        row["room"] = entry.room
        row["lecturer_name"] = entry.lecturer.name if entry.lecturer else None
        row["blocked"] = blocked and not record  # already-recorded sessions aren't re-blocked retroactively
        row["course_stats"] = stats
        row["sort_key"] = start_dt
        rows.append(row)

    rows.sort(key=lambda r: r["sort_key"])
    for r in rows:
        r.pop("sort_key", None)
    return rows
