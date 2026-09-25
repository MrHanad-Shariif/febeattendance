import secrets
from datetime import date, datetime, timedelta

from flask import current_app, request, jsonify
from sqlalchemy.exc import IntegrityError

from app.student import student_bp
from app.extensions import db, limiter
from app.models import FaceCheckAttempt, Timetable, StudentAttendance
from app.utils import face
from app.utils.authz import roles_required, current_user
from app.utils.checkin_session import load_session_token, load_ticket, make_ticket
from app.utils.face_enrollment import enroll_student_face
from app.utils.geo import haversine_distance_m
from app.utils.student_code import verify_code
from app.utils.schedule import scheduled_datetimes, teaches_on
from app.utils.settings import get_all_settings, get_setting_float, get_setting_int, get_no_class_dates
from app.utils.student_status import compute_student_checkin_status, is_course_blocked
from app.utils.student_today import get_student_today_rows
from app.utils.student_report import build_student_report
from app.utils.validation import parse_coords

# Students may check in from this long before a session starts until it ends.
CHECKIN_OPENS_MINUTES_BEFORE = 30


PROFESSIONAL_BLOCK_MESSAGE = (
    "You are unable to check in to this class: your absences in this course have "
    "reached the {threshold}% limit. Today's session has been recorded as absent. "
    "Please visit the faculty office as soon as possible to resolve this."
)
WRONG_BATCH_MESSAGE = (
    "This QR code belongs to another class ({batch} - {course}). You can only check in "
    "to your own class. Please scan the QR code displayed by your own lecturer."
)
FACE_MISMATCH_MESSAGE = (
    "Face verification unsuccessful. The face captured does not match the face registered "
    "to this account, so your attendance has not been recorded. Attendance can only be "
    "recorded by the registered student in person. If you believe this is an error, "
    "please speak to your lecturer or the faculty office."
)
TOO_MANY_ATTEMPTS_MESSAGE = (
    "Too many unsuccessful face scans for this class, so check-in is locked for this session. "
    "Please see your lecturer, who can record your attendance."
)
FACE_NOT_ENROLLED_MESSAGE = "Please register your face before checking in."

# Face attempts that count toward the per-session limit (a blurry or empty
# frame doesn't -- the student just retries).
COUNTED_FACE_FAILURES = ("mismatch", "no_liveness")


