"""Authentication helpers.

Every protected route goes through ``roles_required``. Unlike a bare
``@jwt_required``, it re-checks the user against the database on each request,
so a disabled/deleted account or a demoted admin loses access immediately
instead of keeping a valid token until it expires.

Tokens also carry a short fingerprint of the user's password hash (claim
``pv``). Changing or resetting the password changes the fingerprint, which
invalidates every token issued before the change -- no extra table needed.
"""
import hashlib
from functools import wraps

from flask import g, jsonify
from flask_jwt_extended import create_access_token, get_jwt, get_jwt_identity, verify_jwt_in_request

from app.models import User


def password_fingerprint(user: User) -> str:
    return hashlib.sha256((user.password_hash or "").encode("utf-8")).hexdigest()[:16]


def issue_token(user: User) -> str:
    return create_access_token(
        identity=str(user.id),
        additional_claims={"role": user.role, "name": user.name, "pv": password_fingerprint(user)},
    )


def _unauthorized(message: str = "Your session has expired. Please sign in again."):
    return jsonify({"error": message}), 401


def roles_required(*roles):
    """Require a valid token belonging to an *active* user, optionally with one
    of ``roles``. With no roles given it means "any signed-in user"."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            claims = get_jwt()

            try:
                user = User.query.get(int(get_jwt_identity()))
            except (TypeError, ValueError):
                return _unauthorized()

            if (
                not user
                or user.status != "active"
                or claims.get("role") != user.role
                or claims.get("pv") != password_fingerprint(user)
            ):
                return _unauthorized()

            if roles and user.role not in roles:
                return jsonify({"error": "Forbidden"}), 403

            g.current_user = user
            return fn(*args, **kwargs)

        return wrapper

    return decorator


STAFF_ROLES = ("admin", "lecturer")


def permission_required(*codes):
    """Require an active staff account holding at least one of ``codes``
    (fine-grained RBAC, see utils/rbac.py). Like roles_required, it re-reads
    the user's roles from the database on every request."""
    from app.utils.rbac import has_any_permission

    def decorator(fn):
        @wraps(fn)
        def check(*args, **kwargs):
            if not has_any_permission(g.current_user, codes):
                return jsonify({"error": "You do not have permission to do that."}), 403
            return fn(*args, **kwargs)

        return roles_required(*STAFF_ROLES)(check)

    return decorator


def current_user() -> User | None:
    user = g.get("current_user")
    if user is not None:
        return user
    user_id = get_jwt_identity()
    return User.query.get(int(user_id)) if user_id else None
