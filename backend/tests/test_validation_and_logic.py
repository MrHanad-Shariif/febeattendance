"""Input validation, settings, config safety and attendance business rules."""
from datetime import date, datetime, time, timedelta

import pytest

from app import create_app
from app.config import Config, TestingConfig, validate_production_config
from app.extensions import db
from app.models import Attendance, Timetable
from app.utils.status import compute_checkin_status, compute_checkout_status
from app.utils.validation import ValidationError, parse_coords, validate_settings
from tests.conftest import auth_header, make_user


# ---------- settings validation ----------

def test_settings_reject_bad_values(client, admin):
    headers = auth_header(admin)
    bad_payloads = [
        {"campus_lat": "abc"},
        {"campus_lat": "200"},
        {"campus_radius_m": "-5"},
        {"verification_mode": "sometimes"},
        {"late_after_minutes": "ten"},
        {"no_class_dates": "2026-13-45"},
        {"student_absence_threshold_percent": "500"},
        {"semester_start_date": "2027-03-01", "semester_end_date": "2027-02-01"},
    ]
    for payload in bad_payloads:
        resp = client.put("/api/admin/settings", json=payload, headers=headers)
        assert resp.status_code == 400, payload


def test_settings_accept_good_values(client, admin):
    resp = client.put(
        "/api/admin/settings",
        json={"late_after_minutes": "15", "verification_mode": "code_only", "no_class_dates": "2026-10-01, 2026-12-25"},
        headers=auth_header(admin),
    )
    assert resp.status_code == 200
    values = {row["key"]: row["value"] for row in resp.json}
    assert values["late_after_minutes"] == "15"
    assert values["no_class_dates"] == "2026-10-01,2026-12-25"


def test_validate_settings_ignores_unknown_keys():
    assert validate_settings({"totally_unknown": "x"}, {}) == {}


# ---------- request validation ----------

def test_timetable_validation(client, admin, lecturer):
    headers = auth_header(admin)
    base = {"lecturer_id": lecturer.id, "course_name": "Statics", "start_time": "08:00", "end_time": "10:00"}

    assert client.post("/api/admin/timetable", json=base, headers=headers).status_code == 201
    for override in (
        {"start_time": "25:99"},
        {"end_time": "07:00"},            # ends before it starts
        {"days": ["Someday"]},
        {"sessions": "many"},
        {"course_name": 123},
        {"lecturer_id": "abc"},
    ):
        resp = client.post("/api/admin/timetable", json={**base, **override}, headers=headers)
        assert resp.status_code in (400,), override


def test_bad_query_params_return_400_not_500(client, admin):
    headers = auth_header(admin)
    assert client.get("/api/admin/attendance?from=not-a-date", headers=headers).status_code == 400
    assert client.get("/api/admin/summary?month=2026-99", headers=headers).status_code == 400
    assert client.get("/api/admin/attendance?status=bogus", headers=headers).status_code == 400


def test_create_lecturer_validation(client, admin):
    headers = auth_header(admin)
    assert client.post("/api/admin/lecturers", json={"name": "A", "email": "not-an-email"}, headers=headers).status_code == 400
    assert client.post("/api/admin/lecturers", json={"name": ["x"], "email": "a@b.co"}, headers=headers).status_code == 400


def test_coordinates_validation():
    assert parse_coords(None, None) == (None, None)
    assert parse_coords("2.03", "45.3") == (2.03, 45.3)
    for lat, lng in (("abc", 1), (91, 0), (0, 181), (True, 1), ("nan", 1)):
        with pytest.raises(ValidationError):
            parse_coords(lat, lng)


# ---------- student registration ----------

def _register(client, **overrides):
    if not Timetable.query.filter_by(batch="BCE08").first():
        db.session.add(Timetable(lecturer_id=make_user("lec@example.com").id, course_name="X", batch="BCE08"))
        db.session.commit()
    form = {
        "name": "New Student", "email": "new@student.test", "password": "long-enough-pass",
        "student_id_number": "S123", "batch": "BCE08", "face_consent": "true",
        **overrides,
    }
    return client.post("/api/auth/register-student", data=form)


def test_register_returns_face_enroll_token(client):
    resp = _register(client)
    assert resp.status_code == 201, resp.json
    assert resp.json["enroll_token"]


def test_register_requires_face_consent(client):
    resp = _register(client, face_consent="")
    assert resp.status_code == 400
    assert "face" in resp.json["error"].lower()


