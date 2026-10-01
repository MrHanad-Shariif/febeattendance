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
                "face_enrolled": self.face is not None,
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


class Course(db.Model):
    """A course offered this semester and the lecturer assigned to teach it.

    The admin keeps this catalogue under Timetable -> Courses. Timetable rows
    (the weekly sessions) can be created from a course, and lecturers see
    their assigned courses on their own timetable page."""
    __tablename__ = "courses"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(30), nullable=True)
    name = db.Column(db.String(255), nullable=False)
    batch = db.Column(db.String(50), nullable=True)
    department = db.Column(db.String(150), nullable=True)
    credit_hours = db.Column(db.Integer, nullable=True)
    semester = db.Column(db.String(100), nullable=True)
    lecturer_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    note = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    lecturer = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "batch": self.batch,
            "department": self.department,
            "credit_hours": self.credit_hours,
            "semester": self.semester,
            "lecturer_id": self.lecturer_id,
            "lecturer_name": self.lecturer.name if self.lecturer else None,
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

    # How the student proved they were in the room: 'qr' (lecturer's screen:
    # QR + rotating code) or 'board' (short code written on the board). NULL
    # for rows created without a check-in (auto-absent, overrides). Reports
    # use it to spot classes where board-code attendance looks suspicious.
    checkin_method = db.Column(db.String(20), nullable=True)

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
            "checkin_method": self.checkin_method,
        }


class Setting(db.Model):
    __tablename__ = "settings"

    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text, nullable=True)
    description = db.Column(db.String(500), nullable=True)

    DEFAULTS = {
        "site_name": ("FEBEMS", "System name shown on the kiosk screen and in emails (FEBEMS = Faculty of Engineering and Built Environment Management System)."),
        "semester_name": ("October 2026 - February 2027", "Name of the current semester, shown on every timetable and on new course assignments."),
        "late_after_minutes": ("10", "A lecturer who checks in more than this many minutes after their first class's start time is marked Late."),
        "absent_after_minutes": ("50", "A lecturer who has not checked in this many minutes after their first class's start time is marked Absent. Use 0 to turn off."),
        "left_early_minutes": ("25", "A lecturer who checks out this many minutes or more before their last class's end time is marked Left early. Use 0 to turn off."),
        "no_checkout_after_minutes": ("90", "A lecturer who checked in but has not checked out this many minutes after their last class ends is marked No check-out. Use 0 to turn off."),
        "reminder_minutes_before": ("15", "Email a lecturer this many minutes before their first class if they have not checked in yet. Use 0 to stop reminders."),
        "verification_mode": ("both", "How campus presence is verified at check-in/out: 'both' (code and location), 'either' (code or location), 'code_only', 'location_only', or 'off'."),
        "location_rule": ("require", "off = ignore location. flag = accept but record distance. require = reject anyone outside the campus radius."),
        "campus_lat": ("2.032389", "Campus latitude in decimal degrees. Lecturer and student check-ins are both measured from this point."),
        "campus_lng": ("45.307389", "Campus longitude in decimal degrees. Lecturer and student check-ins are both measured from this point."),
        "campus_radius_m": ("100", "Allowed distance from the campus point, in metres, for lecturers and students alike."),
        "no_class_dates": ("", "Comma separated dates with no classes (holidays, exams), e.g. 2026-10-01,2026-12-25."),
        "student_late_after_minutes": ("10", "A student who checks in more than this many minutes after a session's start is marked Late."),
        "student_absent_after_minutes": ("20", "A student who has not checked in this many minutes after a session's start is marked Absent."),
        "student_verification_mode": ("both", "Which steps the student check-in asks for: 'both' (class code and location), 'code_only', 'location_only', or 'off'. 'either' behaves like 'both' in the step-by-step check-in."),
        "student_face_verification": ("require", "require = students must pass a live face scan matching their registered face to check in. off = skip the face step."),
        "face_match_threshold": ("0.40", "How similar (0 to 1) a check-in face must be to the registered face. Higher is stricter. 0.36 to 0.50 is sensible."),
        "face_max_attempts_per_session": ("3", "Unsuccessful face scans allowed per class session before the student must see their lecturer."),
        "student_lates_equal_absent": ("2", "Every this many Late marks in one course count as one extra Absent toward the attendance percentage."),
        "student_absence_threshold_percent": ("25", "A student who has missed this percentage or more of a course's TOTAL planned sessions for the semester (not just sessions so far) is blocked from further check-ins to it and the course is flagged for retake."),
        "semester_start_date": ("2026-10-01", "First day of the current semester, used to work out each course's total planned sessions for the 25% attendance rule."),
        "semester_end_date": ("2027-02-28", "Last day of the current semester, used the same way as semester_start_date."),
        "dean_task_override": ("off", "on = the Dean may assign and manage tasks and meetings in any committee, not only committees they chair. off = only each committee's chairperson can."),
        "board_code_close_after_minutes": ("20", "Board check-in closes by itself this many minutes after the class starts, if the lecturer hasn't closed it. Use 0 to keep it open until the class ends."),
        "email_mode": ("on", "on = send emails as the switches and sending hours below allow. paused = send nothing for now; meeting, task and assignment emails wait and go out when switched back on (missed class reminders are not sent later). off = send nothing; waiting emails are cancelled, not kept."),
        "email_notifications": ("on", "Meeting, task, minutes, information-sharing and assignment emails. off = these only appear as in-app notifications; any still waiting are cancelled."),
        "email_checkin_reminders": ("on", "The 'class starting soon' email to lecturers who have not checked in. The timing is set under Lecturer rules."),
        "email_account_messages": ("on", "Account invites, email confirmations and password resets. These ignore sending hours. While off, new users get no invite (use Resend invite later) and nobody can reset a forgotten password."),
        "email_send_from": ("", "Earliest time of day emails may go out (HH:MM, campus time). Leave both times empty to send at any hour."),
        "email_send_until": ("", "Emails stop at this time (HH:MM). If it is earlier than the start time the window runs overnight. Outside the window notifications wait and reminders are skipped."),
        "email_send_days": ("Mon,Tue,Wed,Thu,Fri,Sat,Sun", "Days emails may go out. On other days notifications wait for the next sending day and reminders are skipped."),
    }

    def to_dict(self):
        return {"key": self.key, "value": self.value, "description": self.description}


