from datetime import datetime

from app.models import User, Attendance
from app.utils.schedule import get_day_classes, day_bounds
from app.utils.settings import get_all_settings, get_no_class_dates
from app.utils.status import should_mark_absent


def _classes_payload(entries):
    return [
        {
            "timetable_id": e.id,
            "course_name": e.course_name,
            "batch": e.batch,
            "room": e.room,
            "start_time": e.start_time.strftime("%H:%M") if e.start_time else None,
            "end_time": e.end_time.strftime("%H:%M") if e.end_time else None,
        }
        for e in entries
    ]


def get_today_rows(today, lecturer_id: int | None = None) -> list[dict]:
    """One row per lecturer who teaches at least one class on `today`,
    combining however many classes they have that day into a single daily
    check-in/out record: check-in is measured against their first class's
    start time, check-out against their last class's end time. Rows with no
    check-in yet are synthesized on the fly so the dashboard is accurate even
    before the background job has run."""
    settings = get_all_settings()
    no_class_dates = get_no_class_dates(settings)
    now = datetime.now()

    query = User.query.filter_by(role="lecturer")
    if lecturer_id:
        query = query.filter_by(id=lecturer_id)

    rows = []
    for lecturer in query.all():
        entries = get_day_classes(lecturer.id, today, no_class_dates)
        if not entries:
            continue

        first_start, last_end = day_bounds(entries, today)
        record = Attendance.query.filter_by(lecturer_id=lecturer.id, date=today).first()

        if record:
            row = record.to_dict()
        else:
            status = "absent" if should_mark_absent(first_start, now, settings) else "not_yet"
            row = {
                "id": None,
                "lecturer_id": lecturer.id,
                "lecturer_name": lecturer.name,
                "date": today.isoformat(),
                "scheduled_start": first_start.isoformat(),
                "scheduled_end": last_end.isoformat() if last_end else None,
                "checkin_at": None,
                "checkout_at": None,
                "checkin_distance_m": None,
                "checkout_distance_m": None,
                "status": status,
                "status_label": Attendance.STATUS_LABELS.get(status, status),
                "remarks": None,
                "justified": False,
            }

        row["classes"] = _classes_payload(entries)
        row["sort_key"] = first_start
        rows.append(row)

    rows.sort(key=lambda r: r["sort_key"])
    for r in rows:
        r.pop("sort_key", None)
    return rows
