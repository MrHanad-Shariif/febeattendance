import csv
import io
from datetime import datetime, date, timedelta
from calendar import monthrange

from flask import request, jsonify, Response, current_app
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.admin import admin_bp
from app.extensions import db
from app.models import (
    Batch, BoardCodeAttempt, BoardSession, Course, EmailOutbox, FaceCheckAttempt, Room, User, Timetable, Attendance, Setting, StudentAttendance,
    StudentClassChange,
)
from app.utils.absences import AbsenceIndex, split_day_classes
from app.utils.authz import current_user, permission_required
from app.utils.batches import batch_filter, members
from app.utils.rbac import has_permission
from app.utils.email import email_allowed, within_send_hours
from app.utils.student_override import apply_override
from app.utils.invite import create_invited_user, resend_invite
from app.utils.settings import get_no_class_dates, ensure_defaults_seeded, get_all_settings
from app.utils.today import get_today_rows
from app.utils.schedule import day_abbr, teaches_on, get_day_classes, get_batch_classes, scheduled_datetimes
from app.utils.timetable_upload import apply_plan, build_plan, plan_summary, week_start_for
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
    """Only a lecturer with no attendance history can be deleted; anyone else
    is disabled instead, so reports and students' records stay intact."""
    from app.models import PasswordResetToken

    user = User.query.filter_by(id=user_id, role="lecturer").first_or_404()
    entry_ids = [t.id for t in user.timetable_entries]
    has_history = (Attendance.query.filter_by(lecturer_id=user.id).first() is not None
                   or (entry_ids and StudentAttendance.query.filter(StudentAttendance.timetable_id.in_(entry_ids)).first()))
    if has_history:
        raise ValidationError("This lecturer has attendance history, so deleting them would remove it from the reports. "
                              "Disable the account instead (Edit > Status: disabled).", status=409)
    for model in (BoardCodeAttempt, FaceCheckAttempt, BoardSession):
        model.query.filter(model.timetable_id.in_(entry_ids or [-1])).delete(synchronize_session=False)
    PasswordResetToken.query.filter_by(user_id=user.id).delete()
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
    if data.get("duration_hours") not in (None, ""):
        # A standard length (1.5, 2, 2.5 or 3 hours) sets the end time.
        from app.utils.timetable_rules import end_from_duration

        start = fields.get("start_time")
        if not start:
            raise ValidationError("Enter the start time to use a duration")
        fields["end_time"] = end_from_duration(start, data["duration_hours"])
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


def _optional_lecturer(value) -> User | None:
    """A class may have no lecturer yet ("not assigned")."""
    lecturer_id = clean_int(value, "Lecturer", minimum=1)
    if not lecturer_id:
        return None
    lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first()
    if not lecturer:
        raise ValidationError("Unknown lecturer")
    return lecturer


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
    lecturer = _optional_lecturer(data.get("lecturer_id"))

    entry = Timetable(lecturer_id=lecturer.id if lecturer else None, **_timetable_fields(data))
    _refuse_clashes(entry, data)
    db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict()), 201


CLASH_KEYS = ("lecturer_id", "room", "days", "start_time", "end_time", "duration_hours")


def _refuse_clashes(entry, data, exclude_id=None):
    """No two classes with the same lecturer or room at the same time,
    unless the admin confirms it is one combined class (confirm_combined)."""
    from app.utils.timetable_rules import clash_message, find_clashes

    if not entry.start_time:
        return
    clashes = find_clashes(entry.lecturer_id, entry.room, entry.day_list(), entry.start_time, entry.end_time,
                           exclude_id=exclude_id)
    if clashes and not data.get("confirm_combined"):
        err = ValidationError(clash_message(clashes), status=409)
        err.extra = {"clashes": clashes}
        raise err


@admin_bp.put("/timetable/<int:entry_id>")
@permission_required("timetable:edit")
def update_timetable_entry(entry_id):
    entry = Timetable.query.get_or_404(entry_id)
    data = request.get_json(silent=True) or {}

    if "lecturer_id" in data:
        lecturer = _optional_lecturer(data.get("lecturer_id"))
        entry.lecturer_id = lecturer.id if lecturer else None
    for key, value in _timetable_fields(data, partial=True).items():
        setattr(entry, key, value)
    if entry.start_time and entry.end_time and entry.end_time <= entry.start_time:
        raise ValidationError("End time must be after the start time")
    if any(k in data for k in CLASH_KEYS):
        _refuse_clashes(entry, data, exclude_id=entry.id)

    db.session.commit()
    return jsonify(entry.to_dict())


@admin_bp.get("/timetable/periods")
@permission_required("timetable:view")
def timetable_periods():
    from app.utils.timetable_rules import STANDARD_DURATIONS, periods

    return jsonify({"periods": periods(), "durations": list(STANDARD_DURATIONS)})


@admin_bp.get("/timetable/clashes")
@permission_required("timetable:view")
def timetable_clashes():
    from app.utils.timetable_rules import all_clashes

    return jsonify(all_clashes())