class StudentFace(db.Model):
    """A student's registered face, as embedding vectors only -- never the raw
    camera frames. Kept in its own table (rather than columns on users) so
    `flask init-db` can create it on an existing database without a
    migration. Removing the row (admin "Reset face") lets the student enroll
    again at their next login."""
    __tablename__ = "student_faces"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    embeddings = db.Column(db.LargeBinary, nullable=False)  # float32 vectors, one per enrollment frame
    model_version = db.Column(db.String(50), nullable=False)
    enrolled_ip = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)

    user = db.relationship("User", backref=db.backref("face", uselist=False, cascade="all, delete-orphan"))


class FaceCheckAttempt(db.Model):
    """Audit trail of check-in face scans; also enforces the per-session
    attempt limit."""
    __tablename__ = "face_check_attempts"

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    timetable_id = db.Column(db.Integer, db.ForeignKey("timetable.id", ondelete="CASCADE"), nullable=False)
    date = db.Column(db.Date, nullable=False)
    result = db.Column(db.String(20), nullable=False)  # match | mismatch | no_liveness | bad_image
    score = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)


class BoardSession(db.Model):
    """Board-code check-in for one class session (timetable entry + date).

    The lecturer (or staff acting for them) taps Start and gets a short random
    code to write on the board. Students type it instead of scanning the QR
    and reading the rotating code; location and face checks are unchanged.
    It stays open until closed_at is set or closes_at passes. "New code"
    replaces `code` on the same row, so students already past the code step
    are not thrown out."""
    __tablename__ = "board_sessions"

    id = db.Column(db.Integer, primary_key=True)
    timetable_id = db.Column(db.Integer, db.ForeignKey("timetable.id", ondelete="CASCADE"), nullable=False, index=True)
    date = db.Column(db.Date, nullable=False)
    code = db.Column(db.String(8), nullable=False)
    opened_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    closes_at = db.Column(db.DateTime, nullable=False)
    closed_at = db.Column(db.DateTime, nullable=True)
    code_changes = db.Column(db.Integer, nullable=False, default=0)
    started_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    closed_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    timetable_entry = db.relationship("Timetable")
    started_by = db.relationship("User", foreign_keys=[started_by_id])
    closed_by = db.relationship("User", foreign_keys=[closed_by_id])

    def is_open(self, now=None) -> bool:
        now = now or utcnow()
        return self.closed_at is None and now < self.closes_at

    def to_dict(self, include_code: bool = False):
        now = utcnow()
        data = {
            "id": self.id,
            "timetable_id": self.timetable_id,
            "date": self.date.isoformat() if self.date else None,
            "open": self.is_open(now),
            "opened_at": self.opened_at.isoformat() if self.opened_at else None,
            "closes_at": self.closes_at.isoformat() if self.closes_at else None,
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "seconds_left": max(0, int((self.closes_at - now).total_seconds())) if self.is_open(now) else 0,
            "code_changes": self.code_changes,
            "started_by_name": self.started_by.name if self.started_by else None,
            "closed_by_name": self.closed_by.name if self.closed_by else None,
        }
        if include_code:
            data["code"] = self.code
        return data


