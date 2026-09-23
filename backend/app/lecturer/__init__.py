from flask import Blueprint

lecturer_bp = Blueprint("lecturer", __name__, url_prefix="/api/me")

from app.lecturer import routes  # noqa: E402,F401
