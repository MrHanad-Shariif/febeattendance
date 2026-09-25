"""Information Sharing: faculty notices (brief items 28 and 43). Published
meeting minutes also appear here automatically (category meeting_minutes)."""
from flask import jsonify, request

from app.extensions import db
from app.models import Committee, InformationPost, utcnow
from app.notices import notices_bp
from app.utils.audiences import audience_users
from app.utils.authz import current_user, roles_required
from app.utils.notify import notify, subject_for
from app.utils.permissions import can_share_information, can_view_notice, is_admin, require
from app.utils.uploads import delete_document, save_document, send_document
from app.utils.validation import ValidationError, clean_choice, clean_int, clean_text, parse_iso_date

STAFF_ROLES = ("admin", "lecturer")


@notices_bp.get("/notices")
@roles_required(*STAFF_ROLES)
def list_notices():
    user = current_user()
    args = request.args
    query = InformationPost.query
    if args.get("category"):
        query = query.filter(InformationPost.category == args["category"])
    if args.get("from"):
        query = query.filter(InformationPost.published_at >= parse_iso_date(args["from"], "from"))
    if args.get("to"):
        query = query.filter(db.func.date(InformationPost.published_at) <= parse_iso_date(args["to"], "to"))
    rows = [p for p in query.order_by(InformationPost.published_at.desc()).all() if can_view_notice(user, p)]
    if args.get("q"):
        needle = args["q"].strip().lower()[:100]
        rows = [p for p in rows if needle in f"{p.title} {p.description or ''}".lower()]
    return jsonify([p.to_dict() for p in rows])


@notices_bp.get("/notices/<int:post_id>")
@roles_required(*STAFF_ROLES)
def get_notice(post_id):
    user = current_user()
    post = InformationPost.query.get_or_404(post_id)
    require(can_view_notice(user, post))
    data = post.to_dict()
    data["can_delete"] = is_admin(user) or post.published_by_id == user.id
    return jsonify(data)


@notices_bp.post("/notices")
@roles_required(*STAFF_ROLES)
def publish_notice():
    user = current_user()
    require(can_share_information(user), "Only authorised administrators can publish faculty information.")
    data = request.form if (request.files or request.form) else (request.get_json(silent=True) or {})
    title = clean_text(data.get("title"), "Title", max_len=255, required=True)
    category = clean_choice(data.get("category"), "Category",
                            [c for c in InformationPost.CATEGORIES if c != "meeting_minutes"], default="announcement")
    audience = clean_choice(data.get("audience"), "Audience", InformationPost.AUDIENCES, default="all_staff")
    committee = None
    if audience == "committee":
        committee = Committee.query.get_or_404(clean_int(data.get("committee_id"), "Committee", minimum=1) or 0)
    saved = save_document(request.files.get("file"), "notices")
    now = utcnow()
    post = InformationPost(
        title=title,
        description=clean_text(data.get("description"), "Description", max_len=20000),
        category=category, audience=audience, committee=committee,
        file_name=saved[0] if saved else None, file_path=saved[1] if saved else None,
        published_by_id=user.id, published_at=now,
    )
    db.session.add(post)
    db.session.flush()
    notify(
        audience_users(audience, committee),
        type="notice",
        title=f"New faculty notice: {title}",
        message=(post.description or "")[:300] or None,
        link=f"/information/{post.id}",
        related_id=post.id,
        email_subject=subject_for("information", title),
        email_lines=[title, post.description or "", "A document is attached in the system." if saved else ""],
        exclude=user,
    )
    db.session.commit()
    return jsonify(post.to_dict()), 201


@notices_bp.delete("/notices/<int:post_id>")
@roles_required(*STAFF_ROLES)
def delete_notice(post_id):
    user = current_user()
    post = InformationPost.query.get_or_404(post_id)
    require(is_admin(user) or (post.published_by_id == user.id and can_share_information(user)))
    if post.minutes_id:
        raise ValidationError("This notice belongs to published minutes, which are a permanent record.", status=409)
    delete_document(post.file_path)
    db.session.delete(post)
    db.session.commit()
    return jsonify({"message": "Notice removed"})


@notices_bp.get("/notices/<int:post_id>/document")
@roles_required(*STAFF_ROLES)
def download_notice(post_id):
    user = current_user()
    post = InformationPost.query.get_or_404(post_id)
    require(can_view_notice(user, post))
    if post.minutes_id and post.minutes:
        return send_document(post.minutes.file_path, post.minutes.file_name, inline=request.args.get("inline") == "1")
    if not post.file_path:
        return jsonify({"error": "Not found"}), 404
    return send_document(post.file_path, post.file_name, inline=request.args.get("inline") == "1")
