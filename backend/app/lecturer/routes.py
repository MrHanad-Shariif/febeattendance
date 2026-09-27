from datetime import date, datetime, timedelta

from flask import Response, jsonify, request, current_app

from app.extensions import db
from app.lecturer import lecturer_bp
from app.models import Attendance, BoardSession, Timetable, User, StudentAttendance
from app.utils.authz import roles_required, current_user
from app.utils import board_code
from app.utils.rbac import has_permission
from app.utils.checkin_session import make_session_token
from app.utils.qr import generate_qr_png
from app.utils.schedule import get_day_classes, scheduled_datetimes, teaches_on
from app.utils.settings import get_no_class_dates, get_all_settings
from app.utils.today import get_today_rows
from app.utils.student_code import current_code, seconds_remaining
from app.utils.student_status import compute_course_stats, course_records_query
from app.utils.student_override import apply_override
from app.utils.validation import ValidationError


@lecturer_bp.get("/today")
@roles_required("lecturer", "admin")
def my_today():
    user = current_user()
    return jsonify(get_today_rows(date.today(), lecturer_id=user.id))


@lecturer_bp.get("/history")
@roles_required("lecturer", "admin")
def my_history():
    user = current_user()
    date_from = request.args.get("from")
    date_to = request.args.get("to")

    query = Attendance.query.filter_by(lecturer_id=user.id)
    if date_from:
        query = query.filter(Attendance.date >= date.fromisoformat(date_from))
    if date_to:
        query = query.filter(Attendance.date <= date.fromisoformat(date_to))

    records = query.order_by(Attendance.date.desc(), Attendance.scheduled_start.desc()).limit(200).all()

    no_class_dates = get_no_class_dates()
    rows = []
    for r in records:
        row = r.to_dict()
        classes = get_day_classes(user.id, r.date, no_class_dates)
        row["classes_summary"] = ", ".join(c.course_name for c in classes)
        rows.append(row)
    return jsonify(rows)


def _session_entry(user, permission: str = "class_checkin:view", timetable_id: int | None = None) -> Timetable:
    """The timetable entry named by ?timetable_id= (or the JSON body), if this
    user may run its check-in: the lecturer who teaches it always may; anyone
    else needs `permission` (class_checkin:view/add/edit). Only on a day it meets."""
    if timetable_id is None:
        timetable_id = request.args.get("timetable_id", type=int)
    entry = Timetable.query.get(timetable_id) if timetable_id else None
    if not entry or (entry.lecturer_id != user.id and not has_permission(user, permission)):
        raise ValidationError("Class session not found", status=404)
    if not teaches_on(entry, date.today(), get_no_class_dates()):
        raise ValidationError("This class is not scheduled today")
    return entry


@lecturer_bp.get("/classes-today")
@roles_required("lecturer", "admin")
def my_classes_today():
    """The lecturer's class sessions today, for the class-code screen's
    picker. The one running now (or the next one) is flagged as default.
    Admins get every class meeting today, so they can show any session's QR
    code (e.g. when a lecturer's laptop isn't working)."""
    user = current_user()
    today = date.today()
    now = datetime.now()
    no_class_dates = get_no_class_dates()
    if has_permission(user, "class_checkin:view"):
        entries = sorted(
            (e for e in Timetable.query.filter(Timetable.start_time.isnot(None)).all() if teaches_on(e, today, no_class_dates)),
            key=lambda e: e.start_time,
        )
    else:
        entries = get_day_classes(user.id, today, no_class_dates)
    rows = []
    for entry in entries:
        start_dt, end_dt = scheduled_datetimes(entry, today)
        rows.append({
            **entry.to_dict(),
            "scheduled_start": start_dt.isoformat() if start_dt else None,
            "scheduled_end": end_dt.isoformat() if end_dt else None,
            "ended": bool(end_dt and now > end_dt),
            "mine": entry.lecturer_id == user.id,
        })
    upcoming = [r for r in rows if not r["ended"]]
    default_id = upcoming[0]["id"] if upcoming else (rows[-1]["id"] if rows else None)
    return jsonify({"classes": rows, "default_timetable_id": default_id})