class BoardCodeAttempt(db.Model):
    """Every board code a student types. Wrong ones count toward the
    per-class lockout, which makes guessing a 4-digit code pointless."""
    __tablename__ = "board_code_attempts"

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    timetable_id = db.Column(db.Integer, db.ForeignKey("timetable.id", ondelete="CASCADE"), nullable=False)
    date = db.Column(db.Date, nullable=False)
    success = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# User management: fine-grained role-based access control.
#
# Permissions are "<resource>:<action>" codes (e.g. "timetable:edit") from the
# catalogue in utils/rbac.py. Roles bundle permissions; users hold roles
# (many-to-many both ways), never raw permissions. User.role stays the
# *account type* (admin / lecturer / student): what a staff account may do
# in the management screens comes only from its roles.
# ---------------------------------------------------------------------------

role_permissions = db.Table(
    "role_permissions",
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    db.Column("permission_id", db.Integer, db.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)

user_roles = db.Table(
    "user_roles",
    db.Column("user_id", db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class Permission(db.Model):
    __tablename__ = "permissions"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(80), unique=True, nullable=False)  # "<resource>:<action>"
    resource = db.Column(db.String(50), nullable=False)
    action = db.Column(db.String(20), nullable=False)  # view | add | edit | delete
    description = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "resource": self.resource,
            "action": self.action,
            "description": self.description,
        }


class Role(db.Model):
    __tablename__ = "roles"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    description = db.Column(db.String(500), nullable=True)
    # System roles (Super Admin) can't be renamed, edited or deleted.
    is_system = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    permissions = db.relationship("Permission", secondary=role_permissions, order_by="Permission.code")
    users = db.relationship("User", secondary=user_roles, back_populates="roles")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "is_system": self.is_system,
            "permissions": [p.code for p in self.permissions],
            "user_count": len(self.users),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


User.roles = db.relationship("Role", secondary=user_roles, back_populates="users", order_by="Role.name")


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


# ---------------------------------------------------------------------------
# Committees & task management module.
#
# Everything below reuses the `users` table: a lecturer (or admin) keeps one
# account, and their extra responsibilities -- Dean, Administration Team,
# committee member, committee chairperson -- are rows in these tables rather
# than new accounts or a different `User.role`. Permission rules live in
# utils/permissions.py and are checked on the server for every request.
# ---------------------------------------------------------------------------

class FacultyRole(db.Model):
    """Faculty-level responsibility held by an existing account."""
    __tablename__ = "faculty_roles"

    ROLES = ("dean", "admin_team")
    LABELS = {"dean": "Dean", "admin_team": "Administration Team"}

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False)
    granted_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted_at = db.Column(db.DateTime, default=utcnow)

    user = db.relationship("User", foreign_keys=[user_id])

    __table_args__ = (db.UniqueConstraint("user_id", "role", name="uq_faculty_role_user_role"),)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "user_name": self.user.name if self.user else None,
            "user_email": self.user.email if self.user else None,
            "role": self.role,
            "role_label": self.LABELS.get(self.role, self.role),
            "granted_at": self.granted_at.isoformat() if self.granted_at else None,
        }


class Committee(db.Model):
    """A faculty committee. kind='administration' is the Dean's Administration
    Team, which reuses the same task/meeting/minutes machinery."""
    __tablename__ = "committees"

    KINDS = ("committee", "administration")
    KIND_LABELS = {"committee": "Committee", "administration": "Administration Team"}

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)
    # Scope of work (SOW): what the committee is responsible for delivering.
    scope_of_work = db.Column(db.Text, nullable=True)
    kind = db.Column(db.String(20), nullable=False, default="committee")
    chairperson_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = db.Column(db.String(20), nullable=False, default="active")  # active | archived
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    chairperson = db.relationship("User", foreign_keys=[chairperson_id])
    memberships = db.relationship("CommitteeMember", back_populates="committee", cascade="all, delete-orphan")

    @property
    def secretary(self):
        return next((m for m in self.memberships if m.role == "secretary"), None)

    @property
    def officers(self) -> list:
        """Chairperson and secretary: the people who run the committee."""
        return [m.user for m in self.memberships if m.role in CommitteeMember.OFFICER_ROLES and m.user]

    def to_dict(self, counts: dict | None = None):
        data = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "scope_of_work": self.scope_of_work,
            "kind": self.kind,
            "kind_label": self.KIND_LABELS.get(self.kind, self.kind),
            "chairperson_id": self.chairperson_id,
            "chairperson_name": self.chairperson.name if self.chairperson else None,
            "secretary_id": self.secretary.user_id if self.secretary else None,
            "secretary_name": self.secretary.user.name if self.secretary and self.secretary.user else None,
            "status": self.status,
            "member_count": len(self.memberships),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if counts:
            data.update(counts)
        return data