@admin_bp.get("/timetable/sessions")
@permission_required("timetable:view", "reports:view")
def timetable_sessions():
    """Planned, held, cancelled and remaining sessions per class and course."""
    from app.utils.timetable_rules import course_sessions

    return jsonify(course_sessions(batch=request.args.get("batch") or None,
                                   lecturer_id=request.args.get("lecturer_id", type=int)))


@admin_bp.get("/timetable/sessions/export")
@permission_required("timetable:view", "reports:view")
def timetable_sessions_export():
    from app.utils import report_export as rx
    from app.utils.timetable_rules import course_sessions

    fmt = rx.export_format()
    data = course_sessions(batch=request.args.get("batch") or None, lecturer_id=request.args.get("lecturer_id", type=int))
    t = data["totals"]
    cells = [("Planned sessions", t["planned_sessions"], None), ("Held", t["held_sessions"], "present"),
             ("Cancelled (lecturer absent)", t["cancelled_sessions"], "exempted"), ("Missed", t["missed_sessions"], "absent"),
             ("Remaining", t["remaining_sessions"], None), ("Teaching hours", t["teaching_hours"], None),
             ("Completion", f"{t['completion_percent']}%" if t["completion_percent"] is not None else "-", None)]
    course_cols = [rx.Column("batch", "Class", 11), rx.Column("course_name", "Course", 30), rx.Column("lecturer_name", "Lecturer", 24),
                   rx.Column("target_sessions", "Standard", 8, "int"), rx.Column("planned_sessions", "Planned", 8, "int"),
                   rx.Column("held_sessions", "Held", 7, "int"), rx.Column("cancelled_sessions", "Cancelled", 8, "int"),
                   rx.Column("missed_sessions", "Missed", 7, "int"), rx.Column("remaining_sessions", "Remaining", 8, "int"),
                   rx.Column("teaching_hours", "Teaching hours", 9, "num"), rx.Column("completion_percent", "Completion %", 9, "pct")]
    class_cols = [rx.Column("batch", "Class", 11), rx.Column("course_name", "Course", 28), rx.Column("days", "Days", 12),
                  rx.Column("time", "Time", 11), rx.Column("duration_hours", "Hours", 6, "num"), rx.Column("room", "Room", 9),
                  rx.Column("lecturer_name", "Lecturer", 22), rx.Column("planned_sessions", "Planned", 8, "int"),
                  rx.Column("planned_source", "Planned from", 12), rx.Column("held_sessions", "Held", 7, "int"),
                  rx.Column("remaining_sessions", "Remaining", 8, "int"), rx.Column("completion_percent", "Completion %", 9, "pct")]
    note = (f"Planned sessions come from the timetable (meetings in the semester, minus no-class dates) or the admin's "
            f"setting per class; the faculty standard is {data['target_sessions']}. Held and cancelled are counted up to "
            f"{data['as_of']}. Cancelled = covered by an official lecturer absence.")
    tables = [rx.Table("By course", "Sessions by course", course_cols, data["courses"], summary=cells, note=note),
              rx.Table("By class meeting", "Sessions by timetable row", class_cols, data["classes"])]
    filters = [f"Class: {request.args['batch']}"] if request.args.get("batch") else []
    return rx.send(rx.Report("Course Sessions and Completion", "Course_Sessions",
                             f"{data['semester']['name']} ({data['semester']['from']} – {data['semester']['to']})",
                             tables, filters=filters), fmt)


@admin_bp.delete("/timetable/<int:entry_id>")
@permission_required("timetable:delete")
def delete_timetable_entry(entry_id):
    entry = Timetable.query.get_or_404(entry_id)
    if StudentAttendance.query.filter_by(timetable_id=entry.id).first():
        raise ValidationError("This class already has student attendance, so it can't be deleted. "
                              "Change it instead, or replace the timetable by uploading a new one.", status=409)
    for model in (BoardCodeAttempt, FaceCheckAttempt, BoardSession):
        model.query.filter_by(timetable_id=entry.id).delete()
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"message": "Deleted"})


# ---------- Timetable upload (Excel, one sheet per batch) ----------

def _uploaded_workbook() -> bytes:
    upload = request.files.get("file")
    if not upload or not upload.filename:
        raise ValidationError("Choose the timetable Excel file (.xlsx)")
    if not upload.filename.lower().endswith((".xlsx", ".xlsm")):
        raise ValidationError("Upload the timetable as an .xlsx file (in Excel: File > Save As > Excel Workbook)")
    return upload.read()


@admin_bp.post("/timetable/upload/preview")
@permission_required("timetable:add")
def preview_timetable_upload():
    """Read the workbook and say what the upload would do; nothing is saved."""
    from app.utils.timetable_rules import plan_clashes

    plan = build_plan(_uploaded_workbook())
    summary = plan_summary(plan)
    summary["clashes"] = plan_clashes(plan["classes"])
    return jsonify(summary)


@admin_bp.post("/timetable/upload")
@permission_required("timetable:add")
def upload_timetable():
    """Replace the whole timetable with the workbook's classes."""
    user = current_user()
    if not (has_permission(user, "timetable:edit") and has_permission(user, "timetable:delete")):
        raise ValidationError("Replacing the timetable needs the timetable Add, Edit and Delete permissions.", status=403)
    delete_history = str(request.form.get("delete_history", "")).lower() in ("1", "true", "yes", "on")
    return jsonify(apply_plan(build_plan(_uploaded_workbook()), delete_history))


