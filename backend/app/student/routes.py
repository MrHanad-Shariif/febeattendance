import secrets
from datetime import date, datetime, timedelta

from flask import current_app, g, request, jsonify
from sqlalchemy.exc import IntegrityError

from app.student import student_bp
from app.extensions import db, limiter
from app.models import BoardCodeAttempt, BoardSession, FaceCheckAttempt, Timetable, StudentAttendance
from app.utils import board_code, face
from app.utils.authz import roles_required, current_user
from app.utils.checkin_session import load_session_token, load_ticket, make_ticket
from app.utils.face_enrollment import enroll_student_face
from app.utils.geo import haversine_distance_m
from app.utils.student_code import verify_code
from app.utils.batches import batch_filter, batch_matches
from app.utils.schedule import get_batch_classes, scheduled_datetimes, teaches_on
from app.utils.settings import get_all_settings, get_setting_float, get_setting_int, get_no_class_dates
from app.utils.student_status import compute_student_checkin_status, is_course_blocked
from app.utils.absences import is_session_exempt
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
BOARD_NOT_OPEN_MESSAGE = (
    "Board check-in isn't open for this class right now. If your lecturer is showing a QR code, "
    "scan it instead; otherwise ask your lecturer to start board check-in."
)
BOARD_CLOSED_MESSAGE = "Your lecturer has closed board check-in for this class."
BOARD_LOCKED_MESSAGE = (
    "Too many wrong board codes for this class, so board check-in is locked for you in this session. "
    "Please see your lecturer, who can record your attendance."
)

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
    g.activity_detail = f"Refused: {err.extra.get('reason') or err.message}"
    return jsonify({"error": err.message, **err.extra}), err.status


@student_bp.get("/timetable")
@roles_required("student", "admin")
def my_timetable():
    user = current_user()
    if not user.batch:
        return jsonify([])
    entries = Timetable.query.filter(batch_filter(Timetable.batch, user.batch)).order_by(Timetable.start_time).all()
    return jsonify([e.to_dict() for e in entries])


@student_bp.get("/today")
@roles_required("student", "admin")
def my_today():
    user = current_user()
    return jsonify(get_student_today_rows(user, date.today()))


@student_bp.get("/profile")
@roles_required("student")
def my_profile():
    """My profile, which fields I can change myself, which need approval,
    my change requests and the history of changes."""
    from app.models import Batch, ProfileChange, ProfileChangeRequest
    from app.utils.constants import DEPARTMENTS
    from app.utils.profile import FIELD_LABELS, approval_fields, profile_payload, self_edit_fields

    user = current_user()
    settings = get_all_settings()
    reqs = ProfileChangeRequest.query.filter_by(student_id=user.id).order_by(ProfileChangeRequest.created_at.desc()).all()
    history = ProfileChange.query.filter_by(user_id=user.id).order_by(ProfileChange.changed_at.desc()).limit(50).all()
    return jsonify({
        "profile": profile_payload(user),
        "labels": FIELD_LABELS,
        "self_edit": self_edit_fields(settings),
        "approval": approval_fields(settings),
        "requests": [r.to_dict() for r in reqs],
        "history": [h.to_dict() for h in history],
        "departments": DEPARTMENTS,
        "batches": [b.code for b in Batch.query.order_by(Batch.code).all()],
    })


@student_bp.put("/profile")
@roles_required("student")
def update_my_profile():
    """Change the fields students may edit themselves (Settings)."""
    from app.utils.profile import clean_value, profile_payload, record_change, self_edit_fields

    user = current_user()
    data = request.get_json(silent=True) or {}
    allowed = self_edit_fields()
    blocked = [k for k in data if k not in allowed]
    if blocked:
        raise CheckinRefused(f"{blocked[0]} can't be changed here. Send a change request instead.", 403)
    for field in allowed:
        if field in data:
            new = clean_value(field, data[field], user)
            record_change(user, field, getattr(user, field), new, "self", user)
            setattr(user, field, new)
    db.session.commit()
    return jsonify(profile_payload(user))


@student_bp.post("/profile/requests")
@roles_required("student")
def request_profile_change():
    """Ask an administrator to change a field that needs approval."""
    from app.models import ProfileChangeRequest
    from app.utils.leave import users_with_permission
    from app.utils.notify import notify
    from app.utils.profile import FIELD_LABELS, approval_fields, clean_value
    from app.utils.validation import clean_text

    user = current_user()
    data = request.get_json(silent=True) or {}
    field = data.get("field")
    if field not in approval_fields():
        raise CheckinRefused("That field can't be changed by request.", 400)
    new = clean_value(field, data.get("new_value"), user)
    if (new or "") == (getattr(user, field) or ""):
        raise CheckinRefused("That is already the current value.", 400)
    reason = clean_text(data.get("reason"), "Reason", max_len=1000)
    if not reason or len(reason) < 5:
        raise CheckinRefused("Say why the change is needed (e.g. 'Name misspelt at registration').", 400)
    if ProfileChangeRequest.query.filter(ProfileChangeRequest.student_id == user.id, ProfileChangeRequest.field == field,
                                         ProfileChangeRequest.status.in_(("pending", "awaiting_confirmation"))).first():
        raise CheckinRefused(f"You already have an open request for {FIELD_LABELS[field].lower()}. Wait for it, or cancel it.", 409)
    req = ProfileChangeRequest(student_id=user.id, field=field, old_value=getattr(user, field), new_value=new, reason=reason)
    db.session.add(req)
    db.session.flush()
    notify(users_with_permission("students:edit"), type="notice", title=f"Profile change request: {user.name}",
           message=f"{FIELD_LABELS[field]}: '{req.old_value or '—'}' → '{new}'. Reason: {reason}",
           link="/admin/students?tab=requests", related_id=req.id)
    db.session.commit()
    return jsonify(req.to_dict()), 201


