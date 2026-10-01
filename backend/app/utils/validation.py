"""Small, dependency-free input validators shared by every route.

Routes raise ValidationError; a global handler (app/security.py) turns it into
a clean 400 JSON response, so route code never has to hand-roll try/except for
bad input and clients never see a 500 traceback for a malformed request.
"""
import re
from datetime import date, datetime

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt only uses the first 72 bytes; refuse rather than silently truncate

VALID_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
VERIFICATION_MODES = ("both", "either", "code_only", "location_only", "off")


class ValidationError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def clean_text(value, field: str, *, max_len: int = 255, required: bool = False) -> str | None:
    """Trim a user-supplied string. Non-strings are rejected (never coerced)."""
    if value is None:
        if required:
            raise ValidationError(f"{field} is required")
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be text")
    value = value.strip()
    if not value:
        if required:
            raise ValidationError(f"{field} is required")
        return None
    if len(value) > max_len:
        raise ValidationError(f"{field} must be at most {max_len} characters")
    return value


def clean_email(value, field: str = "Email") -> str:
    email = (clean_text(value, field, max_len=255, required=True) or "").lower()
    if not EMAIL_RE.match(email):
        raise ValidationError(f"{field} is not a valid email address")
    return email


def check_password(password) -> str:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise ValidationError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValidationError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
    if not password.strip():
        raise ValidationError("Password cannot be only spaces")
    return password


def clean_int(value, field: str, *, minimum: int | None = None, maximum: int | None = None,
              default: int | None = None) -> int | None:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise ValidationError(f"{field} must be a whole number")
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be a whole number")
    if minimum is not None and number < minimum:
        raise ValidationError(f"{field} must be at least {minimum}")
    if maximum is not None and number > maximum:
        raise ValidationError(f"{field} must be at most {maximum}")
    return number


def clean_days(value) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, list) or not all(isinstance(d, str) for d in value):
        raise ValidationError("Days must be a list of weekday names")
    bad = [d for d in value if d not in VALID_DAYS]
    if bad:
        raise ValidationError(f"Unknown weekday(s): {', '.join(bad)}")
    return ",".join(dict.fromkeys(value)) or None


def parse_hhmm(value, field: str):
    if value in (None, ""):
        return None
    try:
        return datetime.strptime(str(value), "%H:%M").time()
    except ValueError:
        raise ValidationError(f"{field} must be in HH:MM format")