class CheckinRefused(Exception):
    def __init__(self, message: str, status: int = 400, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra


@student_bp.errorhandler(CheckinRefused)
def _refused(err: CheckinRefused):
    return jsonify({"error": err.message, **err.extra}), err.status


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


@student_bp.post("/face")
@roles_required("student")
@limiter.limit("10/hour", key_func=lambda: f"user:{current_user().id}")
def enroll_my_face():
    """Face registration for a signed-in student who doesn't have one yet
    (registered before face check-in existed, or after an admin reset)."""
    enroll_student_face(current_user())
    return jsonify({"message": "Your face has been registered.", "user": current_user().to_dict()}), 201


# ---------- Step-by-step check-in ----------
#
# QR (session token) -> login -> start -> code -> location -> complete (face).
# Each step returns a signed ticket recording what has been verified so far;
# `complete` refuses unless the ticket shows every required step passed.

def _steps(settings) -> dict:
    mode = settings.get("student_verification_mode", "both")
    return {
        "code": mode in ("both", "either", "code_only"),
        "location": mode in ("both", "either", "location_only"),
        "face": settings.get("student_face_verification", "require") == "require",
    }


def _open_session(user, timetable_id: int, day: date, settings):
    """Every check that must hold at each step: right batch, class running
    now, not already checked in, not blocked. Returns (entry, start_dt, end_dt)."""
    entry = Timetable.query.get(timetable_id)
    if not entry:
        raise CheckinRefused("This class session no longer exists.", 404)
    if day != date.today():
        raise CheckinRefused("This QR code is for a class on another day. Please scan the QR code on your lecturer's screen.")
    if not user.batch or entry.batch != user.batch:
        raise CheckinRefused(
            WRONG_BATCH_MESSAGE.format(batch=entry.batch or "no batch", course=entry.course_name),
            403, reason="wrong_batch",
        )
    if not teaches_on(entry, day, get_no_class_dates(settings)):
        raise CheckinRefused("This class is not scheduled today.")

    start_dt, end_dt = scheduled_datetimes(entry, day)
    now = datetime.now()
    if start_dt and now < start_dt - timedelta(minutes=CHECKIN_OPENS_MINUTES_BEFORE):
        raise CheckinRefused(f"Check-in opens {CHECKIN_OPENS_MINUTES_BEFORE} minutes before the class starts.")
    if end_dt and now > end_dt:
        raise CheckinRefused("This class has already ended.")

    record = StudentAttendance.query.filter_by(student_id=user.id, timetable_id=entry.id, date=day).first()
    if record and record.checkin_at:
        raise CheckinRefused("You've already checked in for this class.", 409, reason="already_checked_in")
    if record and record.status == "absent":
        # Already auto-marked absent (late deadline passed, or a prior blocked attempt).
        raise CheckinRefused("This session is already closed and recorded as absent.", 409)

    blocked, stats = is_course_blocked(user.id, entry.batch, entry.course_name, settings)
    if blocked:
        if not record:
            db.session.add(StudentAttendance(
                student_id=user.id, timetable_id=entry.id, date=day,
                scheduled_start=start_dt, scheduled_end=end_dt, status="absent",
            ))
            db.session.commit()
        raise CheckinRefused(
            PROFESSIONAL_BLOCK_MESSAGE.format(threshold=stats["threshold_percent"]),
            403, course_stats=stats, reason="blocked",
        )
    return entry, start_dt, end_dt


def _ticket_session(user, settings):
    data = request.get_json(silent=True) if request.is_json else request.form
    ticket = load_ticket((data or {}).get("ticket"), user.id)
    entry, start_dt, end_dt = _open_session(user, ticket["t"], date.fromisoformat(ticket["d"]), settings)
    return data, ticket, entry, start_dt, end_dt


def _failed_face_attempts(user_id: int, timetable_id: int, day: date) -> int:
    return FaceCheckAttempt.query.filter(
        FaceCheckAttempt.student_id == user_id,
        FaceCheckAttempt.timetable_id == timetable_id,
        FaceCheckAttempt.date == day,
        FaceCheckAttempt.result.in_(COUNTED_FACE_FAILURES),
    ).count()


def _reply(ticket: dict, **extra):
    return jsonify({
        "ticket": make_ticket(**ticket),
        "code_verified": ticket["code"],
        "location_verified": ticket["loc"],
        "challenge": ticket["dir"],
        **extra,
    })


@student_bp.post("/checkin/start")
@roles_required("student")
@limiter.limit("20/minute", key_func=lambda: f"user:{current_user().id}")
def checkin_start():
    user = current_user()
    settings = get_all_settings()
    timetable_id, day = load_session_token((request.get_json(silent=True) or {}).get("s"))
    entry, start_dt, end_dt = _open_session(user, timetable_id, day, settings)

    steps = _steps(settings)
    if steps["face"] and user.face is None:
        raise CheckinRefused(FACE_NOT_ENROLLED_MESSAGE, 403, reason="face_not_enrolled")

    ticket = {
        "uid": user.id, "t": entry.id, "d": day.isoformat(),
        "code": False, "loc": False, "lat": None, "lng": None, "dist": None,
        "dir": secrets.choice(("left", "right")),
    }
    return _reply(ticket, steps=steps, session={
        "timetable_id": entry.id,
        "course_name": entry.course_name,
        "batch": entry.batch,
        "room": entry.room,
        "lecturer_name": entry.lecturer.name if entry.lecturer else None,
        "scheduled_start": start_dt.isoformat() if start_dt else None,
        "scheduled_end": end_dt.isoformat() if end_dt else None,
        "code_digits": current_app.config["STUDENT_CODE_DIGITS"],
    })


@student_bp.post("/checkin/code")
@roles_required("student")
@limiter.limit("10/minute", key_func=lambda: f"user:{current_user().id}")
def checkin_code():
    user = current_user()
    settings = get_all_settings()
    data, ticket, entry, _, _ = _ticket_session(user, settings)

    code = str(data.get("code") or "")[:16]
    if not verify_code(entry.id, date.fromisoformat(ticket["d"]), code):
        raise CheckinRefused("Incorrect or expired class code. Enter the code currently shown on your lecturer's screen.", 403)
    ticket["code"] = True
    return _reply(ticket)


@student_bp.post("/checkin/location")
@roles_required("student")
@limiter.limit("10/minute", key_func=lambda: f"user:{current_user().id}")
def checkin_location():
    user = current_user()
    settings = get_all_settings()
    data, ticket, _, _, _ = _ticket_session(user, settings)
    if _steps(settings)["code"] and not ticket["code"]:
        raise CheckinRefused("Please enter the class code first.")

    lat, lng = parse_coords(data.get("lat"), data.get("lng"))
    if lat is None:
        raise CheckinRefused("Turn on location so we can confirm you're on campus.")
    distance = haversine_distance_m(
        lat, lng, get_setting_float("campus_lat", settings), get_setting_float("campus_lng", settings),
    )
    if distance > get_setting_float("campus_radius_m", settings):
        raise CheckinRefused(
            f"You appear to be outside the campus area (about {round(distance)} m away). "
            "Check-in is only possible from campus.", 403, distance_m=round(distance),
        )
    ticket.update(loc=True, lat=lat, lng=lng, dist=distance)
    return _reply(ticket, distance_m=round(distance))


@student_bp.post("/checkin/complete")
@roles_required("student")
@limiter.limit("10/minute", key_func=lambda: f"user:{current_user().id}")
def checkin_complete():
    """Final step: the live face scan (when required), then the attendance
    record. Sent as multipart form data: ticket, frontal, turned."""
    user = current_user()
    settings = get_all_settings()
    _, ticket, entry, start_dt, end_dt = _ticket_session(user, settings)
    day = date.fromisoformat(ticket["d"])

    steps = _steps(settings)
    if (steps["code"] and not ticket["code"]) or (steps["location"] and not ticket["loc"]):
        raise CheckinRefused("Please complete the earlier check-in steps first.")

    if steps["face"]:
        if user.face is None:
            raise CheckinRefused(FACE_NOT_ENROLLED_MESSAGE, 403, reason="face_not_enrolled")
        max_attempts = get_setting_int("face_max_attempts_per_session", settings)
        if _failed_face_attempts(user.id, entry.id, day) >= max_attempts:
            raise CheckinRefused(TOO_MANY_ATTEMPTS_MESSAGE, 429, reason="face_locked")

        frontal = face.read_frames(request.files, "frontal", 1)[0]
        turned = face.read_frames(request.files, "turned", 1)[0]
        try:
            score = face.verify(frontal, turned, ticket["dir"], face.unpack(user.face.embeddings))
        except face.FaceError as err:
            _log_attempt(user, entry, day, err.reason, None)
            raise

        matched = score >= get_setting_float("face_match_threshold", settings)
        _log_attempt(user, entry, day, "match" if matched else "mismatch", score)
        if not matched:
            remaining = max_attempts - _failed_face_attempts(user.id, entry.id, day)
            raise CheckinRefused(FACE_MISMATCH_MESSAGE, 403, reason="face_mismatch", attempts_remaining=max(remaining, 0))

    record = _record_checkin(user, entry, day, start_dt, end_dt, ticket, settings)
    return jsonify(record.to_dict())


def _log_attempt(user, entry, day, result: str, score):
    db.session.add(FaceCheckAttempt(student_id=user.id, timetable_id=entry.id, date=day, result=result, score=score))
    db.session.commit()


def _record_checkin(user, entry, day, start_dt, end_dt, ticket, settings) -> StudentAttendance:
    now = datetime.now()
    record = StudentAttendance.query.filter_by(student_id=user.id, timetable_id=entry.id, date=day).first()
    if not record:
        record = StudentAttendance(student_id=user.id, timetable_id=entry.id, date=day,
                                   scheduled_start=start_dt, scheduled_end=end_dt)
        db.session.add(record)

    record.scheduled_start = start_dt
    record.scheduled_end = end_dt
    record.checkin_at = now
    record.checkin_lat = ticket["lat"]
    record.checkin_lng = ticket["lng"]
    record.checkin_distance_m = ticket["dist"]
    record.status = compute_student_checkin_status(start_dt, now, settings)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise CheckinRefused("You've already checked in for this class.", 409, reason="already_checked_in")
    return record