@lecturer_bp.get("/class-code")
@roles_required("lecturer", "admin")
def class_code():
    """The rotating code a lecturer displays on their own laptop for
    students to read and type in during check-in. Each class session has its
    own code, so it only works for that batch's session. Gated by the
    lecturer's own login rather than a URL key, since only real lecturer
    accounts should ever be able to show it."""
    entry = _session_entry(current_user())
    return jsonify({
        "code": current_code(entry.id, date.today()),
        "seconds_remaining": seconds_remaining(),
        "interval": current_app.config["STUDENT_CODE_INTERVAL_SECONDS"],
    })


@lecturer_bp.get("/class-qr.png")
@roles_required("lecturer", "admin")
def class_qr():
    """QR code for one class session, shown on the lecturer's screen. It
    carries a signed session token, so students of another batch who scan a
    shared photo of it are turned away."""
    entry = _session_entry(current_user())
    url = f"{current_app.config['STUDENT_CHECKIN_URL']}?s={make_session_token(entry.id, date.today())}"
    png = generate_qr_png(url, "student", subtitle=f"{entry.batch or ''}  {entry.course_name}".strip())
    return Response(png, mimetype="image/png", headers={"Cache-Control": "no-store"})


# ---------- Board code: check-in without a screen ----------
#
# The lecturer taps Start, writes the short code on the board, and students
# type it instead of scanning the QR code. Lecturers can always do this for
# their own classes; staff need class_checkin:add (start) or :edit (new code,
# close) to do it on a lecturer's behalf.

def _board_state(entry, day, include_code: bool) -> dict:
    session = board_code.open_session(entry.id, day) or board_code.latest_session(entry.id, day)
    return {
        "session": session.to_dict(include_code=include_code and session.is_open()) if session else None,
        "counts": board_code.live_counts(entry, day),
        "code_digits": board_code.BOARD_CODE_DIGITS,
    }


def _body_timetable_id():
    return (request.get_json(silent=True) or {}).get("timetable_id")


@lecturer_bp.get("/board-session")
@roles_required("lecturer", "admin")
def board_session_state():
    """Current board session for a class (code, time left) plus the live
    check-in count. Polled every few seconds by the lecturer's phone."""
    user = current_user()
    entry = _session_entry(user)
    return jsonify(_board_state(entry, date.today(), include_code=True))


@lecturer_bp.post("/board-session")
@roles_required("lecturer", "admin")
def start_board_session():
    user = current_user()
    tid = _body_timetable_id()
    entry = _session_entry(user, "class_checkin:add", tid if isinstance(tid, int) else -1)
    today = date.today()
    now = datetime.now()

    if board_code.open_session(entry.id, today, now):
        return jsonify(_board_state(entry, today, include_code=True))

    start_dt, end_dt = scheduled_datetimes(entry, today)
    if not start_dt:
        raise ValidationError("This class has no start time in the timetable.")
    if now < start_dt - timedelta(minutes=board_code.BOARD_OPENS_MINUTES_BEFORE):
        raise ValidationError(
            f"Board check-in can be started from {board_code.BOARD_OPENS_MINUTES_BEFORE} minutes before the class begins."
        )
    closes_at = board_code.auto_close_time(entry, today, get_all_settings())
    if now >= closes_at:
        raise ValidationError(
            f"Check-in for this class closed at {closes_at.strftime('%H:%M')}. "
            "Record late arrivals from the student list with a remark."
        )

    session = BoardSession(
        timetable_id=entry.id, date=today, code=board_code.new_code(),
        opened_at=now, closes_at=closes_at, started_by_id=user.id,
    )
    db.session.add(session)
    db.session.commit()
    return jsonify(_board_state(entry, today, include_code=True)), 201


def _open_board_or_404(user):
    tid = _body_timetable_id()
    entry = _session_entry(user, "class_checkin:edit", tid if isinstance(tid, int) else -1)
    session = board_code.open_session(entry.id, date.today())
    if not session:
        raise ValidationError("Board check-in isn't open for this class.", status=409)
    return entry, session


