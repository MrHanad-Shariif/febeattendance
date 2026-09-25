"""The signed-in user's own notifications. Rows are only ever created for
recipients who were allowed to see the record, and each user can only read
their own rows, so no extra filtering is needed here."""
from flask import jsonify, request
from sqlalchemy import func

from app.extensions import db
from app.models import Notification, utcnow
from app.notifications import notifications_bp
from app.utils.authz import current_user, roles_required
from app.utils.validation import clean_int

STAFF_ROLES = ("admin", "lecturer")


@notifications_bp.get("/notifications")
@roles_required(*STAFF_ROLES)
def list_notifications():
    user = current_user()
    query = Notification.query.filter_by(user_id=user.id)
    if request.args.get("unread") == "1":
        query = query.filter(Notification.read_at.is_(None))
    if request.args.get("type"):
        query = query.filter(Notification.type == request.args["type"])
    limit = clean_int(request.args.get("limit"), "limit", minimum=1, maximum=500, default=100)
    rows = query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()
    return jsonify([n.to_dict() for n in rows])


@notifications_bp.get("/notifications/summary")
@roles_required(*STAFF_ROLES)
def notification_summary():
    user = current_user()
    counts = dict(
        db.session.query(Notification.type, func.count(Notification.id))
        .filter(Notification.user_id == user.id, Notification.read_at.is_(None))
        .group_by(Notification.type)
        .all()
    )
    by_type = {t: counts.get(t, 0) for t in Notification.TYPES}
    return jsonify({"total": sum(by_type.values()), **by_type})


@notifications_bp.post("/notifications/read")
@roles_required(*STAFF_ROLES)
def mark_read():
    """Body: {"ids": [...]} to mark some, or {"all": true} (optionally with "type")."""
    user = current_user()
    data = request.get_json(silent=True) or {}
    query = Notification.query.filter(Notification.user_id == user.id, Notification.read_at.is_(None))
    if data.get("all") is True:
        if data.get("type") in Notification.TYPES:
            query = query.filter(Notification.type == data["type"])
    else:
        ids = [i for i in (data.get("ids") or []) if isinstance(i, int) and not isinstance(i, bool)]
        query = query.filter(Notification.id.in_(ids or [-1]))
    updated = query.update({Notification.read_at: utcnow()}, synchronize_session=False)
    db.session.commit()
    return jsonify({"updated": updated})
