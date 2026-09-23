from flask import Blueprint

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

from app.admin import routes  # noqa: E402,F401
