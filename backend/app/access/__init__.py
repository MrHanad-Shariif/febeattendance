from flask import Blueprint

access_bp = Blueprint("access", __name__, url_prefix="/api/access")

from app.access import routes  # noqa: E402,F401
