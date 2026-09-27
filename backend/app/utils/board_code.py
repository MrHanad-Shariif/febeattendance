"""Board-code check-in: a short code the lecturer writes on the board.

Stands in for the two jobs the lecturer's screen does in QR check-in --
identifying the class and showing the student is in the room -- so classes
taught without a projector can still check in. Location and face checks are
unchanged. Codes are random (never derivable in advance), valid for one class
session only, and close automatically a set time after the class starts.
"""
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import func

from app.models import BoardCodeAttempt, BoardSession, StudentAttendance, User
from app.utils.schedule import scheduled_datetimes
from app.utils.settings import get_setting_int

BOARD_CODE_DIGITS = 4
# Wrong codes a student may type for one class before board check-in locks
# for them: 5 tries at a 4-digit code is a 0.05% chance of a lucky guess.
BOARD_CODE_MAX_WRONG = 5
# Board check-in can be opened this long before the class starts (same as
# the students' own check-in window).
BOARD_OPENS_MINUTES_BEFORE = 30


def new_code(previous: str | None = None) -> str:
    while True:
        code = f"{secrets.randbelow(10 ** BOARD_CODE_DIGITS):0{BOARD_CODE_DIGITS}d}"
        if code != previous:
            return code


def codes_match(expected: str, given: str) -> bool:
    return hmac.compare_digest(expected.encode(), (given or "").strip().encode())


def open_session(timetable_id: int, day, now: datetime | None = None) -> BoardSession | None:
    now = now or datetime.now()
    return (
        BoardSession.query.filter(
            BoardSession.timetable_id == timetable_id,
            BoardSession.date == day,
            BoardSession.closed_at.is_(None),
            BoardSession.closes_at > now,
        )
        .order_by(BoardSession.opened_at.desc())
        .first()
    )


def latest_session(timetable_id: int, day) -> BoardSession | None:
    return (
        BoardSession.query.filter_by(timetable_id=timetable_id, date=day)
        .order_by(BoardSession.opened_at.desc())
        .first()
    )


def auto_close_time(entry, day, settings) -> datetime:
    """When board check-in closes by itself: N minutes after the class starts
    (N = board_code_close_after_minutes, default 20 = the student 'absent
    after' rule), or the class end when N is 0. Never after the class ends."""
    start_dt, end_dt = scheduled_datetimes(entry, day)
    end_dt = end_dt or start_dt + timedelta(hours=2)
    minutes = get_setting_int("board_code_close_after_minutes", settings)
    closes = start_dt + timedelta(minutes=minutes) if minutes > 0 else end_dt
    return min(closes, end_dt)


def failed_attempts(student_id: int, timetable_id: int, day) -> int:
    return BoardCodeAttempt.query.filter_by(
        student_id=student_id, timetable_id=timetable_id, date=day, success=False,
    ).count()


def live_counts(entry, day) -> dict:
    """Checked-in students for the lecturer's live counter, split by method."""
    rows = (
        StudentAttendance.query.with_entities(StudentAttendance.checkin_method, func.count())
        .filter(
            StudentAttendance.timetable_id == entry.id,
            StudentAttendance.date == day,
            StudentAttendance.checkin_at.isnot(None),
        )
        .group_by(StudentAttendance.checkin_method)
        .all()
    )
    by_method = {method or "qr": count for method, count in rows}
    enrolled = User.query.filter_by(role="student", batch=entry.batch, status="active").count() if entry.batch else 0
    return {
        "checked_in": sum(by_method.values()),
        "board": by_method.get("board", 0),
        "qr": by_method.get("qr", 0),
        "enrolled": enrolled,
    }
