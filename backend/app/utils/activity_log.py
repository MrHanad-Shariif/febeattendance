"""System log (Authentication > System logs): who signed in, from where, on
what device, and what they did while signed in.

* Sign-ins, failed sign-ins and sign-outs are recorded by the auth routes via
  ``record_login`` / ``record_failed_login`` / ``record_logout``.
* Every change a signed-in user makes (any POST/PUT/PATCH/DELETE) and every
  document download is recorded automatically by an ``after_request`` hook,
  labelled from ``ACTIONS`` below. Plain page loads (GETs) are not logged.

Rows are written on their own database connection, so logging works even when
the request's own transaction failed, and a logging failure never breaks the
request.
"""
import re
import uuid
from datetime import datetime

from flask import current_app, g, has_request_context, request

from app.extensions import db
from app.models import ActivityLog
from app.utils.device import describe_device
from app.utils.geoip import locate

# endpoint -> (area, what the user did). ``None`` means "don't log": routine
# background calls and the intermediate steps of the student check-in flow
# (its final step is logged).
ACTIONS = {
    # Account
    "auth.change_password": ("Account", "Changed their password"),
    "auth.reset_password": ("Account", "Reset their password (email link)"),
    # Before sign-in: nobody to attribute them to.
    "auth.register_student": None,
    "auth.enroll_face_after_signup": None,
    "auth.forgot_password": None,
    "auth.resend_verification": None,
    "student.enroll_my_face": ("Account", "Registered their face"),
    "notifications.mark_read": None,

    # Lecturers & timetable
    "admin.create_lecturer": ("Lecturers", "Invited a lecturer"),
    "admin.update_lecturer": ("Lecturers", "Edited a lecturer"),
    "admin.delete_lecturer": ("Lecturers", "Deleted a lecturer"),
    "admin.resend_lecturer_invite": ("Lecturers", "Resent a lecturer's invite"),
    "admin.update_attendance_remarks": ("Lecturer attendance", "Changed a lecturer attendance remark"),
    "admin.export_attendance": ("Reports", "Exported lecturer attendance"),
    "admin.create_timetable_entry": ("Timetable", "Added a timetable entry"),
    "admin.update_timetable_entry": ("Timetable", "Edited a timetable entry"),
    "admin.delete_timetable_entry": ("Timetable", "Deleted a timetable entry"),
    "admin.create_course": ("Timetable", "Added a course"),
    "admin.update_course": ("Timetable", "Edited a course"),
    "admin.delete_course": ("Timetable", "Deleted a course"),
    "admin.update_settings": ("Settings", "Changed system settings"),

    # Students
    "admin.update_student": ("Students", "Edited a student"),
    "admin.delete_student": ("Students", "Deleted a student"),
    "admin.reset_student_face": ("Students", "Reset a student's registered face"),
    "admin.update_student_attendance": ("Student attendance", "Corrected a student's attendance"),
    "lecturer.update_my_student_attendance": ("Student attendance", "Corrected a student's attendance"),

    # Check-in
    "attendance.checkin": ("Check-in", "Checked in (lecturer)"),
    "attendance.checkout": ("Check-in", "Checked out (lecturer)"),
    "lecturer.start_board_session": ("Check-in", "Started board-code check-in"),
    "lecturer.board_session_new_code": ("Check-in", "Changed the board code"),
    "lecturer.board_session_close": ("Check-in", "Closed board-code check-in"),
    "student.checkin_start": None,
    "student.checkin_code": None,
    "student.checkin_location": None,
    "student.checkin_complete": ("Check-in", "Checked in to class (QR)"),
    "student.checkin_board": ("Check-in", "Checked in to class (board code)"),

    # Users & roles
    "access.create_user": ("Users", "Invited a staff account"),
    "access.update_user": ("Users", "Changed a staff account"),
    "access.delete_user": ("Users", "Deleted a staff account"),
    "access.resend_user_invite": ("Users", "Resent a staff invite"),
    "access.create_role": ("Roles", "Created a role"),
    "access.update_role": ("Roles", "Edited a role"),
    "access.delete_role": ("Roles", "Deleted a role"),

    # Committees
    "committees.grant_faculty_role": ("Faculty roles", "Granted a faculty role"),
    "committees.revoke_faculty_role": ("Faculty roles", "Revoked a faculty role"),
    "committees.create_committee": ("Committees", "Created a committee"),
    "committees.update_committee": ("Committees", "Edited a committee"),
    "committees.delete_committee": ("Committees", "Deleted a committee"),
    "committees.add_member": ("Committees", "Added a committee member"),
    "committees.remove_member": ("Committees", "Removed a committee member"),
    "committees.create_task": ("Tasks", "Assigned a task"),
    "committees.update_task": ("Tasks", "Edited a task"),
    "committees.set_task_progress": ("Tasks", "Updated task progress"),
    "committees.complete_task": ("Tasks", "Completed a task"),
    "committees.upload_task_attachment": ("Tasks", "Uploaded a task attachment"),
    "committees.download_task_report": ("Tasks", "Downloaded a task report"),
    "committees.download_task_attachment": ("Tasks", "Downloaded a task attachment"),
    "meetings.schedule_meeting": ("Meetings", "Scheduled a meeting"),
    "meetings.update_meeting": ("Meetings", "Edited a meeting"),
    "meetings.publish_minutes": ("Meetings", "Published meeting minutes"),
    "meetings.download_agenda": ("Meetings", "Downloaded a meeting agenda"),
    "meetings.download_minutes": ("Meetings", "Downloaded meeting minutes"),
    "notices.publish_notice": ("Information", "Published a notice"),
    "notices.delete_notice": ("Information", "Deleted a notice"),
    "notices.download_notice": ("Information", "Downloaded a notice"),
    "archive.create_memo": ("Archive", "Created a memo"),
    "archive.upload_archive_document": ("Archive", "Uploaded an archive document"),
    "archive.delete_archive_document": ("Archive", "Deleted an archive document"),
    "archive.download_archive_document": ("Archive", "Downloaded an archive document"),

    # Assignments
    "assignments.create_assignment": ("Assignments", "Created an assignment"),
    "assignments.update_assignment": ("Assignments", "Edited an assignment"),
    "assignments.delete_assignment": ("Assignments", "Deleted an assignment"),
    "assignments.grant_extension": ("Assignments", "Granted an extension"),
    "assignments.revoke_extension": ("Assignments", "Revoked an extension"),
    "assignments.comment_on_submission": ("Assignments", "Commented on a submission"),
    "assignments.submit": ("Assignments", "Submitted an assignment"),
    "assignments.remove_submission_file": ("Assignments", "Removed a submitted file"),
    "assignments.download_brief": ("Assignments", "Downloaded an assignment brief"),
    "assignments.download_submission_file": ("Assignments", "Downloaded a submitted file"),
}

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# Routes the auth code logs itself (with more detail), or that happen before
# anyone is signed in.
_SELF_LOGGED = {"auth.login", "auth.logout", "auth.activate", "auth.verify_email"}


