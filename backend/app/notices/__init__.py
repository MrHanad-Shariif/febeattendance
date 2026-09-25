from flask import Blueprint

notices_bp = Blueprint("notices", __name__, url_prefix="/api")

from app.notices import routes  # noqa: E402,F401
