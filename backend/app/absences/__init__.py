from flask import Blueprint

absences_bp = Blueprint("absences", __name__, url_prefix="/api/admin")

from app.absences import routes  # noqa: E402,F401