@student_bp.post("/profile/requests/<int:request_id>/cancel")
@roles_required("student")
def cancel_profile_request(request_id):
    from app.models import ProfileChangeRequest

    user = current_user()
    req = ProfileChangeRequest.query.filter_by(id=request_id, student_id=user.id).first_or_404()
    if req.status not in ("pending", "awaiting_confirmation"):
        raise CheckinRefused("This request is already decided.", 409)
    req.status = "cancelled"
    req.confirm_token = None
    db.session.commit()
    return jsonify(req.to_dict())


@student_bp.get("/class-notices")
@roles_required("student")
def my_class_notices():
    """Officially cancelled classes (and withdrawn cancellations) for my class."""
    from app.utils.leave import student_class_notices

    return jsonify(student_class_notices(current_user()))


@student_bp.get("/report")
@roles_required("student", "admin")
def my_report():
    user = current_user()
    return jsonify(build_student_report(user))


@student_bp.get("/report/export")
@roles_required("student")
def my_report_download():
    from app.utils import report_export as rx
    from app.utils.student_report import student_report_export

    return student_report_export(current_user(), rx.export_format())


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
    if not batch_matches(entry.batch, user.batch):
        raise CheckinRefused(
            WRONG_BATCH_MESSAGE.format(batch=entry.batch or "no batch", course=entry.course_name),
            403, reason="wrong_batch",
        )
    if not teaches_on(entry, day, get_no_class_dates(settings)):
        raise CheckinRefused("This class is not scheduled today.")
    if is_session_exempt(entry, day):
        raise CheckinRefused(
            "Your lecturer is recorded as unavailable for this session, so it is exempted. "
            "No check-in is needed and it does not count against your attendance.",
            409, reason="exempted",
        )

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
    if ticket.get("m") == "board":
        # "Close check-in" stops board check-ins immediately, including ones mid-way.
        board = BoardSession.query.get(ticket.get("b"))
        if not board or not board.is_open():
            raise CheckinRefused(BOARD_CLOSED_MESSAGE, 409, reason="board_closed")
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

    ticket = _new_ticket(user, entry, day)
    return _reply(ticket, steps=steps, session=_session_info(entry, start_dt, end_dt))


def _new_ticket(user, entry, day, **extra) -> dict:
    return {
        "uid": user.id, "t": entry.id, "d": day.isoformat(), "m": "qr",
        "code": False, "loc": False, "lat": None, "lng": None, "dist": None,
        "dir": secrets.choice(("left", "right")),
        **extra,
    }


def _session_info(entry, start_dt, end_dt) -> dict:
    return {
        "timetable_id": entry.id,
        "course_name": entry.course_name,
        "batch": entry.batch,
        "room": entry.room,
        "lecturer_name": entry.lecturer.name if entry.lecturer else None,
        "scheduled_start": start_dt.isoformat() if start_dt else None,
        "scheduled_end": end_dt.isoformat() if end_dt else None,
        "code_digits": current_app.config["STUDENT_CODE_DIGITS"],
        "board_code_digits": board_code.BOARD_CODE_DIGITS,
    }


# ---------- Board-code check-in (no QR, no screen) ----------
#
# current-class -> board (code) -> location -> complete (face). The board
# code replaces both the QR scan and the rotating code; the ticket records
# method 'board' and the board session, so closing it stops the flow.

@student_bp.get("/current-class")
@roles_required("student")
def current_class():
    """The class running now for the student's batch (from 30 minutes before
    it starts until it ends), and whether board check-in is open for it."""
    user = current_user()
    settings = get_all_settings()
    today = date.today()
    now = datetime.now()
    if not user.batch:
        return jsonify({"session": None})

    for entry in get_batch_classes(user.batch, today, get_no_class_dates(settings)):
        start_dt, end_dt = scheduled_datetimes(entry, today)
        end_dt = end_dt or start_dt + timedelta(hours=2)
        if not (start_dt - timedelta(minutes=CHECKIN_OPENS_MINUTES_BEFORE) <= now <= end_dt):
            continue
        record = StudentAttendance.query.filter_by(student_id=user.id, timetable_id=entry.id, date=today).first()
        return jsonify({
            "session": _session_info(entry, start_dt, end_dt),
            "board_open": board_code.open_session(entry.id, today, now) is not None,
            "status": record.status if record else "not_yet",
            "checked_in": bool(record and record.checkin_at),
        })
    return jsonify({"session": None})