@admin_bp.get("/timetable/batch-week")
@permission_required("timetable:view")
def batch_week():
    """One batch's classes for one teaching week (Saturday to Friday), with
    the real date of each class. A shared class ("BTE13&BEE11") shows for
    both batches; no-class dates from Settings are marked."""
    batch = clean_text(request.args.get("batch"), "Batch", max_len=50, required=True)
    raw = request.args.get("date")
    start = week_start_for(parse_iso_date(raw, "Date") if raw else date.today())
    query = Timetable.query.filter(Timetable.start_time.isnot(None))
    query = query.filter(Timetable.batch == batch) if "&" in batch else query.filter(batch_filter(Timetable.batch, batch))
    entries = sorted(query.all(), key=lambda e: e.start_time)
    no_class_dates = get_no_class_dates()

    days = []
    for offset in range(7):
        d = start + timedelta(days=offset)
        meeting = [e for e in entries if day_abbr(d) in e.day_list()]
        days.append({
            "date": d.isoformat(),
            "day": d.strftime("%A"),
            "no_class": d.isoformat() in no_class_dates,
            "classes": [{
                "timetable_id": e.id,
                "batch": e.batch,
                "start_time": e.start_time.strftime("%H:%M"),
                "end_time": e.end_time.strftime("%H:%M") if e.end_time else None,
                "lecturer_name": e.lecturer.name if e.lecturer else None,
                "course_name": e.course_name,
                "room": e.room,
            } for e in meeting],
        })
    return jsonify({
        "batch": batch,
        "week_start": start.isoformat(),
        "week_end": (start + timedelta(days=6)).isoformat(),
        "days": days,
    })


# ---------- Batches and rooms (the lists the timetable picks from) ----------

def _usage(column, value: str) -> int:
    return Timetable.query.filter(column == value).count()


@admin_bp.get("/batches")
@permission_required("timetable:view", "students:view")
def list_batches():
    students = dict(db.session.query(User.batch, func.count(User.id)).filter(User.role == "student").group_by(User.batch).all())
    classes = dict(db.session.query(Timetable.batch, func.count(Timetable.id)).group_by(Timetable.batch).all())
    out = []
    for b in Batch.query.order_by(Batch.code).all():
        data = b.to_dict()
        data["student_count"] = sum(students.get(m, 0) for m in members(b.code))
        data["class_count"] = classes.get(b.code, 0)
        out.append(data)
    return jsonify(out)


def _batch_fields(data) -> dict:
    code = clean_text(data.get("code"), "Batch code", max_len=50, required=True).replace(" & ", "&").upper()
    return {
        "code": code,
        "name": clean_text(data.get("name"), "Name", max_len=150),
        "department": clean_text(data.get("department"), "Department", max_len=150),
        "note": clean_text(data.get("note"), "Note", max_len=500),
    }


@admin_bp.post("/batches")
@permission_required("timetable:add")
def create_batch():
    fields = _batch_fields(request.get_json(silent=True) or {})
    if Batch.query.filter(func.lower(Batch.code) == fields["code"].lower()).first():
        raise ValidationError(f"Batch {fields['code']} already exists", status=409)
    batch = Batch(**fields)
    db.session.add(batch)
    db.session.commit()
    return jsonify(batch.to_dict()), 201


@admin_bp.put("/batches/<int:batch_id>")
@permission_required("timetable:edit")
def update_batch(batch_id):
    batch = Batch.query.get_or_404(batch_id)
    fields = _batch_fields(request.get_json(silent=True) or {})
    if fields["code"] != batch.code:
        if Batch.query.filter(func.lower(Batch.code) == fields["code"].lower(), Batch.id != batch.id).first():
            raise ValidationError(f"Batch {fields['code']} already exists", status=409)
        # Renaming a batch renames it everywhere it is used.
        Timetable.query.filter_by(batch=batch.code).update({"batch": fields["code"]})
        Course.query.filter_by(batch=batch.code).update({"batch": fields["code"]})
        User.query.filter_by(role="student", batch=batch.code).update({"batch": fields["code"]})
    for key, value in fields.items():
        setattr(batch, key, value)
    db.session.commit()
    return jsonify(batch.to_dict())


@admin_bp.delete("/batches/<int:batch_id>")
@permission_required("timetable:delete")
def delete_batch(batch_id):
    batch = Batch.query.get_or_404(batch_id)
    if _usage(Timetable.batch, batch.code) or User.query.filter_by(role="student", batch=batch.code).first():
        raise ValidationError(f"{batch.code} still has classes or students, so it can't be deleted.", status=409)
    db.session.delete(batch)
    db.session.commit()
    return jsonify({"message": "Batch deleted"})


@admin_bp.get("/rooms")
@permission_required("timetable:view")
def list_rooms():
    used = dict(db.session.query(Timetable.room, func.count(Timetable.id)).group_by(Timetable.room).all())
    rooms = sorted(Room.query.all(), key=lambda r: (len(r.name), r.name))
    return jsonify([dict(r.to_dict(), class_count=used.get(r.name, 0)) for r in rooms])


