"""Signed tokens for the student check-in flow.

* Session token -- what the lecturer's on-screen QR code carries: one class
  session (timetable entry + date). Signed, so a student can't edit the ID to
  point at another batch's class.
* Check-in ticket -- carries a student's progress through the check-in steps
  (code -> location -> face). The class code rotates every few seconds, so the
  steps can't all re-check it at the end; instead each step signs what it
  verified, bound to the student and session, and expires after a few minutes.
* Enrollment token -- lets a just-registered student (who can't log in until
  their email is confirmed) register their face right after sign-up.
"""
from datetime import date

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.utils.validation import ValidationError

SESSION_TOKEN_MAX_AGE = 24 * 3600
TICKET_MAX_AGE = 5 * 60
ENROLL_TOKEN_MAX_AGE = 30 * 60


def _serializer(salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=salt)


def _load(salt: str, token, max_age: int, expired_message: str) -> dict:
    if not isinstance(token, str) or not token or len(token) > 2000:
        raise ValidationError("This check-in link is invalid. Please scan the QR code again.")
    try:
        return _serializer(salt).loads(token, max_age=max_age)
    except SignatureExpired:
        raise ValidationError(expired_message)
    except BadSignature:
        raise ValidationError("This check-in link is invalid. Please scan the QR code again.")


def make_session_token(timetable_id: int, day: date) -> str:
    return _serializer("student-session").dumps({"t": timetable_id, "d": day.isoformat()})


def load_session_token(token) -> tuple[int, date]:
    data = _load("student-session", token, SESSION_TOKEN_MAX_AGE,
                 "This QR code has expired. Please scan the one on your lecturer's screen.")
    return int(data["t"]), date.fromisoformat(data["d"])


def make_ticket(**fields) -> str:
    return _serializer("student-checkin").dumps(fields)


def load_ticket(token, user_id: int) -> dict:
    data = _load("student-checkin", token, TICKET_MAX_AGE,
                 "Your check-in took too long and has timed out. Please scan the QR code and start again.")
    if data.get("uid") != user_id:
        raise ValidationError("This check-in link is invalid. Please scan the QR code again.")
    return data


def make_enroll_token(user_id: int) -> str:
    return _serializer("face-enroll").dumps({"uid": user_id})


def load_enroll_token(token) -> int:
    data = _load("face-enroll", token, ENROLL_TOKEN_MAX_AGE,
                 "Face registration timed out. Sign in after confirming your email and you'll be asked to register your face.")
    return int(data["uid"])
