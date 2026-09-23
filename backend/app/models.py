import uuid
from datetime import datetime

import bcrypt

from app.extensions import db


def utcnow():
    """Naive local server time. The whole app (scheduling, attendance,
    tokens) consistently uses naive local datetimes rather than mixing
    timezone-aware and naive values, which avoids comparison crashes and
    avoids Postgres re-interpreting naive UTC values in the server's session
    time zone."""
    return datetime.now()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=True)
    role = db.Column(db.String(20), nullable=False, default="lecturer")  # admin | lecturer | student
    status = db.Column(db.String(20), nullable=False, default="invited")  # invited | active | disabled
    pin_legacy = db.Column(db.String(20), nullable=True)

    # Student-only profile fields (NULL for admin/lecturer rows).
    student_id_number = db.Column(db.String(50), unique=True, nullable=True)
    department = db.Column(db.String(150), nullable=True)
    batch = db.Column(db.String(50), nullable=True)  # matches Timetable.batch, e.g. "BCE08"
    photo_filename = db.Column(db.String(255), nullable=True)

    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    timetable_entries = db.relationship(
        "Timetable", back_populates="lecturer", cascade="all, delete-orphan"
    )
    attendance_records = db.relationship(
        "Attendance", back_populates="lecturer", cascade="all, delete-orphan"
    )
    student_attendance_records = db.relationship(
        "StudentAttendance", back_populates="student", cascade="all, delete-orphan",
        foreign_keys="StudentAttendance.student_id",
    )

    def set_password(self, raw_password: str):
        self.password_hash = bcrypt.hashpw(raw_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    def check_password(self, raw_password: str) -> bool:
        if not self.password_hash:
            return False
        return bcrypt.checkpw(raw_password.encode("utf-8"), self.password_hash.encode("utf-8"))

    def to_dict(self):
        data = {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "role": self.role,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if self.role == "student":
            data.update({
                "student_id_number": self.student_id_number,
                "department": self.department,
                "batch": self.batch,
                "photo_url": f"/api/uploads/{self.photo_filename}" if self.photo_filename else None,
            })
        return data


class Timetable(db.Model):
    __tablename__ = "timetable"

    id = db.Column(db.Integer, primary_key=True)
    lecturer_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    course_name = db.Column(db.String(255), nullable=False)
    batch = db.Column(db.String(50), nullable=True)  # student batch/class code, e.g. "BCE08"
    room = db.Column(db.String(100), nullable=True)
    days = db.Column(db.String(50), nullable=True)  # e.g. "Sat,Mon,Wed"; empty/null = Sat-Thu
    start_time = db.Column(db.Time, nullable=True)
    end_time = db.Column(db.Time, nullable=True)
    sessions = db.Column(db.Integer, nullable=False, default=1)  # sessions per meeting (e.g. 2 for a back-to-back double period)

    # Total sessions THIS row contributes across the whole semester (accounting
    # for exam weeks/holidays), used as the fixed denominator for the
    # student 25%-absence rule -- set directly by admin since that can't be
    # reliably derived from a calendar until the term's breaks are finalized.
    # If a course has more than one Timetable row (e.g. different days),
    # each row's own total is summed. Leave blank to use a rough date-range
    # estimate instead.
    semester_total_sessions = db.Column(db.Integer, nullable=True)

    note = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    lecturer = db.relationship("User", back_populates="timetable_entries")

    DEFAULT_DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"]

    def day_list(self):
        if not self.days:
            return list(self.DEFAULT_DAYS)
        return [d.strip() for d in self.days.split(",") if d.strip()]

    def to_dict(self):
        return {
            "id": self.id,
            "lecturer_id": self.lecturer_id,
            "lecturer_name": self.lecturer.name if self.lecturer else None,
            "course_name": self.course_name,
            "batch": self.batch,
            "room": self.room,
            "days": self.day_list(),
            "start_time": self.start_time.strftime("%H:%M") if self.start_time else None,
            "end_time": self.end_time.strftime("%H:%M") if self.end_time else None,
            "sessions": self.sessions,
            "semester_total_sessions": self.semester_total_sessions,
            "note": self.note,
        }


class Attendance(db.Model):
    """One row per lecturer per day. A lecturer checks in/out once a day no
    matter how many classes they teach: check-in is measured against the
    start of their first class that day, check-out against the end of their
    last one. Which specific classes happened that day is derived from the
    Timetable at read time (see utils/schedule.get_day_classes), not stored
    here, since it's a many-to-one relationship for the same calendar day."""
    __tablename__ = "attendance"

    id = db.Column(db.Integer, primary_key=True)
    lecturer_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    date = db.Column(db.Date, nullable=False)

    scheduled_start = db.Column(db.DateTime, nullable=False)  # first class's start, that day
    scheduled_end = db.Column(db.DateTime, nullable=True)  # last class's end, that day

    checkin_at = db.Column(db.DateTime, nullable=True)
    checkin_lat = db.Column(db.Float, nullable=True)
    checkin_lng = db.Column(db.Float, nullable=True)
    checkin_distance_m = db.Column(db.Float, nullable=True)

    checkout_at = db.Column(db.DateTime, nullable=True)
    checkout_lat = db.Column(db.Float, nullable=True)
    checkout_lng = db.Column(db.Float, nullable=True)
    checkout_distance_m = db.Column(db.Float, nullable=True)

    status = db.Column(db.String(20), nullable=False, default="not_yet")
    # not_yet | on_time | late | absent | left_early | no_checkout

    # Admin-entered justification. Blank/NULL means the lecturer left early or
    # was absent without recorded permission; any text means it was cleared
    # or explained (e.g. "Approved sick leave", "Left at 2pm for a family
    # emergency, permission granted by the dean"). This is what makes monthly
    # reporting easy: absences/early-leaves are pre-split into justified vs
    # unjustified just by whether this field is empty.
    remarks = db.Column(db.String(500), nullable=True)

    reminder_sent_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    lecturer = db.relationship("User", back_populates="attendance_records")

    __table_args__ = (
        db.UniqueConstraint("lecturer_id", "date", name="uq_attendance_lecturer_date"),
    )

    STATUS_LABELS = {
        "not_yet": "Not yet",
        "on_time": "On time",
        "late": "Late",
        "absent": "Absent",
        "left_early": "Left early",
        "no_checkout": "No check-out",
    }

    def to_dict(self):
        return {
            "id": self.id,
            "lecturer_id": self.lecturer_id,
            "lecturer_name": self.lecturer.name if self.lecturer else None,
            "date": self.date.isoformat() if self.date else None,
            "scheduled_start": self.scheduled_start.isoformat() if self.scheduled_start else None,
            "scheduled_end": self.scheduled_end.isoformat() if self.scheduled_end else None,
            "checkin_at": self.checkin_at.isoformat() if self.checkin_at else None,
            "checkout_at": self.checkout_at.isoformat() if self.checkout_at else None,
            "checkin_distance_m": self.checkin_distance_m,
            "checkout_distance_m": self.checkout_distance_m,
            "status": self.status,
            "status_label": self.STATUS_LABELS.get(self.status, self.status),
            "remarks": self.remarks,
            "justified": bool(self.remarks and self.remarks.strip()),
        }


class StudentAttendance(db.Model):
    """One row per student per class session (per Timetable entry, per date) --
    unlike lecturers, students check in separately to every session, since
    per-course attendance percentage decides whether they must retake a
    course. There is no check-out: only arrival matters for a student.

    Status 'present' is distinct from 'on_time': it means an admin excused an
    absence after the student provided justification (remarks explains why).
    'on_time'/'late' are what actually happened at check-in; 'present' is a
    retroactive override of what was originally 'absent'.
    """
    __tablename__ = "student_attendance"

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    timetable_id = db.Column(db.Integer, db.ForeignKey("timetable.id"), nullable=False)
    date = db.Column(db.Date, nullable=False)

    scheduled_start = db.Column(db.DateTime, nullable=False)
    scheduled_end = db.Column(db.DateTime, nullable=True)

    checkin_at = db.Column(db.DateTime, nullable=True)
    checkin_lat = db.Column(db.Float, nullable=True)
    checkin_lng = db.Column(db.Float, nullable=True)
    checkin_distance_m = db.Column(db.Float, nullable=True)

    status = db.Column(db.String(20), nullable=False, default="not_yet")
    # not_yet | on_time | late | absent | present (present = excused absence)

    # A remark is mandatory whenever a lecturer or admin overrides a status
    # (e.g. absent -> present, or correcting a late) -- see
    # utils/student_override.py. modified_by records who did it and in what
    # role, for accountability between lecturers and admin staff.
    remarks = db.Column(db.String(500), nullable=True)
    modified_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    modified_by_role = db.Column(db.String(20), nullable=True)

    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    student = db.relationship("User", back_populates="student_attendance_records", foreign_keys=[student_id])
    timetable_entry = db.relationship("Timetable")
    modified_by = db.relationship("User", foreign_keys=[modified_by_id])

    __table_args__ = (
        db.UniqueConstraint("student_id", "timetable_id", "date", name="uq_student_attendance_session"),
    )

    STATUS_LABELS = {
        "not_yet": "Not yet",
        "on_time": "On time",
        "late": "Late",
        "absent": "Absent",
        "present": "Present (excused)",
    }

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "student_name": self.student.name if self.student else None,
            "timetable_id": self.timetable_id,
            "course_name": self.timetable_entry.course_name if self.timetable_entry else None,
            "batch": self.timetable_entry.batch if self.timetable_entry else None,
            "date": self.date.isoformat() if self.date else None,
            "scheduled_start": self.scheduled_start.isoformat() if self.scheduled_start else None,
            "scheduled_end": self.scheduled_end.isoformat() if self.scheduled_end else None,
            "checkin_at": self.checkin_at.isoformat() if self.checkin_at else None,
            "checkin_distance_m": self.checkin_distance_m,
            "status": self.status,
            "status_label": self.STATUS_LABELS.get(self.status, self.status),
            "remarks": self.remarks,
            "modified_by_name": self.modified_by.name if self.modified_by else None,
            "modified_by_role": self.modified_by_role,
        }


class Setting(db.Model):
    __tablename__ = "settings"

    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text, nullable=True)
    description = db.Column(db.String(500), nullable=True)

    DEFAULTS = {
        "site_name": ("University attendance", "Shown at the top of the check-in page."),
        "late_after_minutes": ("10", "A lecturer who checks in more than this many minutes after their first class's start time is marked Late."),
        "absent_after_minutes": ("50", "A lecturer who has not checked in this many minutes after their first class's start time is marked Absent. Use 0 to turn off."),
        "left_early_minutes": ("25", "A lecturer who checks out this many minutes or more before their last class's end time is marked Left early. Use 0 to turn off."),
        "no_checkout_after_minutes": ("90", "A lecturer who checked in but has not checked out this many minutes after their last class ends is marked No check-out. Use 0 to turn off."),
        "reminder_minutes_before": ("15", "Email a lecturer this many minutes before their first class if they have not checked in yet. Use 0 to stop reminders."),
        "verification_mode": ("both", "How campus presence is verified at check-in/out: 'both' (code and location), 'either' (code or location), 'code_only', 'location_only', or 'off'."),
        "location_rule": ("require", "off = ignore location. flag = accept but record distance. require = reject anyone outside the campus radius."),
        "campus_lat": ("2.032389", "Campus latitude in decimal degrees."),
        "campus_lng": ("45.307389", "Campus longitude in decimal degrees."),
        "campus_radius_m": ("100", "Allowed distance from the campus point, in metres."),
        "no_class_dates": ("", "Comma separated dates with no classes (holidays, exams), e.g. 2026-10-01,2026-12-25."),
        "student_late_after_minutes": ("10", "A student who checks in more than this many minutes after a session's start is marked Late."),
        "student_absent_after_minutes": ("20", "A student who has not checked in this many minutes after a session's start is marked Absent."),
        "student_verification_mode": ("both", "How campus presence is verified for student check-in: 'both', 'either', 'code_only', 'location_only', or 'off'."),
        "student_lates_equal_absent": ("2", "Every this many Late marks in one course count as one extra Absent toward the attendance percentage."),
        "student_absence_threshold_percent": ("25", "A student who has missed this percentage or more of a course's TOTAL planned sessions for the semester (not just sessions so far) is blocked from further check-ins to it and the course is flagged for retake."),
        "semester_start_date": ("2026-10-01", "First day of the current semester, used to work out each course's total planned sessions for the 25% attendance rule."),
        "semester_end_date": ("2027-02-28", "Last day of the current semester, used the same way as semester_start_date."),
    }

    def to_dict(self):
        return {"key": self.key, "value": self.value, "description": self.description}


class PasswordResetToken(db.Model):
    __tablename__ = "password_reset_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False, default=lambda: uuid.uuid4().hex)
    purpose = db.Column(db.String(20), nullable=False, default="reset")  # reset | invite
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)

    user = db.relationship("User")

    def is_valid(self):
        return self.used_at is None and utcnow() < self.expires_at
