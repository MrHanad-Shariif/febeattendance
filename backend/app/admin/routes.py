import csv
import io
from datetime import datetime, date
from calendar import monthrange

from flask import request, jsonify, Response, current_app
from sqlalchemy.orm import joinedload

from app.admin import admin_bp
from app.extensions import db
from app.models import BoardSession, User, Timetable, Attendance, Setting, StudentAttendance
from app.utils.authz import current_user, permission_required
from app.utils.student_override import apply_override
from app.utils.invite import create_invited_user, resend_invite
from app.utils.settings import get_no_class_dates, ensure_defaults_seeded, get_all_settings
from app.utils.today import get_today_rows
from app.utils.schedule import teaches_on, get_day_classes, get_batch_classes, scheduled_datetimes
from app.utils.qr import generate_qr_png
from app.utils.student_report import build_student_report
from app.utils.student_status import compute_course_stats, should_mark_student_absent
from app.utils.constants import DEPARTMENTS
from app.utils.validation import (
    ValidationError, clean_days, clean_email, clean_int, clean_text, parse_hhmm,
    parse_iso_date, parse_month, validate_settings,
)


# ---------- Lecturers ----------

@admin_bp.get("/lecturers")
@permission_required("lecturers:view", "timetable:view", "dashboard:view")
def list_lecturers():
    lecturers = User.query.filter_by(role="lecturer").order_by(User.name).all()
    return jsonify([u.to_dict() for u in lecturers])


@admin_bp.post("/lecturers")
@permission_required("lecturers:add")
def create_lecturer():
    data = request.get_json(silent=True) or {}
    name = clean_text(data.get("name"), "Name", max_len=200, required=True)
    email = clean_email(data.get("email"))
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "A user with that email already exists"}), 409

    user = create_invited_user(name, email, role="lecturer")
    return jsonify(user.to_dict()), 201


@admin_bp.put("/lecturers/<int:user_id>")
@permission_required("lecturers:edit")
def update_lecturer(user_id):
    user = User.query.filter_by(id=user_id, role="lecturer").first_or_404()
    data = request.get_json(silent=True) or {}
    email_changed = False

    if data.get("name") is not None:
        user.name = clean_text(data["name"], "Name", max_len=200, required=True)
    if data.get("email") is not None:
        new_email = clean_email(data["email"])
        if new_email != user.email:
            if User.query.filter_by(email=new_email).first():
                return jsonify({"error": "A user with that email already exists"}), 409
            user.email = new_email
            email_changed = True
    if "status" in data:
        if data["status"] not in ("active", "disabled", "invited"):
            raise ValidationError("Status must be active, disabled or invited")
        user.status = data["status"]

    db.session.commit()
    # The original invite link went to the old address; send a fresh one to the new one.
    if email_changed and user.status == "invited":
        resend_invite(user)
    return jsonify(user.to_dict())


@admin_bp.delete("/lecturers/<int:user_id>")
@permission_required("lecturers:delete")
def delete_lecturer(user_id):
    user = User.query.filter_by(id=user_id, role="lecturer").first_or_404()
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Deleted"})


@admin_bp.post("/lecturers/<int:user_id>/resend-invite")
@permission_required("lecturers:edit")
def resend_lecturer_invite(user_id):
    user = User.query.filter_by(id=user_id, role="lecturer").first_or_404()
    resend_invite(user)
    return jsonify({"message": "Invite resent"})


# Admin & staff accounts are managed in app/access (user management).


# ---------- Timetable ----------

def _timetable_fields(data: dict, partial: bool = False) -> dict:
    """Validate and normalise timetable input. With partial=True only the keys
    present in `data` are returned (PUT); otherwise every field is (POST)."""
    fields = {}

    def wanted(key):
        return not partial or key in data

    if wanted("course_name"):
        fields["course_name"] = clean_text(data.get("course_name"), "Course name", max_len=255, required=True)
    if wanted("batch"):
        fields["batch"] = clean_text(data.get("batch"), "Batch", max_len=50)
    if wanted("room"):
        fields["room"] = clean_text(data.get("room"), "Room", max_len=100)
    if wanted("days"):
        fields["days"] = clean_days(data.get("days"))
    if wanted("start_time"):
        fields["start_time"] = parse_hhmm(data.get("start_time"), "Start time")
    if wanted("end_time"):
        fields["end_time"] = parse_hhmm(data.get("end_time"), "End time")
    if wanted("sessions"):
        fields["sessions"] = clean_int(data.get("sessions"), "Sessions", minimum=1, maximum=12, default=1)
    if wanted("semester_total_sessions"):
        fields["semester_total_sessions"] = clean_int(data.get("semester_total_sessions"), "Total sessions", minimum=0, maximum=500)
    if wanted("note"):
        fields["note"] = clean_text(data.get("note"), "Note", max_len=500)

    start, end = fields.get("start_time"), fields.get("end_time")
    if start and end and end <= start:
        raise ValidationError("End time must be after the start time")
    return fields


