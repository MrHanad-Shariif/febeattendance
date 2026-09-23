from datetime import date, datetime

from datetime import timedelta

from flask import request, jsonify
from sqlalchemy.exc import IntegrityError

from app.student import student_bp
from app.extensions import db, limiter
from app.models import Timetable, StudentAttendance
from app.utils.authz import roles_required, current_user
from app.utils.geo import haversine_distance_m
from app.utils.student_code import verify_code
from app.utils.schedule import get_batch_classes, scheduled_datetimes, teaches_on
from app.utils.settings import get_all_settings, get_setting_float, get_no_class_dates
from app.utils.student_status import compute_student_checkin_status, is_course_blocked
from app.utils.student_today import get_student_today_rows
from app.utils.student_report import build_student_report
from app.utils.validation import clean_int, parse_coords

# Students may check in from this long before a session starts until it ends.
CHECKIN_OPENS_MINUTES_BEFORE = 30


PROFESSIONAL_BLOCK_MESSAGE = (
    "You are unable to check in to this class: your absences in this course have "
    "reached the {threshold}% limit. Today's session has been recorded as absent. "
    "Please visit the faculty office as soon as possible to resolve this."
)


@student_bp.get("/timetable")
@roles_required("student", "admin")
def my_timetable():
    user = current_user()
    if not user.batch:
        return jsonify([])
    entries = Timetable.query.filter_by(batch=user.batch).order_by(Timetable.start_time).all()
    return jsonify([e.to_dict() for e in entries])


@student_bp.get("/today")
@roles_required("student", "admin")
def my_today():
    user = current_user()
    return jsonify(get_student_today_rows(user, date.today()))


@student_bp.get("/report")
@roles_required("student", "admin")
def my_report():
    user = current_user()
    return jsonify(build_student_report(user))


def _verify_campus_presence(code: str, lat, lng, settings) -> tuple[bool, str, float | None]:
    mode = settings.get("student_verification_mode", "both")

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
        return bool(code_ok), "Incorrect or expired class code" if not code_ok else "", distance
    if mode == "location_only":
        return bool(location_ok), "You appear to be outside the campus area" if not location_ok else "", distance
    if mode == "either":
        passed = bool(code_ok) or bool(location_ok)
        reason = "" if passed else "Enter the class code shown on your lecturer's screen, or enable location and try again while on campus"
        return passed, reason, distance

    if not code_ok and not location_ok:
        return False, "Incorrect class code and you appear to be outside the campus area", distance
    if not code_ok:
        return False, "Incorrect or expired class code", distance
    if not location_ok:
        return False, "You appear to be outside the campus area", distance
    return True, "", distance


@student_bp.post("/checkin")
@roles_required("student")
@limiter.limit("10/minute", key_func=lambda: f"user:{current_user().id}")
def checkin():
    user = current_user()
    data = request.get_json(silent=True) or {}
    timetable_id = clean_int(data.get("timetable_id"), "timetable_id", minimum=1)
    code = str(data.get("code") or "")[:16]
    lat, lng = parse_coords(data.get("lat"), data.get("lng"))

    # A student with no batch must never match batch-less timetable rows.
    entry = Timetable.query.filter_by(id=timetable_id, batch=user.batch).first() if user.batch and timetable_id else None
    if not entry:
        return jsonify({"error": "Class session not found"}), 404

    today = date.today()
    settings = get_all_settings()
    no_class_dates = get_no_class_dates(settings)
    if not teaches_on(entry, today, no_class_dates):
        return jsonify({"error": "This class is not scheduled today"}), 400

    start_dt, end_dt = scheduled_datetimes(entry, today)

    now = datetime.now()
    if start_dt and now < start_dt - timedelta(minutes=CHECKIN_OPENS_MINUTES_BEFORE):
        return jsonify({"error": f"Check-in opens {CHECKIN_OPENS_MINUTES_BEFORE} minutes before the class starts"}), 400
    if end_dt and now > end_dt:
        return jsonify({"error": "This class has already ended"}), 400

    record = StudentAttendance.query.filter_by(student_id=user.id, timetable_id=entry.id, date=today).first()
    if record and record.checkin_at:
        return jsonify({"error": "You've already checked in for this class"}), 409
    if record and record.status == "absent" and not record.checkin_at:
        # Already auto-marked absent (late deadline passed, or a prior blocked attempt).
        return jsonify({"error": "This session is already closed and recorded as absent"}), 409

    blocked, stats = is_course_blocked(user.id, entry.batch, entry.course_name, settings)
    if blocked:
        if not record:
            record = StudentAttendance(
                student_id=user.id, timetable_id=entry.id, date=today,
                scheduled_start=start_dt, scheduled_end=end_dt, status="absent",
            )
            db.session.add(record)
            db.session.commit()
        return jsonify({
            "error": PROFESSIONAL_BLOCK_MESSAGE.format(threshold=stats["threshold_percent"]),
            "course_stats": stats,
        }), 403

    passed, reason, distance = _verify_campus_presence(code, lat, lng, settings)
    if not passed:
        return jsonify({"error": reason}), 403

    status = compute_student_checkin_status(start_dt, now, settings)

    if not record:
        record = StudentAttendance(student_id=user.id, timetable_id=entry.id, date=today,
                                    scheduled_start=start_dt, scheduled_end=end_dt)
        db.session.add(record)

    record.scheduled_start = start_dt
    record.scheduled_end = end_dt
    record.checkin_at = now
    record.checkin_lat = lat
    record.checkin_lng = lng
    record.checkin_distance_m = distance
    record.status = status

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "You've already checked in for this class"}), 409
    return jsonify(record.to_dict())