def _room_fields(data) -> dict:
    return {
        "name": clean_text(data.get("name"), "Room", max_len=100, required=True),
        "building": clean_text(data.get("building"), "Building", max_len=150),
        "capacity": clean_int(data.get("capacity"), "Capacity", minimum=1, maximum=2000),
        "note": clean_text(data.get("note"), "Note", max_len=500),
    }


@admin_bp.post("/rooms")
@permission_required("timetable:add")
def create_room():
    fields = _room_fields(request.get_json(silent=True) or {})
    if Room.query.filter(func.lower(Room.name) == fields["name"].lower()).first():
        raise ValidationError(f"Room {fields['name']} already exists", status=409)
    room = Room(**fields)
    db.session.add(room)
    db.session.commit()
    return jsonify(room.to_dict()), 201


@admin_bp.put("/rooms/<int:room_id>")
@permission_required("timetable:edit")
def update_room(room_id):
    room = Room.query.get_or_404(room_id)
    fields = _room_fields(request.get_json(silent=True) or {})
    if fields["name"] != room.name:
        if Room.query.filter(func.lower(Room.name) == fields["name"].lower(), Room.id != room.id).first():
            raise ValidationError(f"Room {fields['name']} already exists", status=409)
        Timetable.query.filter_by(room=room.name).update({"room": fields["name"]})
    for key, value in fields.items():
        setattr(room, key, value)
    db.session.commit()
    return jsonify(room.to_dict())


@admin_bp.delete("/rooms/<int:room_id>")
@permission_required("timetable:delete")
def delete_room(room_id):
    room = Room.query.get_or_404(room_id)
    if _usage(Timetable.room, room.name):
        raise ValidationError(f"Room {room.name} is used by classes in the timetable, so it can't be deleted.", status=409)
    db.session.delete(room)
    db.session.commit()
    return jsonify({"message": "Room deleted"})


# ---------- Course catalogue (courses offered and who teaches them) ----------

def _course_fields(data: dict) -> dict:
    lecturer_id = clean_int(data.get("lecturer_id"), "Lecturer", minimum=1)
    lecturer = User.query.filter_by(id=lecturer_id, role="lecturer").first() if lecturer_id else None
    if lecturer_id and not lecturer:
        raise ValidationError("Unknown lecturer")
    return {
        "code": clean_text(data.get("code"), "Course code", max_len=30),
        "name": clean_text(data.get("name"), "Course name", max_len=255, required=True),
        "batch": clean_text(data.get("batch"), "Batch", max_len=50),
        "department": clean_text(data.get("department"), "Department", max_len=150),
        "credit_hours": clean_int(data.get("credit_hours"), "Credit hours", minimum=0, maximum=30),
        "semester": clean_text(data.get("semester"), "Semester", max_len=100) or get_all_settings().get("semester_name"),
        "lecturer_id": lecturer.id if lecturer else None,
        "note": clean_text(data.get("note"), "Note", max_len=500),
    }


@admin_bp.get("/course-catalogue")
@permission_required("timetable:view")
def list_course_catalogue():
    courses = Course.query.order_by(Course.batch, Course.name).all()
    sessions = {}
    for entry in Timetable.query.all():
        sessions.setdefault((entry.course_name, entry.batch, entry.lecturer_id), 0)
        sessions[(entry.course_name, entry.batch, entry.lecturer_id)] += 1
    out = []
    for c in courses:
        data = c.to_dict()
        data["timetable_sessions"] = sessions.get((c.name, c.batch, c.lecturer_id), 0)
        out.append(data)
    return jsonify(out)


@admin_bp.post("/course-catalogue")
@permission_required("timetable:add")
def create_course():
    course = Course(**_course_fields(request.get_json(silent=True) or {}))
    db.session.add(course)
    db.session.commit()
    return jsonify(course.to_dict()), 201


@admin_bp.put("/course-catalogue/<int:course_id>")
@permission_required("timetable:edit")
def update_course(course_id):
    course = Course.query.get_or_404(course_id)
    for key, value in _course_fields(request.get_json(silent=True) or {}).items():
        setattr(course, key, value)
    db.session.commit()
    return jsonify(course.to_dict())


@admin_bp.delete("/course-catalogue/<int:course_id>")
@permission_required("timetable:delete")
def delete_course(course_id):
    course = Course.query.get_or_404(course_id)
    db.session.delete(course)
    db.session.commit()
    return jsonify({"message": "Course deleted"})


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