@admin_bp.get("/timetable")
@permission_required("timetable:view")
def list_timetable():
    lecturer_id = request.args.get("lecturer_id", type=int)
    query = Timetable.query
    if lecturer_id:
        query = query.filter_by(lecturer_id=lecturer_id)
    entries = query.order_by(Timetable.start_time).all()
    return jsonify([t.to_dict() for t in entries])


@admin_bp.post("/timetable")
@permission_required("timetable:add")
def create_timetable_entry():
    data = request.get_json(silent=True) or {}
    lecturer_id = clean_int(data.get("lecturer_id"), "Lecturer", minimum=1)
    lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first() if lecturer_id else None
    if not lecturer:
        return jsonify({"error": "Unknown lecturer"}), 400

    entry = Timetable(lecturer_id=lecturer.id, **_timetable_fields(data))
    db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict()), 201


@admin_bp.put("/timetable/<int:entry_id>")
@permission_required("timetable:edit")
def update_timetable_entry(entry_id):
    entry = Timetable.query.get_or_404(entry_id)
    data = request.get_json(silent=True) or {}

    if "lecturer_id" in data:
        lecturer_id = clean_int(data.get("lecturer_id"), "Lecturer", minimum=1)
        lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first() if lecturer_id else None
        if not lecturer:
            return jsonify({"error": "Unknown lecturer"}), 400
        entry.lecturer_id = lecturer.id
    for key, value in _timetable_fields(data, partial=True).items():
        setattr(entry, key, value)

    db.session.commit()
    return jsonify(entry.to_dict())


@admin_bp.delete("/timetable/<int:entry_id>")
@permission_required("timetable:delete")
def delete_timetable_entry(entry_id):
    entry = Timetable.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"message": "Deleted"})


# ---------- Settings ----------

@admin_bp.get("/settings")
@permission_required("settings:view")
def get_settings():
    ensure_defaults_seeded()
    rows = Setting.query.order_by(Setting.key).all()
    return jsonify([r.to_dict() for r in rows])


@admin_bp.put("/settings")
@permission_required("settings:edit")
def update_settings():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Expected an object of key: value"}), 400

    cleaned = validate_settings(data, get_all_settings())
    for key, value in cleaned.items():
        row = Setting.query.get(key)
        if not row:
            row = Setting(key=key, description=Setting.DEFAULTS[key][1])
            db.session.add(row)
        row.value = value

    db.session.commit()
    return jsonify([r.to_dict() for r in Setting.query.order_by(Setting.key).all()])


# ---------- Today / attendance / summary ----------

@admin_bp.get("/attendance/today")
@permission_required("lecturer_attendance:view", "dashboard:view")
def attendance_today():
    return jsonify(get_today_rows(date.today()))


@admin_bp.get("/attendance")
@permission_required("lecturer_attendance:view", "reports:view", "dashboard:view")
def list_attendance():
    query = Attendance.query
    lecturer_id = request.args.get("lecturer_id", type=int)
    status = request.args.get("status")
    date_from = request.args.get("from")
    date_to = request.args.get("to")

    if lecturer_id:
        query = query.filter_by(lecturer_id=lecturer_id)
    if status:
        if status not in Attendance.STATUS_LABELS:
            raise ValidationError("Unknown status filter")
        query = query.filter_by(status=status)
    if date_from:
        query = query.filter(Attendance.date >= parse_iso_date(date_from, "from"))
    if date_to:
        query = query.filter(Attendance.date <= parse_iso_date(date_to, "to"))

    records = query.order_by(Attendance.date.desc(), Attendance.scheduled_start.desc()).limit(1000).all()
    return jsonify([r.to_dict() for r in records])