@lecturer_bp.post("/board-session/new-code")
@roles_required("lecturer", "admin")
def board_session_new_code():
    """Replace a code that may have leaked. The old one stops working at once;
    students already past the code step carry on."""
    user = current_user()
    entry, session = _open_board_or_404(user)
    session.code = board_code.new_code(session.code)
    session.code_changes += 1
    db.session.commit()
    return jsonify(_board_state(entry, date.today(), include_code=True))


@lecturer_bp.post("/board-session/close")
@roles_required("lecturer", "admin")
def board_session_close():
    user = current_user()
    entry, session = _open_board_or_404(user)
    session.closed_at = datetime.now()
    session.closed_by_id = user.id
    db.session.commit()
    return jsonify(_board_state(entry, date.today(), include_code=False))


# ---------- Student attendance for the lecturer's own courses ----------

def _owns_course(lecturer_id: int, batch: str, course_name: str) -> bool:
    return Timetable.query.filter_by(lecturer_id=lecturer_id, batch=batch, course_name=course_name).first() is not None


@lecturer_bp.get("/student-courses")
@roles_required("lecturer")
def my_student_courses():
    """Distinct (batch, course_name) pairs this lecturer teaches, for the
    course picker on their 'My students' page."""
    user = current_user()
    rows = (
        Timetable.query.filter_by(lecturer_id=user.id)
        .with_entities(Timetable.batch, Timetable.course_name)
        .filter(Timetable.batch.isnot(None))
        .distinct()
        .all()
    )
    pairs = sorted({(r[0], r[1]) for r in rows}, key=lambda p: (p[0], p[1]))
    return jsonify([{"batch": b, "course_name": c} for b, c in pairs])


@lecturer_bp.get("/student-course-report")
@roles_required("lecturer")
def my_student_course_report():
    user = current_user()
    batch = request.args.get("batch")
    course_name = request.args.get("course_name")
    if not batch or not course_name:
        return jsonify({"error": "batch and course_name are required"}), 400
    if not _owns_course(user.id, batch, course_name):
        return jsonify({"error": "You do not teach this course"}), 403

    settings = get_all_settings()
    students = User.query.filter_by(role="student", batch=batch).order_by(User.name).all()
    rows = []
    for student in students:
        stats = compute_course_stats(student.id, batch, course_name, settings)
        rows.append({
            "student_id": student.id,
            "student_id_number": student.student_id_number,
            "student_name": student.name,
            **stats,
        })
    return jsonify({"batch": batch, "course_name": course_name, "rows": rows})


@lecturer_bp.get("/student-sessions")
@roles_required("lecturer")
def my_student_sessions():
    """One student's full session history for one of this lecturer's
    courses, so the lecturer can find the specific date to correct."""
    user = current_user()
    batch = request.args.get("batch")
    course_name = request.args.get("course_name")
    student_id = request.args.get("student_id", type=int)
    if not batch or not course_name or not student_id:
        return jsonify({"error": "batch, course_name, and student_id are required"}), 400
    if not _owns_course(user.id, batch, course_name):
        return jsonify({"error": "You do not teach this course"}), 403

    records = (
        course_records_query(student_id, batch, course_name)
        .order_by(StudentAttendance.date.desc())
        .all()
    )
    return jsonify([r.to_dict() for r in records])


@lecturer_bp.put("/student-attendance/<int:record_id>")
@roles_required("lecturer")
def update_my_student_attendance(record_id):
    """Lecturer override for one of their own students' sessions -- same
    rules as the admin version: a remark is mandatory, and who made the
    change is recorded. Restricted to sessions in courses this lecturer
    actually teaches."""
    user = current_user()
    record = StudentAttendance.query.get_or_404(record_id)
    entry = record.timetable_entry
    if not entry or entry.lecturer_id != user.id:
        return jsonify({"error": "You do not teach this course"}), 403

    data = request.get_json(silent=True) or {}
    error = apply_override(record, data.get("status"), data.get("remarks"), user)
    if error:
        return jsonify({"error": error}), 400

    return jsonify(record.to_dict())