@admin_bp.get("/email-status")
@permission_required("settings:view")
def email_status():
    """What Settings > Email means right now, plus the queue counts."""
    settings = get_all_settings()
    mode = settings.get("email_mode", "on")
    if not current_app.config.get("MAIL_USERNAME"):
        state, detail = "unconfigured", "The mail server is not set up on the server, so no email can be sent."
    elif mode == "off":
        state, detail = "off", "Email is switched off. Nothing is sent and nothing is kept for later."
    elif mode == "paused":
        state, detail = "paused", "Email is paused. Meeting, task and assignment emails are waiting and will go out when you switch it back on."
    elif not within_send_hours(settings):
        state, detail = "waiting", "Outside sending hours. Notifications are waiting for the next sending window; class reminders are skipped."
    else:
        state, detail = "sending", "Emails are going out as the switches below allow."

    counts = dict(
        db.session.query(EmailOutbox.status, func.count(EmailOutbox.id)).group_by(EmailOutbox.status).all()
    )
    last_sent = db.session.query(func.max(EmailOutbox.sent_at)).scalar()
    return jsonify({
        "state": state,
        "detail": detail,
        "kinds": {kind: email_allowed(kind, settings) for kind in ("notification", "reminder", "account")},
        "queue": {s: counts.get(s, 0) for s in ("pending", "sent", "failed", "cancelled")},
        "last_sent_at": last_sent.isoformat() if last_sent else None,
    })


# ---------- Today / attendance / summary ----------

@admin_bp.get("/attendance/today")
@permission_required("lecturer_attendance:view", "dashboard:view")
def attendance_today():
    return jsonify(get_today_rows(date.today()))


@admin_bp.get("/attendance/daily")
@permission_required("lecturer_attendance:view", "reports:view")
def attendance_daily():
    """The lecturer daily report: one row per session (numbered 1, 2, 3 per
    lecturer) with its class, course, scheduled time, the day's check-in and
    check-out, the session's status and remarks. ?date= for any past day."""
    from app.utils.attendance_report import lecturer_session_rows

    the_date = parse_iso_date(request.args["date"], "date") if request.args.get("date") else date.today()
    return jsonify({"date": the_date.isoformat(), "rows": lecturer_session_rows(the_date, the_date)})


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


def _day_justified_by_absence(record, no_class_dates, index) -> bool:
    """A whole day a justified lecturer absence covers counts as justified
    even without a typed remark (the absence is the recorded reason)."""
    classes = get_day_classes(record.lecturer_id, record.date, no_class_dates)
    if not classes:
        return False
    teaching, covered = split_day_classes(classes, record.date, index)
    return not teaching and all(a.justified for a in covered.values())


@admin_bp.get("/summary")
@permission_required("reports:view")
def attendance_summary():
    month_str = request.args.get("month") or date.today().strftime("%Y-%m")
    start_date, end_date = _month_bounds(month_str)

    lecturers = User.query.filter_by(role="lecturer").order_by(User.name).all()
    no_class_dates = get_no_class_dates()
    index = AbsenceIndex.current()

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
            justified = bool(r.remarks and r.remarks.strip()) or _day_justified_by_absence(r, no_class_dates, index)
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
    index = AbsenceIndex.current()

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
            "Yes" if (r.remarks and r.remarks.strip()) or _day_justified_by_absence(r, no_class_dates, index) else "No",
            r.remarks or "",
            r.checkin_distance_m,
            r.checkout_distance_m,
        ])

    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=attendance-{month_str}.csv"},
    )