def parse_iso_date(value, field: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be a date in YYYY-MM-DD format")


def parse_month(value: str, field: str = "month") -> tuple[int, int]:
    match = re.fullmatch(r"(\d{4})-(0[1-9]|1[0-2])", str(value or ""))
    if not match:
        raise ValidationError(f"{field} must be in YYYY-MM format")
    return int(match.group(1)), int(match.group(2))


def parse_coords(lat, lng) -> tuple[float | None, float | None]:
    """Validate a browser geolocation reading. Both missing -> (None, None)."""
    if lat in (None, "") and lng in (None, ""):
        return None, None
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        raise ValidationError("Location coordinates must be numbers")
    if isinstance(lat, bool) or isinstance(lng, bool):
        raise ValidationError("Location coordinates must be numbers")
    if not (-90 <= lat_f <= 90 and -180 <= lng_f <= 180) or lat_f != lat_f or lng_f != lng_f:
        raise ValidationError("Location coordinates are out of range")
    return lat_f, lng_f


def validate_settings(data: dict, current: dict) -> dict[str, str]:
    """Validate a partial settings update. Returns {key: cleaned string value}.
    Unknown keys are ignored (the caller filters to Setting.DEFAULTS)."""
    from app.models import Setting

    cleaned: dict[str, str] = {}
    merged = {**current}

    for key, raw in data.items():
        if key not in Setting.DEFAULTS:
            continue
        value = "" if raw is None else str(raw).strip()

        if key == "site_name":
            if not value or len(value) > 100:
                raise ValidationError("Site name is required (max 100 characters)")
        elif key == "semester_name":
            if not value or len(value) > 100:
                raise ValidationError("Semester name is required (max 100 characters)")
        elif "_minutes" in key:
            clean_int(value, key, minimum=0, maximum=1440)
        elif key in ("verification_mode", "student_verification_mode"):
            if value not in VERIFICATION_MODES:
                raise ValidationError(f"{key} must be one of: {', '.join(VERIFICATION_MODES)}")
        elif key == "location_rule":
            if value not in ("off", "flag", "require"):
                raise ValidationError("location_rule must be off, flag or require")
        elif key == "campus_lat":
            _float_in_range(value, key, -90, 90)
        elif key == "campus_lng":
            _float_in_range(value, key, -180, 180)
        elif key == "campus_radius_m":
            _float_in_range(value, key, 1, 100000)
        elif key == "no_class_dates":
            dates = [d.strip() for d in value.split(",") if d.strip()]
            for d in dates:
                parse_iso_date(d, "No-class date")
            value = ",".join(dates)
        elif key == "student_lates_equal_absent":
            clean_int(value, key, minimum=1, maximum=20)
        elif key == "student_absence_threshold_percent":
            clean_int(value, key, minimum=1, maximum=100)
        elif key in ("semester_start_date", "semester_end_date"):
            parse_iso_date(value, key)
        elif key == "student_face_verification":
            if value not in ("require", "off"):
                raise ValidationError("student_face_verification must be require or off")
        elif key == "face_match_threshold":
            _float_in_range(value, key, 0.2, 0.9)
        elif key == "dean_task_override":
            if value not in ("on", "off"):
                raise ValidationError("dean_task_override must be on or off")
        elif key == "face_max_attempts_per_session":
            clean_int(value, key, minimum=1, maximum=20)
        elif key == "email_mode":
            if value not in ("on", "paused", "off"):
                raise ValidationError("email_mode must be on, paused or off")
        elif key in ("email_notifications", "email_checkin_reminders", "email_account_messages"):
            if value not in ("on", "off"):
                raise ValidationError(f"{key} must be on or off")
        elif key in ("email_send_from", "email_send_until"):
            label = "Send emails from" if key == "email_send_from" else "Send emails until"
            parsed = parse_hhmm(value, label)
            value = parsed.strftime("%H:%M") if parsed else ""
        elif key == "email_send_days":
            days = clean_days([d.strip() for d in value.split(",") if d.strip()])
            if not days:
                raise ValidationError("Pick at least one sending day, or set Email sending to Paused or Off")
            value = ",".join(d for d in VALID_DAYS if d in days.split(","))  # week order

        cleaned[key] = value
        merged[key] = value

    if "semester_start_date" in cleaned or "semester_end_date" in cleaned:
        start = parse_iso_date(merged.get("semester_start_date"), "semester_start_date")
        end = parse_iso_date(merged.get("semester_end_date"), "semester_end_date")
        if end < start:
            raise ValidationError("Semester end date must not be before the start date")

    if "email_send_from" in cleaned or "email_send_until" in cleaned:
        start, end = merged.get("email_send_from") or "", merged.get("email_send_until") or ""
        if start and start == end:
            raise ValidationError("Sending hours need different start and end times (leave both empty to send at any hour)")

    return cleaned


def _float_in_range(value: str, key: str, low: float, high: float):
    try:
        number = float(value)
    except ValueError:
        raise ValidationError(f"{key} must be a number")
    if not (low <= number <= high):
        raise ValidationError(f"{key} must be between {low} and {high}")


def parse_deadline(value, field: str = "Deadline") -> datetime | None:
    """Accept 'YYYY-MM-DD' (end of that day) or 'YYYY-MM-DDTHH:MM[:SS]'."""
    if value in (None, ""):
        return None
    text = str(value).strip()
    try:
        if len(text) == 10:
            return datetime.combine(date.fromisoformat(text), datetime.max.time()).replace(microsecond=0)
        return datetime.fromisoformat(text).replace(tzinfo=None, microsecond=0)
    except ValueError:
        raise ValidationError(f"{field} must be a date (YYYY-MM-DD) or date and time (YYYY-MM-DDTHH:MM)")


def clean_choice(value, field: str, choices, *, default=None):
    if value in (None, ""):
        if default is None:
            raise ValidationError(f"{field} is required")
        return default
    if value not in choices:
        raise ValidationError(f"{field} must be one of: {', '.join(choices)}")
    return value
