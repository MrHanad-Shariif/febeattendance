from datetime import datetime, timedelta

from app.extensions import db
from app.models import User, PasswordResetToken
from app.utils.email import send_invite_email


def create_invited_user(name: str, email: str, role: str) -> User:
    user = User(name=name.strip(), email=email.strip().lower(), role=role, status="invited")
    db.session.add(user)
    db.session.flush()

    token = PasswordResetToken(
        user_id=user.id,
        purpose="invite",
        expires_at=datetime.now() + timedelta(hours=48),
    )
    db.session.add(token)
    db.session.commit()

    send_invite_email(user, token.token)
    return user


def resend_invite(user: User) -> PasswordResetToken:
    token = PasswordResetToken(
        user_id=user.id,
        purpose="invite",
        expires_at=datetime.now() + timedelta(hours=48),
    )
    db.session.add(token)
    db.session.commit()
    send_invite_email(user, token.token)
    return token
