from flask import Blueprint

leave_bp = Blueprint("leave_requests", __name__, url_prefix="/api")

from app.leave_requests import routes  # noqa: E402,F401
