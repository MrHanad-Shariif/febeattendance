from datetime import datetime, timedelta

import bcrypt
from flask import request, jsonify
from flask_limiter.util import get_remote_address

from app.auth import auth_bp
from app.extensions import db, limiter
from app.models import User, PasswordResetToken, Timetable
from app.utils.authz import current_user, issue_token, roles_required
from app.utils.constants import DEPARTMENTS
from app.utils.email import send_password_reset_email, send_verification_email
from app.utils.checkin_session import load_enroll_token, make_enroll_token
from app.utils.face_enrollment import enroll_student_face
from app.utils.validation import ValidationError, check_password, clean_email, clean_text

# Compared against when the email is unknown, so "no such user" takes as long
# as "wrong password" and response time can't be used to enumerate accounts.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt())


def _email_key():
    """Rate-limit bucket per target email (falls back to client IP)."""
    email = (request.get_json(silent=True) or {}).get("email")
    return f"email:{email.strip().lower()}" if isinstance(email, str) and email.strip() else get_remote_address()


def _send_email_verification(user) -> PasswordResetToken:
    token = PasswordResetToken(
        user_id=user.id,
        purpose="verify_email",
        expires_at=datetime.now() + timedelta(hours=48),
    )
    db.session.add(token)
    db.session.commit()
    send_verification_email(user, token.token)
    return token


def _find_token(token, purposes) -> PasswordResetToken | None:
    if not isinstance(token, str) or not token:
        return None
    row = PasswordResetToken.query.filter_by(token=token).first()
    if not row or row.purpose not in purposes or not row.is_valid():
        return None
    return row


@auth_bp.post("/login")
@limiter.limit("30/minute")
@limiter.limit("8/15 minutes", key_func=_email_key)
def login():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    password = data.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        return jsonify({"error": "Email and password are required"}), 400
    email = email.strip().lower()

    user = User.query.filter_by(email=email).first()
    if user:
        valid = user.check_password(password)
    else:
        bcrypt.checkpw(password.encode("utf-8")[:72], _DUMMY_HASH)
        valid = False
    if not valid:
        return jsonify({"error": "Invalid email or password"}), 401

    if user.status == "pending_verification":
        return jsonify({"error": "Please confirm your email address first -- check your inbox for the verification link."}), 403
    if user.status == "invited":
        return jsonify({"error": "Your account hasn't been activated yet -- check your email for the activation link."}), 403
    if user.status != "active":
        return jsonify({"error": "This account is disabled. Contact the faculty office."}), 403

    return jsonify({"access_token": issue_token(user), "user": user.to_dict()})


@auth_bp.get("/batches")
def list_batches():
    """Public: distinct batch codes from the timetable, for the student
    signup form's dropdown."""
    rows = Timetable.query.with_entities(Timetable.batch).filter(Timetable.batch.isnot(None)).distinct().all()
    return jsonify(sorted({r[0] for r in rows if r[0]}))


@auth_bp.get("/departments")
def list_departments_public():
    """Public: the faculty's fixed department list, for the student signup form."""
    return jsonify(DEPARTMENTS)


@auth_bp.post("/register-student")
@limiter.limit("10/hour")
def register_student():
    """Public self-registration. The account can't log in until the email
    address is confirmed (see /verify-email) -- after that it's active
    immediately, no admin approval needed. Admin can still disable a wrong/
    fake one afterward from Admin > Students.

    If the ID number matches a record already imported from the official
    roster (see app/importers/import_students.py), this "claims" that existing
    record instead of creating a duplicate: the student's chosen email/password
    are attached to it. This lets a student use a personal email if they can't
    access their official one yet. (See SECURITY.md: claiming is authenticated
    only by knowing the ID number.)

    The response carries a short-lived enroll_token for /enroll-face, so the
    student can register their face straight away, before confirming email.
    """
    form = request.get_json(silent=True) if request.is_json else request.form
    form = form or {}
    name = clean_text(form.get("name"), "Full name", max_len=200, required=True)
    email = clean_email(form.get("email"))
    password = check_password(form.get("password"))
    student_id_number = clean_text(form.get("student_id_number"), "Student ID number", max_len=50, required=True)
    batch = clean_text(form.get("batch"), "Batch", max_len=50, required=True)
    department = clean_text(form.get("department"), "Department", max_len=150)

    if department and department not in DEPARTMENTS:
        raise ValidationError("Please select a valid department")
    if str(form.get("face_consent")).lower() not in ("true", "1", "on", "yes"):
        raise ValidationError("Please agree to the use of your face for attendance verification")

    existing = User.query.filter_by(student_id_number=student_id_number, role="student").first()

    known_batches = {r[0] for r in Timetable.query.with_entities(Timetable.batch).distinct().all() if r[0]}
    if batch not in known_batches and not (existing and existing.batch == batch):
        raise ValidationError("Please select a valid batch")

    if existing and existing.status not in ("invited", "pending_verification"):
        return jsonify({"error": "This student ID is already registered. Try signing in, or use 'Forgot your password?'."}), 409

    email_owner = User.query.filter_by(email=email).first()
    if email_owner and (not existing or email_owner.id != existing.id):
        return jsonify({"error": "A user with that email already exists"}), 409

    if existing:
        # Claim the pre-imported record rather than creating a duplicate.
        existing.name = name
        existing.email = email
        existing.department = department or existing.department
        existing.batch = batch
        existing.status = "pending_verification"
        existing.set_password(password)
        if existing.face is not None:
            # Unconfirmed account being registered again: the new registrant enrolls afresh.
            db.session.delete(existing.face)
        user = existing
    else:
        user = User(
            name=name, email=email, role="student", status="pending_verification",
            student_id_number=student_id_number, department=department, batch=batch,
        )
        user.set_password(password)
        db.session.add(user)

    db.session.flush()
    _send_email_verification(user)

    return jsonify({
        "message": "Account created. Next, register your face.",
        "enroll_token": make_enroll_token(user.id),
    }), 201


