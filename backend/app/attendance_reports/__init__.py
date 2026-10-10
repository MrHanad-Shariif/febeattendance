from flask import Blueprint

attendance_reports_bp = Blueprint("attendance_reports", __name__, url_prefix="/api/admin/attendance-reports")

from app.attendance_reports import routes  # noqa: E402,F401