class CommitteeMember(db.Model):
    __tablename__ = "committee_members"

    ROLES = ("member", "chairperson", "secretary")
    # The secretary has the same authority as the chairperson.
    OFFICER_ROLES = ("chairperson", "secretary")
    LABELS = {"member": "Member", "chairperson": "Chairperson", "secretary": "Secretary"}

    id = db.Column(db.Integer, primary_key=True)
    committee_id = db.Column(db.Integer, db.ForeignKey("committees.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False, default="member")
    joined_at = db.Column(db.DateTime, default=utcnow)

    committee = db.relationship("Committee", back_populates="memberships")
    user = db.relationship("User")

    __table_args__ = (db.UniqueConstraint("committee_id", "user_id", name="uq_committee_member"),)

    def to_dict(self):
        return {
            "id": self.id,
            "committee_id": self.committee_id,
            "user_id": self.user_id,
            "name": self.user.name if self.user else None,
            "email": self.user.email if self.user else None,
            "role": self.role,
            "role_label": self.LABELS.get(self.role, self.role),
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
        }


class Task(db.Model):
    __tablename__ = "tasks"

    STATUSES = ("pending", "in_progress", "completed")
    PRIORITIES = ("low", "normal", "high", "urgent")
    STATUS_LABELS = {"pending": "Pending", "in_progress": "In progress", "completed": "Completed", "overdue": "Overdue"}

    id = db.Column(db.Integer, primary_key=True)
    committee_id = db.Column(db.Integer, db.ForeignKey("committees.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_to_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    deadline = db.Column(db.DateTime, nullable=True)
    priority = db.Column(db.String(20), nullable=False, default="normal")
    status = db.Column(db.String(20), nullable=False, default="pending")
    assigned_at = db.Column(db.DateTime, default=utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    completed_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    completion_note = db.Column(db.Text, nullable=True)
    # Filled in by the assignee when completing; printed on the standard task report.
    report_outcomes = db.Column(db.Text, nullable=True)
    report_challenges = db.Column(db.Text, nullable=True)
    report_recommendations = db.Column(db.Text, nullable=True)
    # Set by the deadline sweep so each reminder is sent only once.
    due_soon_notified_at = db.Column(db.DateTime, nullable=True)
    overdue_notified_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    committee = db.relationship("Committee")
    assigned_by = db.relationship("User", foreign_keys=[assigned_by_id])
    assigned_to = db.relationship("User", foreign_keys=[assigned_to_id])
    completed_by = db.relationship("User", foreign_keys=[completed_by_id])
    attachments = db.relationship("TaskAttachment", back_populates="task", cascade="all, delete-orphan",
                                  order_by="TaskAttachment.uploaded_at")
    events = db.relationship("TaskEvent", back_populates="task", cascade="all, delete-orphan",
                             order_by="TaskEvent.created_at")

    def is_overdue(self, now=None) -> bool:
        now = now or utcnow()
        return self.status != "completed" and self.deadline is not None and self.deadline < now

    def display_status(self, now=None) -> str:
        return "overdue" if self.is_overdue(now) else self.status

    def to_dict(self, detail: bool = False):
        shown = self.display_status()
        data = {
            "id": self.id,
            "committee_id": self.committee_id,
            "committee_name": self.committee.name if self.committee else None,
            "committee_kind": self.committee.kind if self.committee else None,
            "assigned_by_id": self.assigned_by_id,
            "assigned_by_name": self.assigned_by.name if self.assigned_by else None,
            "assigned_to_id": self.assigned_to_id,
            "assigned_to_name": self.assigned_to.name if self.assigned_to else None,
            "title": self.title,
            "description": self.description,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "priority": self.priority,
            "status": self.status,
            "display_status": shown,
            "status_label": self.STATUS_LABELS.get(shown, shown),
            "is_overdue": shown == "overdue",
            "assigned_at": self.assigned_at.isoformat() if self.assigned_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "completed_by_name": self.completed_by.name if self.completed_by else None,
            "completion_note": self.completion_note,
            "report_outcomes": self.report_outcomes,
            "report_challenges": self.report_challenges,
            "report_recommendations": self.report_recommendations,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "attachment_count": len(self.attachments),
        }
        if detail:
            data["attachments"] = [a.to_dict() for a in self.attachments]
            data["history"] = [e.to_dict() for e in self.events]
        return data


class TaskAttachment(db.Model):
    __tablename__ = "task_attachments"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = db.Column(db.String(255), nullable=False)  # original name, for display/download
    file_path = db.Column(db.String(255), nullable=False)  # relative to UPLOAD_FOLDER (private/...)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=utcnow)

    task = db.relationship("Task", back_populates="attachments")
    uploaded_by = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "task_id": self.task_id,
            "file_name": self.file_name,
            "url": f"/api/tasks/{self.task_id}/attachments/{self.id}",
            "uploaded_by_name": self.uploaded_by.name if self.uploaded_by else None,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
        }


class TaskEvent(db.Model):
    """Audit trail: one row per important action on a task (never edited)."""
    __tablename__ = "task_events"

    LABELS = {
        "created": "Task created",
        "assigned": "Assigned",
        "reassigned": "Reassigned",
        "edited": "Edited",
        "deadline_changed": "Deadline changed",
        "status_changed": "Status changed",
        "completed": "Completed",
        "reopened": "Reopened",
        "file_uploaded": "File uploaded",
        "notification_sent": "Notification sent",
        "deleted": "Deleted",
    }

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = db.Column(db.String(30), nullable=False)
    old_value = db.Column(db.JSON, nullable=True)
    new_value = db.Column(db.JSON, nullable=True)
    note = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)

    task = db.relationship("Task", back_populates="events")
    actor = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "action": self.action,
            "action_label": self.LABELS.get(self.action, self.action),
            "actor_name": self.actor.name if self.actor else "System",
            "old_value": self.old_value,
            "new_value": self.new_value,
            "note": self.note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Meeting(db.Model):
    __tablename__ = "meetings"

    STATUSES = ("scheduled", "held", "cancelled")

    id = db.Column(db.Integer, primary_key=True)
    committee_id = db.Column(db.Integer, db.ForeignKey("committees.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    date = db.Column(db.Date, nullable=False)
    start_time = db.Column(db.Time, nullable=True)
    end_time = db.Column(db.Time, nullable=True)
    location = db.Column(db.String(255), nullable=True)
    agenda = db.Column(db.Text, nullable=True)
    agenda_file_name = db.Column(db.String(255), nullable=True)
    agenda_file_path = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(20), nullable=False, default="scheduled")
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    committee = db.relationship("Committee")
    created_by = db.relationship("User")
    minutes = db.relationship("MeetingMinutes", back_populates="meeting", uselist=False)

    def to_dict(self):
        return {
            "id": self.id,
            "committee_id": self.committee_id,
            "committee_name": self.committee.name if self.committee else None,
            "committee_kind": self.committee.kind if self.committee else None,
            "meeting_type": Committee.KIND_LABELS.get(self.committee.kind) if self.committee else None,
            "title": self.title,
            "date": self.date.isoformat() if self.date else None,
            "start_time": self.start_time.strftime("%H:%M") if self.start_time else None,
            "end_time": self.end_time.strftime("%H:%M") if self.end_time else None,
            "location": self.location,
            "agenda": self.agenda,
            "agenda_file_name": self.agenda_file_name,
            "agenda_url": f"/api/meetings/{self.id}/agenda" if self.agenda_file_path else None,
            "status": self.status,
            "created_by_name": self.created_by.name if self.created_by else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "minutes_id": self.minutes.id if self.minutes else None,
        }


class MeetingMinutes(db.Model):
    """Permanent archive of officially published minutes."""
    __tablename__ = "meeting_minutes"

    VISIBILITIES = ("committee", "faculty")

    id = db.Column(db.Integer, primary_key=True)
    meeting_id = db.Column(db.Integer, db.ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True, unique=True)
    committee_id = db.Column(db.Integer, db.ForeignKey("committees.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    meeting_date = db.Column(db.Date, nullable=False)
    summary = db.Column(db.Text, nullable=True)
    file_name = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    visibility = db.Column(db.String(20), nullable=False, default="committee")
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at = db.Column(db.DateTime, default=utcnow)  # the official release date/time

    meeting = db.relationship("Meeting", back_populates="minutes")
    committee = db.relationship("Committee")
    uploaded_by = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "meeting_id": self.meeting_id,
            "committee_id": self.committee_id,
            "committee_name": self.committee.name if self.committee else None,
            "committee_kind": self.committee.kind if self.committee else None,
            "unit_label": Committee.KIND_LABELS.get(self.committee.kind) if self.committee else None,
            "title": self.title,
            "meeting_date": self.meeting_date.isoformat() if self.meeting_date else None,
            "year": self.meeting_date.year if self.meeting_date else None,
            "summary": self.summary,
            "file_name": self.file_name,
            "url": f"/api/minutes/{self.id}/document",
            "visibility": self.visibility,
            "uploaded_by_name": self.uploaded_by.name if self.uploaded_by else None,
            "published_at": self.published_at.isoformat() if self.published_at else None,
        }


class Notification(db.Model):
    __tablename__ = "notifications"

    TYPES = ("task", "meeting", "minutes", "notice", "assignment")

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = db.Column(db.String(20), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    message = db.Column(db.String(1000), nullable=True)
    link = db.Column(db.String(255), nullable=True)  # SPA path to open
    related_record_id = db.Column(db.Integer, nullable=True)
    read_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "message": self.message,
            "link": self.link,
            "related_record_id": self.related_record_id,
            "read": self.read_at is not None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class InformationPost(db.Model):
    """Information Sharing: the notification/distribution channel. Published
    minutes create one of these automatically (category 'meeting_minutes')."""
    __tablename__ = "information_posts"

    CATEGORIES = ("announcement", "circular", "policy", "event", "meeting_minutes", "other")
    AUDIENCES = ("all_staff", "lecturers", "committee")

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    category = db.Column(db.String(30), nullable=False, default="announcement")
    audience = db.Column(db.String(20), nullable=False, default="all_staff")
    committee_id = db.Column(db.Integer, db.ForeignKey("committees.id", ondelete="CASCADE"), nullable=True)
    file_name = db.Column(db.String(255), nullable=True)
    file_path = db.Column(db.String(255), nullable=True)
    minutes_id = db.Column(db.Integer, db.ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=True)
    published_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at = db.Column(db.DateTime, default=utcnow, index=True)

    committee = db.relationship("Committee")
    published_by = db.relationship("User")
    minutes = db.relationship("MeetingMinutes")

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "audience": self.audience,
            "committee_id": self.committee_id,
            "committee_name": self.committee.name if self.committee else None,
            "file_name": self.file_name,
            "url": f"/api/notices/{self.id}/document" if self.file_path else None,
            "minutes_id": self.minutes_id,
            "published_by_name": self.published_by.name if self.published_by else None,
            "published_at": self.published_at.isoformat() if self.published_at else None,
        }


class EmailOutbox(db.Model):
    """Queued emails, sent in batches by the flush_email_outbox job so a
    faculty-wide notice never blocks a request or fails on one bad address."""
    __tablename__ = "email_outbox"

    MAX_ATTEMPTS = 3

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    subject = db.Column(db.String(255), nullable=False)
    html = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)  # pending | sent | failed | cancelled
    attempts = db.Column(db.Integer, nullable=False, default=0)
    last_error = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    sent_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship("User")


# ---------------------------------------------------------------------------
# Committee archive: memos, meeting agendas and task reports in one place.
# Visible to the committee's chairperson and secretary, system admins, the
# Dean and the Administration Team (see utils/permissions.can_view_archive).
# ---------------------------------------------------------------------------

class ArchiveDocument(db.Model):
    __tablename__ = "archive_documents"

    CATEGORIES = ("memo", "agenda", "report")
    CATEGORY_LABELS = {"memo": "Memo", "agenda": "Meeting Agenda", "report": "Report"}
    # created = generated by the system from a form (memo, agenda, task report)
    # uploaded = a file someone attached
    SOURCES = ("created", "uploaded")

    id = db.Column(db.Integer, primary_key=True)
    committee_id = db.Column(db.Integer, db.ForeignKey("committees.id", ondelete="CASCADE"), nullable=False, index=True)
    category = db.Column(db.String(20), nullable=False, index=True)
    source = db.Column(db.String(20), nullable=False, default="uploaded")
    reference_no = db.Column(db.String(100), nullable=True)
    title = db.Column(db.String(255), nullable=False)
    document_date = db.Column(db.Date, nullable=False)
    summary = db.Column(db.Text, nullable=True)
    # Memo fields (kept so the PDF can be regenerated and searched).
    memo_to = db.Column(db.String(500), nullable=True)
    memo_from = db.Column(db.String(500), nullable=True)
    memo_cc = db.Column(db.String(500), nullable=True)
    body = db.Column(db.Text, nullable=True)
    file_name = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    meeting_id = db.Column(db.Integer, db.ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    committee = db.relationship("Committee")
    task = db.relationship("Task")
    meeting = db.relationship("Meeting")
    created_by = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "committee_id": self.committee_id,
            "committee_name": self.committee.name if self.committee else None,
            "category": self.category,
            "category_label": self.CATEGORY_LABELS.get(self.category, self.category),
            "source": self.source,
            "reference_no": self.reference_no,
            "title": self.title,
            "document_date": self.document_date.isoformat() if self.document_date else None,
            "summary": self.summary,
            "memo_to": self.memo_to,
            "memo_from": self.memo_from,
            "memo_cc": self.memo_cc,
            "body": self.body,
            "file_name": self.file_name,
            "url": f"/api/archive/{self.id}/document",
            "task_id": self.task_id,
            "meeting_id": self.meeting_id,
            "created_by_id": self.created_by_id,
            "created_by_name": self.created_by.name if self.created_by else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------------------------------------------------------------------------
# Assignments: a lecturer sets work for one of their classes (course + batch),
# students of that batch upload files until the deadline, the lecturer
# comments. Submissions close by themselves at the deadline; the lecturer can
# move the deadline for everyone or give individual students extra time.
# ---------------------------------------------------------------------------

class Assignment(db.Model):
    __tablename__ = "assignments"

    id = db.Column(db.Integer, primary_key=True)
    lecturer_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_name = db.Column(db.String(255), nullable=False)
    batch = db.Column(db.String(50), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    instructions = db.Column(db.Text, nullable=True)
    deadline = db.Column(db.DateTime, nullable=False)
    file_name = db.Column(db.String(255), nullable=True)  # optional brief from the lecturer
    file_path = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    lecturer = db.relationship("User")
    submissions = db.relationship("AssignmentSubmission", back_populates="assignment", cascade="all, delete-orphan")
    extensions = db.relationship("AssignmentExtension", back_populates="assignment", cascade="all, delete-orphan")

    def extension_for(self, student_id: int):
        return next((e for e in self.extensions if e.student_id == student_id), None)

    def deadline_for(self, student_id: int):
        """The later of the assignment deadline and the student's own extension."""
        ext = self.extension_for(student_id)
        return max(self.deadline, ext.deadline) if ext else self.deadline

    def is_open_for(self, student_id: int, now=None) -> bool:
        return (now or utcnow()) < self.deadline_for(student_id)

    def to_dict(self):
        now = utcnow()
        return {
            "id": self.id,
            "lecturer_id": self.lecturer_id,
            "lecturer_name": self.lecturer.name if self.lecturer else None,
            "course_name": self.course_name,
            "batch": self.batch,
            "title": self.title,
            "instructions": self.instructions,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "open": now < self.deadline,
            "file_name": self.file_name,
            "file_url": f"/api/assignments/{self.id}/brief" if self.file_path else None,
            "submission_count": len(self.submissions),
            "extension_count": len(self.extensions),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AssignmentExtension(db.Model):
    """Extra time for one student on one assignment."""
    __tablename__ = "assignment_extensions"

    id = db.Column(db.Integer, primary_key=True)
    assignment_id = db.Column(db.Integer, db.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    deadline = db.Column(db.DateTime, nullable=False)
    reason = db.Column(db.String(500), nullable=True)
    granted_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted_at = db.Column(db.DateTime, default=utcnow)

    assignment = db.relationship("Assignment", back_populates="extensions")
    student = db.relationship("User", foreign_keys=[student_id])

    __table_args__ = (db.UniqueConstraint("assignment_id", "student_id", name="uq_assignment_extension"),)

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "reason": self.reason,
            "granted_at": self.granted_at.isoformat() if self.granted_at else None,
        }


class AssignmentSubmission(db.Model):
    __tablename__ = "assignment_submissions"

    id = db.Column(db.Integer, primary_key=True)
    assignment_id = db.Column(db.Integer, db.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    note = db.Column(db.Text, nullable=True)  # the student's message to the lecturer
    submitted_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow)
    lecturer_comment = db.Column(db.Text, nullable=True)
    commented_at = db.Column(db.DateTime, nullable=True)

    assignment = db.relationship("Assignment", back_populates="submissions")
    student = db.relationship("User")
    files = db.relationship("SubmissionFile", back_populates="submission", cascade="all, delete-orphan",
                            order_by="SubmissionFile.uploaded_at")

    __table_args__ = (db.UniqueConstraint("assignment_id", "student_id", name="uq_assignment_submission"),)

    def to_dict(self):
        return {
            "id": self.id,
            "assignment_id": self.assignment_id,
            "student_id": self.student_id,
            "student_name": self.student.name if self.student else None,
            "student_id_number": self.student.student_id_number if self.student else None,
            "note": self.note,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "lecturer_comment": self.lecturer_comment,
            "commented_at": self.commented_at.isoformat() if self.commented_at else None,
            "files": [f.to_dict() for f in self.files],
        }


class SubmissionFile(db.Model):
    __tablename__ = "submission_files"

    id = db.Column(db.Integer, primary_key=True)
    submission_id = db.Column(db.Integer, db.ForeignKey("assignment_submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    size_bytes = db.Column(db.Integer, nullable=True)
    uploaded_at = db.Column(db.DateTime, default=utcnow)

    submission = db.relationship("AssignmentSubmission", back_populates="files")

    def to_dict(self):
        return {
            "id": self.id,
            "file_name": self.file_name,
            "size_bytes": self.size_bytes,
            "url": f"/api/assignments/submissions/{self.submission_id}/files/{self.id}",
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
        }


class ActivityLog(db.Model):
    """System log: sign-ins (and failed attempts), sign-outs and every change
    a signed-in user makes, with where it came from. Written by
    utils/activity_log.py; rows are never edited.

    ``session_id`` is issued at sign-in and carried in the token (claim
    ``sid``), so each action can be traced back to the sign-in that made it.
    Name, email and role are copied at write time so the log still reads
    correctly after an account is renamed or deleted.
    """
    __tablename__ = "activity_logs"

    EVENTS = ("login", "login_failed", "logout", "action")

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)
    event = db.Column(db.String(20), nullable=False, index=True)
    session_id = db.Column(db.String(64), nullable=True, index=True)

    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    user_name = db.Column(db.String(200), nullable=True)
    user_email = db.Column(db.String(255), nullable=True)  # the email typed, for failed sign-ins
    user_role = db.Column(db.String(20), nullable=True)

    action = db.Column(db.String(200), nullable=True)  # human-readable, e.g. "Created a committee"
    area = db.Column(db.String(50), nullable=True)
    method = db.Column(db.String(10), nullable=True)
    path = db.Column(db.String(500), nullable=True)
    status_code = db.Column(db.Integer, nullable=True)
    detail = db.Column(db.String(500), nullable=True)

    ip_address = db.Column(db.String(64), nullable=True)
    location = db.Column(db.String(200), nullable=True)
    user_agent = db.Column(db.String(500), nullable=True)
    device = db.Column(db.String(200), nullable=True)
    # "live" = recorded by the app; "imported" = rebuilt from web-server logs
    # written before this log existed (who signed in is unknown for those).
    source = db.Column(db.String(20), nullable=False, default="live")

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "event": self.event,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "user_email": self.user_email,
            "user_role": self.user_role,
            "action": self.action,
            "area": self.area,
            "method": self.method,
            "path": self.path,
            "status_code": self.status_code,
            "detail": self.detail,
            "ip_address": self.ip_address,
            "location": self.location,
            "user_agent": self.user_agent,
            "device": self.device,
            "source": self.source,
        }


class SpecialExamRequest(db.Model):
    """A student's request to sit a special exam for one they missed.

    Name, batch and ID number are what the student typed, kept as written
    so the record and the Excel export still read correctly if the profile
    changes later. The Administration Team approves or declines it."""
    __tablename__ = "special_exam_requests"

    STATUSES = ("pending", "approved", "declined")
    SHIFTS = (1, 2)

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    full_name = db.Column(db.String(200), nullable=False)
    batch = db.Column(db.String(50), nullable=False)
    course_name = db.Column(db.String(255), nullable=False)
    reason = db.Column(db.Text, nullable=False)
    exam_date = db.Column(db.Date, nullable=False)
    shift = db.Column(db.Integer, nullable=False)
    phone = db.Column(db.String(30), nullable=False)
    id_number = db.Column(db.String(50), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    decision_note = db.Column(db.String(1000), nullable=True)
    decided_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)

    student = db.relationship("User", foreign_keys=[student_id])
    decided_by = db.relationship("User", foreign_keys=[decided_by_id])

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "student_email": self.student.email if self.student else None,
            "full_name": self.full_name,
            "batch": self.batch,
            "course_name": self.course_name,
            "reason": self.reason,
            "exam_date": self.exam_date.isoformat(),
            "shift": self.shift,
            "phone": self.phone,
            "id_number": self.id_number,
            "status": self.status,
            "decision_note": self.decision_note,
            "decided_by_name": self.decided_by.name if self.decided_by else None,
            "decided_at": self.decided_at.isoformat() if self.decided_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
