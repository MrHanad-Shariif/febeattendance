import time

import pyotp
from flask import current_app


def _totp():
    return pyotp.TOTP(
        current_app.config["STUDENT_CODE_TOTP_SECRET"],
        interval=current_app.config["STUDENT_CODE_INTERVAL_SECONDS"],
        digits=current_app.config["STUDENT_CODE_DIGITS"],
    )


def current_code() -> str:
    return _totp().now()


def seconds_remaining() -> int:
    interval = current_app.config["STUDENT_CODE_INTERVAL_SECONDS"]
    return interval - int(time.time()) % interval


def verify_code(code: str) -> bool:
    if not code:
        return False
    return _totp().verify(code.strip(), valid_window=1)
