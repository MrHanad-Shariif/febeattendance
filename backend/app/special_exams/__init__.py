from flask import Blueprint

special_exams_bp = Blueprint("special_exams", __name__, url_prefix="/api")

from app.special_exams import routes  # noqa: E402,F401