@admin_bp.put("/attendance/<int:record_id>/remarks")
@permission_required("lecturer_attendance:edit")
def update_attendance_remarks(record_id):
    """Admin-entered justification for an early check-out or an absence.
    Blank means no permission/explanation was recorded; any text means it
    was justified (e.g. approved leave, a documented emergency)."""
    record = Attendance.query.get_or_404(record_id)
    data = request.get_json(silent=True) or {}
    record.remarks = (data.get("remarks") or "").strip() or None
    db.session.commit()
    return jsonify(record.to_dict())


def _month_bounds(month_str: str):
    year, month = parse_month(month_str)
    last_day = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


@admin_bp.get("/summary")
@permission_required("reports:view")
def attendance_summary():
    month_str = request.args.get("month") or date.today().strftime("%Y-%m")
    start_date, end_date = _month_bounds(month_str)

    lecturers = User.query.filter_by(role="lecturer").order_by(User.name).all()
    no_class_dates = get_no_class_dates()

    result = []
    for lecturer in lecturers:
        counts = {
            "on_time": 0, "late": 0, "no_checkout": 0,
            "absent_justified": 0, "absent_unjustified": 0,
            "left_early_justified": 0, "left_early_unjustified": 0,
        }
        records = Attendance.query.filter(
            Attendance.lecturer_id == lecturer.id,
            Attendance.date >= start_date,
            Attendance.date <= end_date,
        ).all()

        sessions_covered = 0
        for r in records:
            justified = bool(r.remarks and r.remarks.strip())
            if r.status == "absent":
                counts["absent_justified" if justified else "absent_unjustified"] += 1
            elif r.status == "left_early":
                counts["left_early_justified" if justified else "left_early_unjustified"] += 1
            elif r.status in counts:
                counts[r.status] += 1

            if r.status != "absent":
                sessions_covered += len(get_day_classes(lecturer.id, r.date, no_class_dates))

        sessions_scheduled = 0
        entries = Timetable.query.filter_by(lecturer_id=lecturer.id).all()
        d = start_date
        while d <= end_date:
            for entry in entries:
                if teaches_on(entry, d, no_class_dates) and entry.start_time:
                    sessions_scheduled += 1
            d = date.fromordinal(d.toordinal() + 1)

        result.append({
            "lecturer_id": lecturer.id,
            "lecturer_name": lecturer.name,
            "on_time": counts["on_time"],
            "late": counts["late"],
            "absent_justified": counts["absent_justified"],
            "absent_unjustified": counts["absent_unjustified"],
            "left_early_justified": counts["left_early_justified"],
            "left_early_unjustified": counts["left_early_unjustified"],
            "no_checkout": counts["no_checkout"],
            "sessions_scheduled": sessions_scheduled,
            "sessions_covered": sessions_covered,
        })

    return jsonify({"month": month_str, "rows": result})


@admin_bp.get("/attendance/export")
@permission_required("reports:view")
def export_attendance():
    month_str = request.args.get("month") or date.today().strftime("%Y-%m")
    start_date, end_date = _month_bounds(month_str)

    records = Attendance.query.filter(
        Attendance.date >= start_date, Attendance.date <= end_date
    ).order_by(Attendance.date, Attendance.scheduled_start).all()

    no_class_dates = get_no_class_dates()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Date", "Lecturer", "Classes", "Scheduled start", "Checked in", "Scheduled end",
        "Checked out", "Status", "Justified?", "Remarks", "Check-in distance (m)", "Check-out distance (m)",
    ])
    for r in records:
        classes = get_day_classes(r.lecturer_id, r.date, no_class_dates)
        classes_summary = "; ".join(f"{e.course_name} ({e.batch})" if e.batch else e.course_name for e in classes)
        writer.writerow([
            r.date.isoformat(),
            r.lecturer.name if r.lecturer else "",
            classes_summary,
            r.scheduled_start.strftime("%H:%M") if r.scheduled_start else "",
            r.checkin_at.strftime("%Y-%m-%d %H:%M") if r.checkin_at else "",
            r.scheduled_end.strftime("%H:%M") if r.scheduled_end else "",
            r.checkout_at.strftime("%Y-%m-%d %H:%M") if r.checkout_at else "",
            Attendance.STATUS_LABELS.get(r.status, r.status),
            "Yes" if (r.remarks and r.remarks.strip()) else "No",
            r.remarks or "",
            r.checkin_distance_m,
            r.checkout_distance_m,
        ])

    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=attendance-{month_str}.csv"},
    )


