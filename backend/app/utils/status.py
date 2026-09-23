"""Attendance status rules, ported from the faculty's original Google Sheet.

Statuses: not_yet, on_time, late, absent, left_early, no_checkout.
"""
from datetime import datetime

from app.utils.settings import get_all_settings, get_setting_int


def minutes_between(a: datetime, b: datetime) -> float:
    return (a - b).total_seconds() / 60.0


def compute_checkin_status(scheduled_start: datetime, checkin_at: datetime, settings: dict | None = None) -> str:
    settings = settings if settings is not None else get_all_settings()
    late_after = get_setting_int("late_after_minutes", settings)
    absent_after = get_setting_int("absent_after_minutes", settings)

    minutes_late = minutes_between(checkin_at, scheduled_start)

    if absent_after > 0 and minutes_late > absent_after:
        return "absent"
    if late_after > 0 and minutes_late > late_after:
        return "late"
    return "on_time"


def compute_checkout_status(scheduled_end: datetime | None, checkout_at: datetime, current_status: str,
                             settings: dict | None = None) -> str:
    settings = settings if settings is not None else get_all_settings()
    left_early_after = get_setting_int("left_early_minutes", settings)

    if scheduled_end and left_early_after > 0:
        # Positive when checkout happens before scheduled_end (early), negative/zero when after (on time or late).
        minutes_before_end = minutes_between(scheduled_end, checkout_at)
        if minutes_before_end >= left_early_after:
            return "left_early"

    return current_status


def should_mark_absent(scheduled_start: datetime, now: datetime, settings: dict | None = None) -> bool:
    settings = settings if settings is not None else get_all_settings()
    absent_after = get_setting_int("absent_after_minutes", settings)
    if absent_after <= 0:
        return False
    return minutes_between(now, scheduled_start) > absent_after


def should_mark_no_checkout(scheduled_end: datetime, now: datetime, settings: dict | None = None) -> bool:
    settings = settings if settings is not None else get_all_settings()
    no_checkout_after = get_setting_int("no_checkout_after_minutes", settings)
    if no_checkout_after <= 0:
        return False
    return minutes_between(now, scheduled_end) > no_checkout_after
