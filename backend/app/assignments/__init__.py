from flask import Blueprint

assignments_bp = Blueprint("assignments", __name__, url_prefix="/api")

from app.assignments import routes  # noqa: E402,F401
