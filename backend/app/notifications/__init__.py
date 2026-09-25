from flask import Blueprint

notifications_bp = Blueprint("notifications", __name__, url_prefix="/api")

from app.notifications import routes  # noqa: E402,F401
