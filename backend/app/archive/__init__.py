from flask import Blueprint

archive_bp = Blueprint("archive", __name__, url_prefix="/api")

from app.archive import routes  # noqa: E402,F401
