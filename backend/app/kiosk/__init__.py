from flask import Blueprint

kiosk_bp = Blueprint("kiosk", __name__, url_prefix="/api/kiosk")

from app.kiosk import routes  # noqa: E402,F401
