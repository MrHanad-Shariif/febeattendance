import time

import pyotp
from flask import current_app


def _totp():
    return pyotp.TOTP(
        current_app.config["KIOSK_TOTP_SECRET"],
        interval=current_app.config["KIOSK_CODE_INTERVAL_SECONDS"],
        digits=current_app.config["KIOSK_CODE_DIGITS"],
    )


def current_code() -> str:
    return _totp().now()


def seconds_remaining() -> int:
    interval = current_app.config["KIOSK_CODE_INTERVAL_SECONDS"]
    return interval - int(time.time()) % interval


def verify_code(code: str) -> bool:
    """Accepts the current window and one window on either side to absorb clock
    drift and the time it takes a lecturer to read and type the code."""
    if not code:
        return False
    return _totp().verify(code.strip(), valid_window=1)