@admin_bp.get("/attendance/report")
@permission_required("reports:view")
def lecturer_attendance_report():
    """Daily lecturer attendance (one row per lecturer per day) for a month,
    or one day with date=YYYY-MM-DD, as PDF or Excel (format=pdf|xlsx)."""
    from app.utils import report_export as rx

    fmt = rx.export_format()
    if request.args.get("date"):
        start_date = end_date = parse_iso_date(request.args["date"], "Date")
        period_label = f"{start_date:%A %d %B %Y}"
    else:
        month_str = request.args.get("month") or date.today().strftime("%Y-%m")
        start_date, end_date = _month_bounds(month_str)
        period_label = f"{start_date:%B %Y}"
    records = Attendance.query.filter(Attendance.date >= start_date, Attendance.date <= end_date) \
        .order_by(Attendance.date, Attendance.scheduled_start).all()
    no_class_dates = get_no_class_dates()
    index = AbsenceIndex.current()
    category = {"on_time": "present", "late": "late", "absent": "absent", "left_early": "left_early",
                "no_checkout": "no_checkout"}
    rows = []
    for r in records:
        classes = get_day_classes(r.lecturer_id, r.date, no_class_dates)
        justified = bool(r.remarks and r.remarks.strip()) or _day_justified_by_absence(r, no_class_dates, index)
        late = 0
        if r.checkin_at and r.scheduled_start and r.status in ("on_time", "late", "left_early", "no_checkout"):
            late = max(0, int((r.checkin_at - r.scheduled_start).total_seconds() // 60))
        rows.append({
            "date": r.date.isoformat(), "lecturer": r.lecturer.name if r.lecturer else "",
            "classes": "; ".join(f"{e.course_name} ({e.batch})" if e.batch else e.course_name for e in classes),
            "scheduled_start": r.scheduled_start.strftime("%H:%M") if r.scheduled_start else None,
            "checkin": r.checkin_at.strftime("%H:%M") if r.checkin_at else None,
            "scheduled_end": r.scheduled_end.strftime("%H:%M") if r.scheduled_end else None,
            "checkout": r.checkout_at.strftime("%H:%M") if r.checkout_at else None,
            "late_minutes": late, "status": Attendance.STATUS_LABELS.get(r.status, r.status),
            "justified": "Yes" if justified else "No", "remarks": r.remarks,
            "category": "justified" if r.status == "absent" and justified else category.get(r.status),
        })
    cols = [rx.Column("date", "Date", 11), rx.Column("lecturer", "Lecturer", 22), rx.Column("classes", "Classes", 30),
            rx.Column("scheduled_start", "Starts", 7), rx.Column("checkin", "Checked in", 8),
            rx.Column("scheduled_end", "Ends", 7), rx.Column("checkout", "Checked out", 8),
            rx.Column("late_minutes", "Late min.", 8, "int"), rx.Column("status", "Status", 12),
            rx.Column("justified", "Justified", 9), rx.Column("remarks", "Remarks", 26)]
    count = lambda label: sum(1 for x in rows if x["status"] == label)
    summary = [("Lecturer-days", len(rows), None),
               ("On time", count(Attendance.STATUS_LABELS.get("on_time", "On time")), "present"),
               ("Late", count(Attendance.STATUS_LABELS.get("late", "Late")), "late"),
               ("Absent", count(Attendance.STATUS_LABELS.get("absent", "Absent")), "absent"),
               ("Late minutes", sum(x["late_minutes"] for x in rows), "late")]
    table = rx.Table("Daily attendance", "Daily Lecturer Attendance", cols, rows, summary=summary, status_col="status",
                     note="One row per lecturer per day: check-in is measured against the first class of the day.")
    return rx.send(rx.Report("Daily Lecturer Attendance", "Lecturer_Attendance", period_label, [table]), fmt)


@admin_bp.get("/timetable/export")
@permission_required("timetable:view")
def export_timetable():
    """The weekly timetable as PDF or Excel (format=pdf|xlsx); filters
    batch, lecturer_id, room, day."""
    from app.utils import report_export as rx
    from app.utils.batches import members as batch_members

    fmt = rx.export_format()
    query = Timetable.query.filter(Timetable.start_time.isnot(None))
    filters = []
    if request.args.get("lecturer_id"):
        lecturer = User.query.get(request.args.get("lecturer_id", type=int))
        query = query.filter(Timetable.lecturer_id == request.args.get("lecturer_id", type=int))
        filters.append(f"Lecturer: {lecturer.name if lecturer else '?'}")
    if request.args.get("room"):
        query = query.filter(Timetable.room == request.args["room"])
        filters.append(f"Room: {request.args['room']}")
    entries = query.all()
    if request.args.get("batch"):
        b = request.args["batch"]
        entries = [e for e in entries if e.batch == b or b in batch_members(e.batch)]
        filters.append(f"Class: {b}")
    week = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]
    day = request.args.get("day")
    if day:
        if day not in week:
            raise ValidationError("day must be Sat, Sun, Mon, Tue, Wed, Thu or Fri")
        filters.append(f"Day: {day}")
    rows = []
    for e in entries:
        for d in e.day_list():
            if day and d != day:
                continue
            minutes = None
            if e.end_time:
                minutes = (datetime.combine(date.today(), e.end_time) - datetime.combine(date.today(), e.start_time)).seconds // 60
            rows.append({
                "day": d, "start": e.start_time.strftime("%H:%M"), "end": e.end_time.strftime("%H:%M") if e.end_time else None,
                "hours": round(minutes / 60, 2) if minutes else None, "course": e.course_name, "batch": e.batch,
                "lecturer": e.lecturer.name if e.lecturer else "(unassigned)", "room": e.room,
                "periods": e.sessions or 1, "semester_total": e.semester_total_sessions,
            })
    rows.sort(key=lambda r: (week.index(r["day"]) if r["day"] in week else 9, r["start"], r["batch"] or ""))
    cols = [rx.Column("day", "Day", 7), rx.Column("start", "Start", 7), rx.Column("end", "End", 7),
            rx.Column("hours", "Hours", 7, "num"), rx.Column("course", "Course", 30), rx.Column("batch", "Class", 12),
            rx.Column("lecturer", "Lecturer", 24), rx.Column("room", "Room", 10),
            rx.Column("periods", "Sessions per meeting", 9, "int"), rx.Column("semester_total", "Planned sessions (semester)", 11, "int")]
    summary = [("Weekly meetings", len(rows), None), ("Courses", len({(r["course"], r["batch"]) for r in rows}), None),
               ("Teaching hours per week", round(sum(r["hours"] or 0 for r in rows), 1), None)]
    settings = get_all_settings()
    table = rx.Table("Timetable", "Weekly Timetable", cols, rows, summary=summary)
    return rx.send(rx.Report("Weekly Timetable", "Timetable", settings.get("semester_name") or "Current semester",
                             [table], filters=filters), fmt)


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
    from app.utils.profile import clean_value, record_change

    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    data = request.get_json(silent=True) or {}
    actor = current_user()
    before = {f: getattr(student, f) for f in ("name", "email", "department", "batch", "phone", "program",
                                               "study_semester", "student_id_number")}

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
    if data.get("student_id_number"):
        student.student_id_number = clean_value("student_id_number", data["student_id_number"], student)
    for field in ("phone", "program", "study_semester"):
        if field in data:
            student_value = data.get(field)
            setattr(student, field, clean_value(field, student_value, student) if student_value not in (None, "") else None)
    if "batch" in data:
        new_batch = clean_text(data.get("batch"), "Batch", max_len=50)
        if new_batch != student.batch:
            _change_student_class(student, new_batch, None)
    for field, old in before.items():
        record_change(student, field, old, getattr(student, field), "admin", actor)
    if "status" in data:
        if data["status"] not in ("active", "disabled"):
            raise ValidationError("Status must be active or disabled")
        student.status = data["status"]

    db.session.commit()
    return jsonify(student.to_dict())


@admin_bp.get("/profile-requests")
@permission_required("students:view")
def list_profile_requests():
    from app.models import ProfileChangeRequest

    q = ProfileChangeRequest.query
    if request.args.get("status"):
        q = q.filter_by(status=request.args["status"])
    rows = q.order_by(ProfileChangeRequest.created_at.desc()).limit(500).all()
    pending = ProfileChangeRequest.query.filter_by(status="pending").count()
    return jsonify({"rows": [r.to_dict() for r in rows], "pending": pending})


@admin_bp.get("/students/<int:user_id>/profile-history")
@permission_required("students:view")
def student_profile_history(user_id):
    from app.models import ProfileChange

    User.query.filter_by(id=user_id, role="student").first_or_404()
    rows = ProfileChange.query.filter_by(user_id=user_id).order_by(ProfileChange.changed_at.desc()).all()
    return jsonify([r.to_dict() for r in rows])


@admin_bp.post("/profile-requests/<int:request_id>/decision")
@permission_required("students:edit")
def decide_profile_request(request_id):
    """approve | reject (a reason is required to reject). An approved email
    change is applied only once the student confirms the new address."""
    import secrets as _secrets

    from app.models import ProfileChangeRequest, utcnow
    from app.utils.email import send_email_change_confirmation
    from app.utils.notify import notify
    from app.utils.profile import FIELD_LABELS, clean_value, record_change

    actor = current_user()
    req = ProfileChangeRequest.query.get_or_404(request_id)
    if req.status != "pending":
        raise ValidationError("This request is already decided", status=409)
    data = request.get_json(silent=True) or {}
    decision = data.get("decision")
    comment = clean_text(data.get("comment"), "Comment", max_len=1000)
    if decision not in ("approve", "reject"):
        raise ValidationError("decision must be approve or reject")
    if decision == "reject" and not comment:
        raise ValidationError("Give the reason, so the student knows why")
    student = req.student
    req.reviewer_id, req.reviewed_at, req.review_comment = actor.id, utcnow(), comment
    label = FIELD_LABELS.get(req.field, req.field)
    if decision == "reject":
        req.status = "rejected"
        title, message = f"Profile change not approved: {label}", f"Your request to change {label.lower()} was not approved. {comment}"
    else:
        value = clean_value(req.field, req.new_value, student)  # still valid and unique?
        if req.field == "email":
            req.status = "awaiting_confirmation"
            req.confirm_token = _secrets.token_urlsafe(32)
            req.confirm_expires_at = datetime.now() + timedelta(hours=72)
            db.session.flush()
            send_email_change_confirmation(student, value, req.confirm_token)
            title = "Email change approved: confirm the new address"
            message = (f"Open the link sent to {value} to finish. Until then, keep signing in with {student.email}.")
        else:
            if req.field == "batch":
                _change_student_class(student, value, f"Change request #{req.id}: {req.reason}")
            else:
                setattr(student, req.field, value)
            record_change(student, req.field, req.old_value, value, "request", actor, req.id)
            req.status = "approved"
            title, message = f"Profile updated: {label}", f"Your {label.lower()} is now '{value}'." + (f" {comment}" if comment else "")
    notify([student], type="notice", title=title, message=message, link="/my-profile", related_id=req.id,
           email_subject=f"FEBEMS – {title}"[:255], include_students=True)
    db.session.commit()
    return jsonify(req.to_dict())


def _change_student_class(student, new_batch, reason):
    """Move a student to another class without touching anything else.
    Past attendance keeps pointing at the old class's sessions; from now on
    the student follows the new class's timetable. Logged for audit."""
    actor = current_user()
    db.session.add(StudentClassChange(
        student_id=student.id, old_batch=student.batch, new_batch=new_batch, reason=reason,
        changed_by_id=actor.id, changed_by_name=actor.name,
    ))
    student.batch = new_batch


@admin_bp.post("/students/<int:user_id>/class")
@permission_required("students:edit")
def correct_student_class(user_id):
    """Correct a student's registered class. The account, profile, face,
    payments, submissions and attendance history all stay as they are."""
    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    data = request.get_json(silent=True) or {}
    new_batch = clean_text(data.get("batch"), "New class", max_len=50, required=True)
    reason = clean_text(data.get("reason"), "Reason", max_len=500, required=True)
    if new_batch == student.batch:
        raise ValidationError("The student is already in that class")
    known = {b.code for b in Batch.query.all()} | {
        m for (code,) in Timetable.query.with_entities(Timetable.batch).distinct() for m in members(code)
    }
    if new_batch not in known:
        raise ValidationError("Choose a class from the class list (Timetable → Batches)")
    old_batch = student.batch
    _change_student_class(student, new_batch, reason)
    db.session.commit()
    return jsonify({**student.to_dict(), "old_batch": old_batch})


@admin_bp.get("/students/<int:user_id>/class-history")
@permission_required("students:view")
def student_class_history(user_id):
    User.query.filter_by(id=user_id, role="student").first_or_404()
    changes = StudentClassChange.query.filter_by(student_id=user_id).order_by(StudentClassChange.changed_at.desc()).all()
    return jsonify([c.to_dict() for c in changes])


@admin_bp.delete("/students/<int:user_id>")
@permission_required("students:delete")
def delete_student(user_id):
    from app.models import PasswordResetToken

    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    PasswordResetToken.query.filter_by(user_id=student.id).delete()  # no ON DELETE rule on this table
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


@admin_bp.get("/students/<int:user_id>/report/export")
@permission_required("students:view", "reports:view")
def student_report_download(user_id):
    from app.utils import report_export as rx
    from app.utils.student_report import student_report_export

    student = User.query.filter_by(id=user_id, role="student").first_or_404()
    return student_report_export(student, rx.export_format())


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
    index = AbsenceIndex.current()

    # One row per class meeting today; a class shared by two batches
    # ("BTE13&BEE11") counts the students of both.
    entries = [e for e in Timetable.query.filter(Timetable.batch.isnot(None), Timetable.start_time.isnot(None)).all()
               if teaches_on(e, today, no_class_dates)]

    rows = []
    for batch in sorted({e.batch for e in entries}):
        total_students = User.query.filter(User.role == "student", User.batch.in_(members(batch)), User.status == "active").count()
        for entry in (e for e in entries if e.batch == batch):
            records = StudentAttendance.query.filter_by(timetable_id=entry.id, date=today).all()
            counts = {"on_time": 0, "late": 0, "absent": 0, "present": 0}
            for r in records:
                if r.status in counts:
                    counts[r.status] += 1
            checked_in = counts["on_time"] + counts["late"]
            absence = index.covering(entry, today)
            rows.append({
                "exempted": absence is not None,
                "exempt_reason": absence.reason_label if absence else None,
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
    students = User.query.filter(User.role == "student", User.batch.in_(members(entry.batch)), User.status == "active").order_by(User.name).all()
    existing = {
        r.student_id: r
        for r in StudentAttendance.query.filter_by(timetable_id=timetable_id, date=the_date).all()
    }

    start_dt, _ = scheduled_datetimes(entry, the_date)
    now = datetime.now()
    absence = AbsenceIndex.current().covering(entry, the_date)

    rows = []
    for student in students:
        record = existing.get(student.id)
        if record:
            row = record.to_dict()
        else:
            status = "absent" if should_mark_student_absent(start_dt, now, settings) else "not_yet"
            if absence:
                status = "exempted"
            row = {
                "id": None, "student_id": student.id, "student_name": student.name,
                "timetable_id": timetable_id, "date": the_date.isoformat(),
                "checkin_at": None, "status": status,
                "status_label": "Class Session Exempted" if status == "exempted" else StudentAttendance.STATUS_LABELS.get(status, status), "remarks": None,
            }
        rows.append(row)

    return jsonify({
        "timetable": entry.to_dict(),
        "date": the_date.isoformat(),
        "students": rows,
        "exempted": absence is not None,
        "exempt_reason": absence.reason_label if absence else None,
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
    students = User.query.filter(User.role == "student", User.batch.in_(members(batch))).order_by(User.name).all()
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
    students = User.query.filter(User.role == "student", User.batch.in_(members(batch))).order_by(User.name).all()
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
        row = sessions.setdefault((timetable_id, day), {"qr": 0, "board": 0, "online": 0})
        row[method if method in ("board", "online") else "qr"] += n

    boards: dict[tuple, list] = {}
    for b in BoardSession.query.filter(BoardSession.date >= date_from, BoardSession.date <= date_to).all():
        boards.setdefault((b.timetable_id, b.date), []).append(b)
        sessions.setdefault((b.timetable_id, b.date), {"qr": 0, "board": 0, "online": 0})

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
            "online": c["online"],
            "board": c["board"],
            "checked_in": c["qr"] + c["board"] + c["online"],
            "board_opened": bool(board_rows),
            "board_started_by": ", ".join(sorted({b.started_by.name for b in board_rows if b.started_by})) or None,
            "board_code_changes": sum(b.code_changes for b in board_rows),
            "board_share": round(c["board"] * 100 / (c["qr"] + c["board"]), 1) if (c["qr"] + c["board"]) else 0.0,
        })
    rows.sort(key=lambda r: (r["date"], r["batch"] or "", r["course_name"]), reverse=True)
    return jsonify({"from": date_from.isoformat(), "to": date_to.isoformat(), "rows": rows})