def test_register_rejects_unknown_batch_and_department(client):
    assert _register(client, batch="NOPE99").status_code == 400
    assert _register(client, email="b@student.test", student_id_number="S9", department="Nope").status_code == 400


# ---------- attendance status rules ----------

def test_checkin_status_thresholds():
    start = datetime(2026, 10, 5, 8, 0)
    s = {"late_after_minutes": "10", "absent_after_minutes": "50"}
    assert compute_checkin_status(start, start + timedelta(minutes=5), s) == "on_time"
    assert compute_checkin_status(start, start + timedelta(minutes=11), s) == "late"
    assert compute_checkin_status(start, start + timedelta(minutes=51), s) == "absent"
    assert compute_checkin_status(start, start - timedelta(minutes=30), s) == "on_time"


def test_checkout_left_early():
    end = datetime(2026, 10, 5, 12, 0)
    s = {"left_early_minutes": "25"}
    assert compute_checkout_status(end, end - timedelta(minutes=30), "on_time", s) == "left_early"
    assert compute_checkout_status(end, end - timedelta(minutes=10), "on_time", s) == "on_time"
    assert compute_checkout_status(end, end + timedelta(minutes=5), "late", s) == "late"


def test_no_checkout_job_flags_previous_days(app):
    from app.jobs import mark_no_checkouts

    lecturer = make_user("forgetful@example.com")
    yesterday = date.today() - timedelta(days=1)
    record = Attendance(
        lecturer_id=lecturer.id, date=yesterday,
        scheduled_start=datetime.combine(yesterday, time(8)), scheduled_end=datetime.combine(yesterday, time(12)),
        checkin_at=datetime.combine(yesterday, time(8)), status="on_time",
    )
    db.session.add(record)
    db.session.commit()

    mark_no_checkouts(app)
    db.session.refresh(record)
    assert record.status == "no_checkout"


# ---------- production config guard ----------

def test_production_config_rejects_placeholders():
    problems = validate_production_config(vars(Config) | {"APP_ENV": "production"})
    joined = " ".join(problems)
    assert "SECRET_KEY" in joined and "JWT_SECRET_KEY" in joined
    assert "APP_TIMEZONE" in joined


def test_production_app_refuses_to_boot_with_defaults():
    class Prod(Config):
        APP_ENV = "production"

    with pytest.raises(RuntimeError, match="unsafe configuration"):
        create_app(Prod)


def test_production_config_accepts_strong_values():
    good = {
        "SECRET_KEY": "k" * 48, "JWT_SECRET_KEY": "j" * 48, "KIOSK_TOTP_SECRET": "JBSWY3DPEHPK3PXP" * 3,
        "KIOSK_ACCESS_KEY": "a-long-random-kiosk-access-key-value-1234567890",
        "STUDENT_CODE_TOTP_SECRET": "MFRGGZDFMZTWQ2LK" * 3,
        "SQLALCHEMY_DATABASE_URI": "postgresql+psycopg://u:strongpw@db/x",
        "DEFAULT_ADMIN_PASSWORD": "S0me-Str0ng-Passphrase!",
        "FRONTEND_ORIGIN": "https://febeattendance.mansok.com", "FRONTEND_BASE_URL": "https://febeattendance.mansok.com",
        "APP_TIMEZONE": "Africa/Mogadishu",
    }
    assert validate_production_config(good) == []


def test_production_forces_debug_off(monkeypatch):
    monkeypatch.setenv("FLASK_DEBUG", "1")

    class Prod(TestingConfig):
        APP_ENV = "production"
        TESTING = True  # skip the scheduler, keep everything else
        SECRET_KEY = "k" * 48
        JWT_SECRET_KEY = "j" * 48
        KIOSK_TOTP_SECRET = "JBSWY3DPEHPK3PXP" * 3
        KIOSK_ACCESS_KEY = "a-long-random-kiosk-access-key-value-1234567890"
        STUDENT_CODE_TOTP_SECRET = "MFRGGZDFMZTWQ2LK" * 3
        SQLALCHEMY_DATABASE_URI = "sqlite://"
        DEFAULT_ADMIN_PASSWORD = "S0me-Str0ng-Passphrase!"
        FRONTEND_ORIGIN = FRONTEND_BASE_URL = "https://febeattendance.mansok.com"
        APP_TIMEZONE = "Africa/Mogadishu"

    assert create_app(Prod).debug is False
