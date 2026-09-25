from flask import Blueprint

committees_bp = Blueprint("committees", __name__, url_prefix="/api")

from app.committees import routes  # noqa: E402,F401
