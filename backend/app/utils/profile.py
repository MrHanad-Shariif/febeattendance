"""Student profile fields: which a student edits directly, which need an
administrator's approval, how each value is validated, and the audit trail."""
import re

from app.extensions import db
from app.models import Batch, ProfileChange, User
from app.utils.constants import DEPARTMENTS
from app.utils.settings import get_all_settings, get_setting_str
from app.utils.validation import ValidationError, clean_email, clean_text

FIELD_LABELS = {
    "name": "Full name",
    "email": "Email address",
    "student_id_number": "Student ID",
    "department": "Department",
    "program": "Program",
    "batch": "Class",
    "study_semester": "Semester",
    "phone": "Phone number",
}
FIELDS = tuple(FIELD_LABELS)
PHONE_RE = re.compile(r"^\+?[0-9][0-9 \-]{6,18}$")


def _field_list(key, settings=None) -> list[str]:
    settings = settings if settings is not None else get_all_settings()
    return [f.strip() for f in (get_setting_str(key, settings) or "").split(",") if f.strip() in FIELDS]


def self_edit_fields(settings=None) -> list[str]:
    return _field_list("student_profile_self_edit", settings)


def approval_fields(settings=None) -> list[str]:
    return [f for f in _field_list("student_profile_approval", settings) if f not in self_edit_fields(settings)]


def clean_field_list(value: str) -> str:
    fields = [f.strip() for f in (value or "").split(",") if f.strip()]
    bad = [f for f in fields if f not in FIELDS]
    if bad:
        raise ValidationError(f"Unknown profile field: {bad[0]}. Use: {', '.join(FIELDS)}")
    return ",".join(dict.fromkeys(fields))


def clean_value(field: str, value, student: User) -> str | None:
    """Validated new value for `field` (raises ValidationError)."""
    if field == "name":
        return clean_text(value, "Full name", max_len=200, required=True)
    if field == "email":
        email = clean_email(value)
        other = User.query.filter(db.func.lower(User.email) == email.lower(), User.id != student.id).first()
        if other:
            raise ValidationError("That email address is already used by another account", status=409)
        return email
    if field == "student_id_number":
        sid = clean_text(value, "Student ID", max_len=50, required=True).upper()
        if not re.fullmatch(r"[A-Z0-9/\-]{3,50}", sid):
            raise ValidationError("A student ID uses only letters, numbers, / and -")
        if User.query.filter(User.student_id_number == sid, User.id != student.id).first():
            raise ValidationError("That student ID is already registered to another account", status=409)
        return sid
    if field == "department":
        dept = clean_text(value, "Department", max_len=150, required=True)
        if dept not in DEPARTMENTS:
            raise ValidationError("Choose one of the faculty's departments")
        return dept
    if field == "program":
        return clean_text(value, "Program", max_len=150, required=True)
    if field == "batch":
        code = clean_text(value, "Class", max_len=50, required=True)
        if not Batch.query.filter_by(code=code).first():
            raise ValidationError("Choose a class from the list")
        return code
    if field == "study_semester":
        sem = clean_text(value, "Semester", max_len=30, required=True)
        if not re.fullmatch(r"[1-9]|1[0-2]", sem):
            raise ValidationError("The semester is a number from 1 to 12")
        return sem
    if field == "phone":
        phone = clean_text(value, "Phone number", max_len=30)
        if phone and not PHONE_RE.match(phone):
            raise ValidationError("Enter a phone number with 7 to 19 digits, e.g. +252 61 5551234")
        return phone
    raise ValidationError("Unknown profile field")


def record_change(user: User, field: str, old, new, source: str, actor: User | None, request_id=None):
    if (old or None) == (new or None):
        return
    db.session.add(ProfileChange(
        user_id=user.id, field=field, old_value=(str(old) if old is not None else None),
        new_value=(str(new) if new is not None else None), source=source, request_id=request_id,
        changed_by_id=actor.id if actor else None, changed_by_name=actor.name if actor else None,
    ))


def profile_payload(student: User) -> dict:
    return {f: getattr(student, f) for f in FIELDS} | {
        "faculty": "Faculty of Engineering and Built Environment",
        "photo_url": f"/api/uploads/{student.photo_filename}" if student.photo_filename else None,
    }