# ---------- QR code ----------

@admin_bp.get("/qrcode.png")
@permission_required("lecturer_attendance:view")
def checkin_qr_code():
    png = generate_qr_png(current_app.config["CHECKIN_URL"], "lecturer")
    return Response(png, mimetype="image/png")


@admin_bp.get("/kiosk-url")
@permission_required("lecturer_attendance:view")
def kiosk_url():
    base = current_app.config["FRONTEND_BASE_URL"].rstrip("/")
    key = current_app.config["KIOSK_ACCESS_KEY"]
    return jsonify({"url": f"{base}/kiosk?key={key}"})


# ---------- Students ----------

@admin_bp.get("/students")
@permission_required("students:view", "dashboard:view")
def list_students():
    query = User.query.filter_by(role="student")
    batch = request.args.get("batch")
    department = request.args.get("department")
    if batch:
        query = query.filter_by(batch=batch)
    if department:
        query = query.filter_by(department=department)
    students = query.options(joinedload(User.face)).order_by(User.name).all()
    return jsonify([s.to_dict() for s in students])


@admin_bp.put("/students/<int:user_id>")
@permission_required("students:edit")
def update_student(user_id):
    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    data = request.get_json(silent=True) or {}

    if data.get("name") is not None:
        student.name = clean_text(data["name"], "Name", max_len=200, required=True)
    if data.get("email") is not None:
        new_email = clean_email(data["email"])
        if new_email != student.email and User.query.filter_by(email=new_email).first():
            return jsonify({"error": "A user with that email already exists"}), 409
        student.email = new_email
    if "department" in data:
        new_department = clean_text(data.get("department"), "Department", max_len=150)
        if new_department and new_department not in DEPARTMENTS:
            raise ValidationError("Please select a valid department")
        student.department = new_department
    if "batch" in data:
        student.batch = clean_text(data.get("batch"), "Batch", max_len=50)
    if "status" in data:
        if data["status"] not in ("active", "disabled"):
            raise ValidationError("Status must be active or disabled")
        student.status = data["status"]

    db.session.commit()
    return jsonify(student.to_dict())


@admin_bp.delete("/students/<int:user_id>")
@permission_required("students:delete")
def delete_student(user_id):
    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    db.session.delete(student)
    db.session.commit()
    return jsonify({"message": "Deleted"})


@admin_bp.delete("/students/<int:user_id>/face")
@permission_required("students:edit")
def reset_student_face(user_id):
    """Remove a student's registered face (e.g. wrong person enrolled, or a
    big change in appearance). They're asked to register again at next login."""
    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    if student.face is None:
        return jsonify({"error": "This student has not registered a face"}), 404
    db.session.delete(student.face)
    db.session.commit()
    return jsonify(student.to_dict())


@admin_bp.get("/students/<int:user_id>/report")
@permission_required("students:view", "reports:view")
def student_report(user_id):
    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    return jsonify(build_student_report(student))


@admin_bp.get("/courses")
@permission_required("reports:view", "students:view")
def list_courses():
    """Distinct (batch, course_name) pairs, for the course-report picker."""
    rows = Timetable.query.with_entities(Timetable.batch, Timetable.course_name).filter(Timetable.batch.isnot(None)).distinct().all()
    pairs = sorted({(r[0], r[1]) for r in rows}, key=lambda p: (p[0], p[1]))
    return jsonify([{"batch": b, "course_name": c} for b, c in pairs])


@admin_bp.get("/departments")
@permission_required("reports:view", "students:view")
def list_departments():
    """The faculty's fixed department list (same one used on the student
    signup form), so filters/reports always show all departments even before
    any student has registered in one."""
    return jsonify(DEPARTMENTS)


# ---------- Student attendance: today / overrides / reports ----------

