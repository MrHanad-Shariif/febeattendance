from datetime import date

from flask import jsonify, request, current_app

from app.lecturer import lecturer_bp
from app.models import Attendance, Timetable, User, StudentAttendance
from app.utils.authz import roles_required, current_user
from app.utils.schedule import get_day_classes
from app.utils.settings import get_no_class_dates, get_all_settings
from app.utils.today import get_today_rows
from app.utils.student_code import current_code, seconds_remaining
from app.utils.student_status import compute_course_stats, course_records_query
from app.utils.student_override import apply_override


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


@lecturer_bp.get("/class-code")
@roles_required("lecturer", "admin")
def class_code():
    """The rotating code a lecturer displays on their own laptop for
    students to read and type in during check-in. Gated by the lecturer's
    own login rather than a URL key, since only real lecturer accounts
    should ever be able to show it."""
    return jsonify({
        "code": current_code(),
        "seconds_remaining": seconds_remaining(),
        "interval": current_app.config["STUDENT_CODE_INTERVAL_SECONDS"],
    })


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
