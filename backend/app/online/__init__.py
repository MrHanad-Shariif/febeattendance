from flask import Blueprint

online_bp = Blueprint("online", __name__, url_prefix="/api")

from app.online import routes  # noqa: E402,F401