@admin_bp.get("/attendance/students/today")
@permission_required("student_attendance:view")
def student_attendance_today():
    """One row per (batch, session) happening today, with roster counts.
    Drill into a session with /attendance/students/session/<timetable_id>."""
    today = date.today()
    no_class_dates = get_no_class_dates()

    batches = sorted({b[0] for b in User.query.filter_by(role="student").with_entities(User.batch).distinct().all() if b[0]})

    rows = []
    for batch in batches:
        entries = get_batch_classes(batch, today, no_class_dates)
        total_students = User.query.filter_by(role="student", batch=batch, status="active").count()
        for entry in entries:
            records = StudentAttendance.query.filter_by(timetable_id=entry.id, date=today).all()
            counts = {"on_time": 0, "late": 0, "absent": 0, "present": 0}
            for r in records:
                if r.status in counts:
                    counts[r.status] += 1
            checked_in = counts["on_time"] + counts["late"]
            rows.append({
                "timetable_id": entry.id,
                "batch": batch,
                "course_name": entry.course_name,
                "lecturer_name": entry.lecturer.name if entry.lecturer else None,
                "room": entry.room,
                "start_time": entry.start_time.strftime("%H:%M") if entry.start_time else None,
                "end_time": entry.end_time.strftime("%H:%M") if entry.end_time else None,
                "total_students": total_students,
                "checked_in": checked_in,
                "on_time": counts["on_time"],
                "late": counts["late"],
                "absent": counts["absent"],
                "present_excused": counts["present"],
                "not_yet": max(total_students - len(records), 0),
            })

    rows.sort(key=lambda r: (r["start_time"] or "", r["batch"]))
    return jsonify(rows)


@admin_bp.get("/attendance/students/session/<int:timetable_id>")
@permission_required("student_attendance:view")
def student_attendance_session(timetable_id):
    """Full roster for one session on one date: every student in that batch,
    with their record for this specific session (or 'not_yet'/'absent' if
    none exists yet)."""
    entry = Timetable.query.get_or_404(timetable_id)
    date_str = request.args.get("date")
    the_date = date.fromisoformat(date_str) if date_str else date.today()

    settings = get_all_settings()
    students = User.query.filter_by(role="student", batch=entry.batch, status="active").order_by(User.name).all()
    existing = {
        r.student_id: r
        for r in StudentAttendance.query.filter_by(timetable_id=timetable_id, date=the_date).all()
    }

    start_dt, _ = scheduled_datetimes(entry, the_date)
    now = datetime.now()

    rows = []
    for student in students:
        record = existing.get(student.id)
        if record:
            row = record.to_dict()
        else:
            status = "absent" if should_mark_student_absent(start_dt, now, settings) else "not_yet"
            row = {
                "id": None, "student_id": student.id, "student_name": student.name,
                "timetable_id": timetable_id, "date": the_date.isoformat(),
                "checkin_at": None, "status": status,
                "status_label": StudentAttendance.STATUS_LABELS.get(status, status), "remarks": None,
            }
        rows.append(row)

    return jsonify({
        "timetable": entry.to_dict(),
        "date": the_date.isoformat(),
        "students": rows,
    })


@admin_bp.put("/student-attendance/<int:record_id>")
@permission_required("student_attendance:edit")
def update_student_attendance(record_id):
    """Admin override for one student's one session -- primarily used to turn
    an unjustified Absent into Present once the student provides acceptable
    evidence, or correct a Late, but a remark is always required."""
    record = StudentAttendance.query.get_or_404(record_id)
    data = request.get_json(silent=True) or {}

    error = apply_override(record, data.get("status"), data.get("remarks"), current_user())
    if error:
        return jsonify({"error": error}), 400

    return jsonify(record.to_dict())


@admin_bp.get("/reports/class/<batch>")
@permission_required("reports:view")
def class_report(batch):
    students = User.query.filter_by(role="student", batch=batch).order_by(User.name).all()
    rows = []
    for student in students:
        report = build_student_report(student)
        totals = report["totals"]
        percentage = round((totals["effective_absences"] / totals["total_sessions"]) * 100, 1) if totals["total_sessions"] else 0.0
        rows.append({
            "student_id": student.id,
            "student_id_number": student.student_id_number,
            "student_name": student.name,
            **totals,
            "absence_percentage": percentage,
            "courses_needing_retake": sum(1 for c in report["summary"] if c["needs_retake"]),
        })
    return jsonify({"batch": batch, "rows": rows})


