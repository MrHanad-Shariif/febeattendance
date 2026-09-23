from flask import Blueprint

student_bp = Blueprint("student", __name__, url_prefix="/api/student")

from app.student import routes  # noqa: E402,F401
