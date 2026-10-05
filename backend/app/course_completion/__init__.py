from flask import Blueprint

course_completion_bp = Blueprint("course_completion", __name__, url_prefix="/api")

from app.course_completion import routes  # noqa: E402,F401
