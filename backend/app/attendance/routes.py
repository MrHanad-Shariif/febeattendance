from datetime import date, datetime

from flask import request, jsonify
from sqlalchemy.exc import IntegrityError

from app.attendance import attendance_bp
from app.extensions import db, limiter
from app.models import Attendance
from app.utils.authz import roles_required, current_user
from app.utils.geo import haversine_distance_m
from app.utils.kiosk_code import verify_code
from app.utils.schedule import get_day_classes, day_bounds
from app.utils.settings import get_all_settings, get_setting_float, get_no_class_dates
from app.utils.status import compute_checkin_status, compute_checkout_status
from app.utils.validation import clean_text, parse_coords


def _user_key():
    return f"user:{current_user().id}"


def _verify_campus_presence(code: str, lat, lng, settings) -> tuple[bool, str, float | None]:
    """Returns (passed, reason_if_failed, distance_m_if_known)."""
    mode = settings.get("verification_mode", "both")

    code_ok = verify_code(code) if mode in ("both", "either", "code_only") else None

    distance = None
    location_ok = None
    if mode in ("both", "either", "location_only"):
        if lat is None or lng is None:
            location_ok = False
        else:
            campus_lat = get_setting_float("campus_lat", settings)
            campus_lng = get_setting_float("campus_lng", settings)
            radius = get_setting_float("campus_radius_m", settings)
            distance = haversine_distance_m(float(lat), float(lng), campus_lat, campus_lng)
            location_ok = distance <= radius

    if mode == "off":
        return True, "", distance
    if mode == "code_only":
        return bool(code_ok), "Incorrect or expired campus code" if not code_ok else "", distance
    if mode == "location_only":
        return bool(location_ok), "You appear to be outside the campus area" if not location_ok else "", distance
    if mode == "either":
        passed = bool(code_ok) or bool(location_ok)
        reason = "" if passed else "Enter the campus code shown on the kiosk screen, or enable location and try again while on campus"
        return passed, reason, distance

    # default: both
    if not code_ok and not location_ok:
        return False, "Incorrect campus code and you appear to be outside the campus area", distance
    if not code_ok:
        return False, "Incorrect or expired campus code", distance
    if not location_ok:
        return False, "You appear to be outside the campus area", distance
    return True, "", distance


@attendance_bp.post("/checkin")
@roles_required("lecturer")
@limiter.limit("10/minute", key_func=_user_key)
def checkin():
    user = current_user()
    data = request.get_json(silent=True) or {}
    code = str(data.get("code") or "")[:16]
    lat, lng = parse_coords(data.get("lat"), data.get("lng"))

    today = date.today()
    settings = get_all_settings()
    no_class_dates = get_no_class_dates(settings)
    entries = get_day_classes(user.id, today, no_class_dates)
    if not entries:
        return jsonify({"error": "You have no classes scheduled today"}), 400
    first_start, last_end = day_bounds(entries, today)

    record = Attendance.query.filter_by(lecturer_id=user.id, date=today).first()
    if record and record.checkin_at:
        return jsonify({"error": "You've already checked in for today"}), 409

    passed, reason, distance = _verify_campus_presence(code, lat, lng, settings)
    if not passed:
        return jsonify({"error": reason}), 403

    now = datetime.now()
    status = compute_checkin_status(first_start, now, settings)

    if not record:
        record = Attendance(lecturer_id=user.id, date=today, scheduled_start=first_start, scheduled_end=last_end)
        db.session.add(record)

    record.scheduled_start = first_start
    record.scheduled_end = last_end
    record.checkin_at = now
    record.checkin_lat = lat
    record.checkin_lng = lng
    record.checkin_distance_m = distance
    record.status = status

    try:
        db.session.commit()
    except IntegrityError:  # two simultaneous submits raced on the one-row-per-day constraint
        db.session.rollback()
        return jsonify({"error": "You've already checked in for today"}), 409
    return jsonify(record.to_dict())


@attendance_bp.post("/checkout")
@roles_required("lecturer")
@limiter.limit("10/minute", key_func=_user_key)
def checkout():
    user = current_user()
    data = request.get_json(silent=True) or {}
    code = str(data.get("code") or "")[:16]
    lat, lng = parse_coords(data.get("lat"), data.get("lng"))
    note = clean_text(data.get("note"), "Note", max_len=500) or ""

    today = date.today()
    record = Attendance.query.filter_by(lecturer_id=user.id, date=today).first()
    if not record or not record.checkin_at:
        return jsonify({"error": "You need to check in before checking out"}), 400
    if record.checkout_at:
        return jsonify({"error": "You've already checked out for today"}), 409

    settings = get_all_settings()
    passed, reason, distance = _verify_campus_presence(code, lat, lng, settings)
    if not passed:
        return jsonify({"error": reason}), 403

    now = datetime.now()
    record.checkout_at = now
    record.checkout_lat = lat
    record.checkout_lng = lng
    record.checkout_distance_m = distance
    record.status = compute_checkout_status(record.scheduled_end, now, record.status, settings)
    if note:
        record.remarks = note

    db.session.commit()
    return jsonify(record.to_dict())