@admin_bp.get("/reports/course")
@permission_required("reports:view")
def course_report():
    batch = request.args.get("batch")
    course_name = request.args.get("course_name")
    if not batch or not course_name:
        return jsonify({"error": "batch and course_name are required"}), 400

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


@admin_bp.get("/reports/department/<department>")
@permission_required("reports:view")
def department_report(department):
    students = User.query.filter_by(role="student", department=department).order_by(User.batch, User.name).all()
    rows = []
    for student in students:
        report = build_student_report(student)
        totals = report["totals"]
        percentage = round((totals["effective_absences"] / totals["total_sessions"]) * 100, 1) if totals["total_sessions"] else 0.0
        rows.append({
            "student_id": student.id,
            "student_id_number": student.student_id_number,
            "student_name": student.name,
            "batch": student.batch,
            **totals,
            "absence_percentage": percentage,
            "courses_needing_retake": sum(1 for c in report["summary"] if c["needs_retake"]),
        })
    return jsonify({"department": department, "rows": rows})


@admin_bp.get("/reports/checkin-methods")
@permission_required("reports:view")
def checkin_methods_report():
    """Per class session: how many students checked in by QR (lecturer's
    screen) and by board code, against the batch size and whether a board
    session was opened (and by whom). A board session with more check-ins
    than people usually in the room is the thing to look for."""
    today = date.today()
    date_from = parse_iso_date(request.args.get("from"), "from") if request.args.get("from") else today.replace(day=1)
    date_to = parse_iso_date(request.args.get("to"), "to") if request.args.get("to") else today
    if date_to < date_from:
        raise ValidationError("'to' must be on or after 'from'")

    counts = (
        db.session.query(
            StudentAttendance.timetable_id, StudentAttendance.date,
            StudentAttendance.checkin_method, db.func.count(StudentAttendance.id),
        )
        .filter(
            StudentAttendance.date >= date_from, StudentAttendance.date <= date_to,
            StudentAttendance.checkin_at.isnot(None),
        )
        .group_by(StudentAttendance.timetable_id, StudentAttendance.date, StudentAttendance.checkin_method)
        .all()
    )
    sessions: dict[tuple, dict] = {}
    for timetable_id, day, method, n in counts:
        row = sessions.setdefault((timetable_id, day), {"qr": 0, "board": 0})
        row["board" if method == "board" else "qr"] += n

    boards: dict[tuple, list] = {}
    for b in BoardSession.query.filter(BoardSession.date >= date_from, BoardSession.date <= date_to).all():
        boards.setdefault((b.timetable_id, b.date), []).append(b)
        sessions.setdefault((b.timetable_id, b.date), {"qr": 0, "board": 0})

    entries = {t.id: t for t in Timetable.query.filter(Timetable.id.in_({k[0] for k in sessions})).all()} if sessions else {}
    batch_sizes = dict(
        db.session.query(User.batch, db.func.count(User.id))
        .filter(User.role == "student", User.status == "active").group_by(User.batch).all()
    )

    rows = []
    for (timetable_id, day), c in sessions.items():
        entry = entries.get(timetable_id)
        if not entry:
            continue
        board_rows = sorted(boards.get((timetable_id, day), []), key=lambda b: b.opened_at)
        enrolled = batch_sizes.get(entry.batch, 0)
        rows.append({
            "timetable_id": timetable_id,
            "date": day.isoformat(),
            "batch": entry.batch,
            "course_name": entry.course_name,
            "lecturer_name": entry.lecturer.name if entry.lecturer else None,
            "enrolled": enrolled,
            "qr": c["qr"],
            "board": c["board"],
            "checked_in": c["qr"] + c["board"],
            "board_opened": bool(board_rows),
            "board_started_by": ", ".join(sorted({b.started_by.name for b in board_rows if b.started_by})) or None,
            "board_code_changes": sum(b.code_changes for b in board_rows),
            "board_share": round(c["board"] * 100 / (c["qr"] + c["board"]), 1) if (c["qr"] + c["board"]) else 0.0,
        })
    rows.sort(key=lambda r: (r["date"], r["batch"] or "", r["course_name"]), reverse=True)
    return jsonify({"from": date_from.isoformat(), "to": date_to.isoformat(), "rows": rows})
