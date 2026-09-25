from flask import Blueprint

meetings_bp = Blueprint("meetings", __name__, url_prefix="/api")

from app.meetings import routes  # noqa: E402,F401