@student_bp.post("/checkin/board")
@roles_required("student")
@limiter.limit("10/minute", key_func=lambda: f"user:{current_user().id}")
def checkin_board():
    user = current_user()
    settings = get_all_settings()
    data = request.get_json(silent=True) or {}
    timetable_id = data.get("timetable_id")
    if not isinstance(timetable_id, int) or isinstance(timetable_id, bool):
        raise CheckinRefused("Choose the class you are checking in to.")
    day = date.today()
    entry, start_dt, end_dt = _open_session(user, timetable_id, day, settings)

    steps = _steps(settings)
    if steps["face"] and user.face is None:
        raise CheckinRefused(FACE_NOT_ENROLLED_MESSAGE, 403, reason="face_not_enrolled")
    if board_code.failed_attempts(user.id, entry.id, day) >= board_code.BOARD_CODE_MAX_WRONG:
        raise CheckinRefused(BOARD_LOCKED_MESSAGE, 429, reason="board_locked")
    board = board_code.open_session(entry.id, day)
    if not board:
        raise CheckinRefused(BOARD_NOT_OPEN_MESSAGE, 409, reason="board_not_open")

    code = str(data.get("code") or "")[:16]
    matched = board_code.codes_match(board.code, code)
    db.session.add(BoardCodeAttempt(student_id=user.id, timetable_id=entry.id, date=day, success=matched))
    db.session.commit()
    if not matched:
        remaining = board_code.BOARD_CODE_MAX_WRONG - board_code.failed_attempts(user.id, entry.id, day)
        if remaining <= 0:
            raise CheckinRefused(BOARD_LOCKED_MESSAGE, 429, reason="board_locked")
        raise CheckinRefused(
            f"That isn't the code on the board. {remaining} attempt{'s' if remaining != 1 else ''} left.",
            403, reason="board_wrong_code", attempts_remaining=remaining,
        )

    # The board code proves both the class and presence in the room, so it
    # counts as the code step whatever student_verification_mode says.
    ticket = _new_ticket(user, entry, day, m="board", b=board.id, code=True)
    return _reply(ticket, steps={**steps, "code": True}, session=_session_info(entry, start_dt, end_dt))


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
    if (_steps(settings)["code"] or ticket.get("m") == "board") and not ticket["code"]:
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
    if ticket.get("m") == "board":
        steps["code"] = True
    if (steps["code"] and not ticket["code"]) or (steps["location"] and not ticket["loc"]):
        raise CheckinRefused("Please complete the earlier check-in steps first.")

    if steps["face"]:
        if user.face is None:
            raise CheckinRefused(FACE_NOT_ENROLLED_MESSAGE, 403, reason="face_not_enrolled")
        # 0 = unlimited retries; the face must still match every time.
        max_attempts = get_setting_int("face_max_attempts_per_session", settings)
        if max_attempts > 0 and _failed_face_attempts(user.id, entry.id, day) >= max_attempts:
            raise CheckinRefused(TOO_MANY_ATTEMPTS_MESSAGE, 429, reason="face_locked")

        frontal = face.read_frames(request.files, "frontal", 1)[0]
        turned = face.read_frames(request.files, "turned", 1, face.MAX_TURNED_FRAMES)
        try:
            score, check = face.verify(frontal, turned, ticket["dir"], face.unpack(user.face.embeddings))
        except face.FaceError as err:
            _log_attempt(user, entry, day, err.reason, None, stage=err.stage, check=err.check)
            raise

        matched = score >= get_setting_float("face_match_threshold", settings)
        _log_attempt(user, entry, day, "match" if matched else "mismatch", score,
                     stage="matched" if matched else "face_mismatch", check=check)
        if not matched:
            remaining = None
            if max_attempts > 0:
                remaining = max(max_attempts - _failed_face_attempts(user.id, entry.id, day), 0)
            raise CheckinRefused(FACE_MISMATCH_MESSAGE, 403, reason="face_mismatch", attempts_remaining=remaining)

    record = _record_checkin(user, entry, day, start_dt, end_dt, ticket, settings)
    return jsonify(record.to_dict())


def _log_attempt(user, entry, day, result: str, score, stage: str = "", check=None):
    attempt = FaceCheckAttempt(student_id=user.id, timetable_id=entry.id, date=day, result=result, score=score,
                               stage=stage or None)
    if check is not None:
        attempt.direction = check.direction
        attempt.frontal_yaw = check.frontal_yaw
        attempt.turn_amount = check.turn
        attempt.turn_similarity = check.similarity
        attempt.turn_frames = check.frames
    db.session.add(attempt)
    db.session.commit()
    g.activity_detail = f"Face scan: {result}" + (f" ({stage})" if stage else "")


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
    record.checkin_method = "board" if ticket.get("m") == "board" else "qr"

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise CheckinRefused("You've already checked in for this class.", 409, reason="already_checked_in")
    return record
