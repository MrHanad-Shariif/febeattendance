"""Helpers for matching timetable entries against the current campus-local day/time.

All scheduling math uses naive datetimes in the campus's own local time zone
(the server should be run with that local time zone). This mirrors how the
original spreadsheet worked and avoids day-boundary bugs from mixing UTC and
local time for a single-campus deployment.
"""
from datetime import datetime, date as date_cls, timedelta

DAY_ABBR = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}


def day_abbr(d: date_cls) -> str:
    return DAY_ABBR[d.weekday()]


def teaches_on(timetable, d: date_cls, no_class_dates: set) -> bool:
    if d.isoformat() in no_class_dates:
        return False
    return day_abbr(d) in timetable.day_list()


def scheduled_datetimes(timetable, d: date_cls):
    start_dt = datetime.combine(d, timetable.start_time) if timetable.start_time else None
    end_dt = datetime.combine(d, timetable.end_time) if timetable.end_time else None
    return start_dt, end_dt


def is_within_checkin_window(start_dt: datetime, now: datetime, early_minutes: int = 30, late_grace_minutes: int = 180) -> bool:
    if not start_dt:
        return False
    window_start = start_dt - timedelta(minutes=early_minutes)
    window_end = start_dt + timedelta(minutes=late_grace_minutes)
    return window_start <= now <= window_end


def get_day_classes(lecturer_id: int, d: date_cls, no_class_dates: set):
    """All of one lecturer's timetable entries that meet on date `d`, sorted
    by start time. A lecturer checks in/out once a day regardless of how many
    of these there are -- see day_bounds()."""
    from app.models import Timetable  # local import: models.py doesn't import this module, but avoids any load-order surprises

    entries = Timetable.query.filter_by(lecturer_id=lecturer_id).all()
    todays = [e for e in entries if e.start_time and teaches_on(e, d, no_class_dates)]
    todays.sort(key=lambda e: e.start_time)
    return todays


def day_bounds(entries, d: date_cls):
    """Given a lecturer's classes for one day, return (first_start, last_end)
    as datetimes: check-in is measured against the first, check-out against
    the last. last_end is None if none of the classes have an end time set."""
    if not entries:
        return None, None
    first_start = datetime.combine(d, entries[0].start_time)
    end_times = [e.end_time for e in entries if e.end_time]
    last_end = datetime.combine(d, max(end_times)) if end_times else None
    return first_start, last_end


def get_batch_classes(batch: str, d: date_cls, no_class_dates: set):
    """All timetable entries for one student batch that meet on date `d`,
    sorted by start time. Students check in per session (unlike lecturers,
    who check in once a day), so each of these is checked in to separately."""
    from app.models import Timetable

    entries = Timetable.query.filter_by(batch=batch).all()
    todays = [e for e in entries if e.start_time and teaches_on(e, d, no_class_dates)]
    todays.sort(key=lambda e: e.start_time)
    return todays


def find_current_session(entries, now: datetime, checkin_open_minutes: int = 15):
    """Pick the one session (if any) a student should be checking into right
    now: the entry whose window from `checkin_open_minutes` before its start
    to its end (or start+2h if no end time) contains `now`. Entries must all
    be for the same date (as returned by get_batch_classes)."""
    for entry in entries:
        start_dt = datetime.combine(now.date(), entry.start_time)
        end_dt = datetime.combine(now.date(), entry.end_time) if entry.end_time else start_dt + timedelta(hours=2)
        window_start = start_dt - timedelta(minutes=checkin_open_minutes)
        if window_start <= now <= end_dt:
            return entry
    return None