def describe(endpoint: str | None, method: str) -> tuple[str, str] | None:
    """(area, label) for a request, or None when it shouldn't be logged."""
    if endpoint in ACTIONS:
        return ACTIONS[endpoint]
    if method not in MUTATING or not endpoint:
        return None
    # A route added later without a label: derive one from its function name.
    blueprint, _, func = endpoint.partition(".")
    return blueprint.replace("_", " ").title(), func.replace("_", " ").capitalize()


def _target(view_args: dict | None) -> str | None:
    """"committee 4, user 12" from the URL's ids."""
    if not view_args:
        return None
    parts = [f"{re.sub(r'_id$', '', k).replace('_', ' ')} {v}" for k, v in view_args.items() if k != "filename"]
    return ", ".join(parts) or None


def new_session_id() -> str:
    return uuid.uuid4().hex


def write(event: str, *, user=None, email=None, session_id=None, action=None, area=None, detail=None,
          method=None, path=None, status_code=None, ip=None, user_agent=None, created_at=None,
          source="live", location=None):
    """Insert one row. Never raises."""
    try:
        if has_request_context():
            ip = ip if ip is not None else request.remote_addr
            user_agent = user_agent if user_agent is not None else request.headers.get("User-Agent")
        row = {
            "created_at": created_at or datetime.now(),
            "event": event,
            "session_id": session_id,
            "user_id": user.id if user is not None else None,
            "user_name": user.name if user is not None else None,
            "user_email": (user.email if user is not None else email),
            "user_role": user.role if user is not None else None,
            "action": action,
            "area": area,
            "method": method,
            "path": (path or "")[:500] or None,
            "status_code": status_code,
            "detail": (detail or "")[:500] or None,
            "ip_address": ip,
            "location": location if location is not None else locate(ip),
            "user_agent": (user_agent or "")[:500] or None,
            "device": describe_device(user_agent),
            "source": source,
        }
        with db.engine.begin() as conn:
            conn.execute(ActivityLog.__table__.insert().values(**row))
    except Exception:  # noqa: BLE001 -- the log must never break the app
        current_app.logger.exception("Could not write activity log row (%s)", event)


def record_login(user, session_id: str, detail: str = "Signed in"):
    write("login", user=user, session_id=session_id, action=detail, area="Account",
          method=request.method, path=request.path, status_code=200)


def record_failed_login(email: str | None, user=None, reason: str = "Wrong email or password", status_code=401):
    write("login_failed", user=user, email=(email or "")[:255] or None, action="Failed sign-in", area="Account",
          detail=reason, method=request.method, path=request.path, status_code=status_code)


def record_logout(user, session_id: str | None):
    write("logout", user=user, session_id=session_id, action="Signed out", area="Account",
          method=request.method, path=request.path, status_code=200)


def current_session_id() -> str | None:
    try:
        from flask_jwt_extended import get_jwt

        return get_jwt().get("sid")
    except Exception:  # noqa: BLE001 -- no token on this request
        return None


def init_activity_log(app):
    @app.after_request
    def log_activity(response):
        user = g.get("current_user")
        if user is None or request.method == "OPTIONS" or request.endpoint in _SELF_LOGGED:
            return response
        described = describe(request.endpoint, request.method)
        if described is None:
            return response
        area, label = described
        write("action", user=user, session_id=current_session_id(), action=label, area=area,
              detail=_target(request.view_args), method=request.method, path=request.path,
              status_code=response.status_code)
        return response
