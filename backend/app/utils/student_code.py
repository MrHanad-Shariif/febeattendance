"""Rotating class codes that students type in during check-in.

Each class session (one timetable entry on one date) has its own TOTP secret,
derived from STUDENT_CODE_TOTP_SECRET, so the code on one batch's screen is
useless in any other batch's session -- sharing it across batches gets nobody
checked in.
"""
import base64
import hashlib
import hmac
import time
from datetime import date

import pyotp
from flask import current_app


def _session_secret(timetable_id: int, day: date) -> str:
    master = current_app.config["STUDENT_CODE_TOTP_SECRET"].encode("utf-8")
    digest = hmac.new(master, f"{timetable_id}:{day.isoformat()}".encode("utf-8"), hashlib.sha256).digest()
    return base64.b32encode(digest).decode("ascii").rstrip("=")


def _totp(timetable_id: int, day: date):
    return pyotp.TOTP(
        _session_secret(timetable_id, day),
        interval=current_app.config["STUDENT_CODE_INTERVAL_SECONDS"],
        digits=current_app.config["STUDENT_CODE_DIGITS"],
    )


def current_code(timetable_id: int, day: date) -> str:
    return _totp(timetable_id, day).now()


def seconds_remaining() -> int:
    interval = current_app.config["STUDENT_CODE_INTERVAL_SECONDS"]
    return interval - int(time.time()) % interval


def verify_code(timetable_id: int, day: date, code: str) -> bool:
    if not code:
        return False
    return _totp(timetable_id, day).verify(code.strip(), valid_window=1)