@auth_bp.post("/enroll-face")
@limiter.limit("10/hour", key_func=lambda: f"enroll:{str(request.form.get('enroll_token'))[-32:]}")
def enroll_face_after_signup():
    """Face registration straight after sign-up, authorised by the
    enroll_token from /register-student (the student can't sign in until they
    confirm their email). Signed-in students use /student/face instead."""
    user = User.query.get(load_enroll_token(request.form.get("enroll_token")))
    if not user or user.role != "student" or user.status not in ("pending_verification", "active"):
        raise ValidationError("Face registration timed out. Sign in after confirming your email and you'll be asked to register your face.")
    enroll_student_face(user)
    return jsonify({"message": "Face registered. Check your email for a link to confirm your address."}), 201


@auth_bp.get("/verify-email/<token>")
@limiter.limit("20/minute")
def verify_email(token):
    """Students only -- lecturer accounts are admin-invited, not self-registered."""
    verify_token = _find_token(token, ("verify_email",))
    if not verify_token:
        return jsonify({"error": "This link is invalid or has expired"}), 400

    user = verify_token.user
    if user.status == "disabled":
        return jsonify({"error": "This account is disabled. Contact the faculty office."}), 403

    verify_token.used_at = datetime.now()
    user.status = "active"
    db.session.commit()
    return jsonify({"message": "Email confirmed!", "access_token": issue_token(user), "user": user.to_dict()})


@auth_bp.post("/resend-verification")
@limiter.limit("5/hour", key_func=_email_key)
def resend_verification():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    if isinstance(email, str):
        user = User.query.filter_by(email=email.strip().lower(), status="pending_verification").first()
        if user:
            _send_email_verification(user)
    # Always return 200 so we don't reveal whether an email is registered.
    return jsonify({"message": "If that email needs verifying, a new link has been sent."})


@auth_bp.get("/me")
@roles_required()
def me():
    return jsonify(current_user().to_dict())


@auth_bp.post("/change-password")
@roles_required()
@limiter.limit("10/hour", key_func=lambda: f"user:{current_user().id}")
def change_password():
    user = current_user()
    data = request.get_json(silent=True) or {}
    old_password = data.get("old_password")
    new_password = check_password(data.get("new_password"))

    if not isinstance(old_password, str) or not user.check_password(old_password):
        return jsonify({"error": "Current password is incorrect"}), 400

    user.set_password(new_password)
    db.session.commit()
    # The old token is now invalid (its password fingerprint changed); hand back a fresh one.
    return jsonify({"message": "Password updated", "access_token": issue_token(user)})


@auth_bp.post("/forgot-password")
@limiter.limit("5/hour", key_func=_email_key)
@limiter.limit("20/hour")
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    user = User.query.filter_by(email=email.strip().lower(), status="active").first() if isinstance(email, str) else None

    if user:
        reset_token = PasswordResetToken(
            user_id=user.id,
            purpose="reset",
            expires_at=datetime.now() + timedelta(hours=1),
        )
        db.session.add(reset_token)
        db.session.commit()
        send_password_reset_email(user, reset_token.token)

    # Always return 200 so we don't reveal whether an email is registered.
    return jsonify({"message": "If that email is registered, a reset link has been sent."})


@auth_bp.get("/invite/<token>")
@limiter.limit("20/minute")
def get_invite(token):
    invite_token = _find_token(token, ("invite",))
    if not invite_token or invite_token.user.status == "disabled":
        return jsonify({"error": "This link is invalid or has expired"}), 400
    return jsonify({"name": invite_token.user.name, "email": invite_token.user.email, "purpose": invite_token.purpose})


@auth_bp.post("/activate")
@limiter.limit("10/minute")
def activate():
    """Set the first password for an admin-invited account. Only *invite*
    tokens are accepted: reset and email-verification tokens must not be able
    to (re)activate an account, e.g. one an admin has since disabled."""
    data = request.get_json(silent=True) or {}
    invite_token = _find_token(data.get("token"), ("invite",))
    password = check_password(data.get("password"))

    if not invite_token or invite_token.user.status == "disabled":
        return jsonify({"error": "This link is invalid or has expired"}), 400

    user = invite_token.user
    user.set_password(password)
    user.status = "active"
    invite_token.used_at = datetime.now()
    db.session.commit()

    return jsonify({"message": "Account activated", "access_token": issue_token(user), "user": user.to_dict()})


@auth_bp.post("/reset-password")
@limiter.limit("10/minute")
def reset_password():
    data = request.get_json(silent=True) or {}
    reset_token = _find_token(data.get("token"), ("reset",))
    password = check_password(data.get("password"))

    if not reset_token or reset_token.user.status != "active":
        return jsonify({"error": "This link is invalid or has expired"}), 400

    user = reset_token.user
    user.set_password(password)
    reset_token.used_at = datetime.now()
    db.session.commit()

    return jsonify({"message": "Password has been reset. You can now log in."})
