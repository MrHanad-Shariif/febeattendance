from flask import current_app
from flask_mail import Message
from markupsafe import escape

from app.extensions import mail
from app.utils.settings import get_setting_str


def _send(subject: str, recipient: str, html: str):
    if not current_app.config.get("MAIL_USERNAME"):
        current_app.logger.warning("MAIL_USERNAME not configured; skipping email to %s: %s", recipient, subject)
        return
    msg = Message(subject=subject, recipients=[recipient], html=html)
    mail.send(msg)


def send_invite_email(user, token: str):
    site_name = get_setting_str("site_name")
    link = f"{current_app.config['FRONTEND_BASE_URL']}/activate?token={token}"
    html = f"""
        <p>Hello {escape(user.name)},</p>
        <p>An account has been created for you on the {escape(site_name)} system.</p>
        <p>Click the link below to set your password and activate your account:</p>
        <p><a href="{escape(link)}">{escape(link)}</a></p>
        <p>This link expires in 48 hours.</p>
    """
    _send("Activate your lecturer attendance account", user.email, html)


def send_verification_email(user, token: str):
    site_name = get_setting_str("site_name")
    link = f"{current_app.config['FRONTEND_BASE_URL']}/verify-email?token={token}"
    html = f"""
        <p>Hello {escape(user.name)},</p>
        <p>Thanks for signing up on the {escape(site_name)} system. Please confirm this is your email address:</p>
        <p><a href="{escape(link)}">{escape(link)}</a></p>
        <p>This link expires in 48 hours. If you didn't create this account, you can ignore this email.</p>
    """
    _send("Confirm your email address", user.email, html)


def send_password_reset_email(user, token: str):
    link = f"{current_app.config['FRONTEND_BASE_URL']}/reset-password?token={token}"
    html = f"""
        <p>Hello {escape(user.name)},</p>
        <p>We received a request to reset your password.</p>
        <p><a href="{escape(link)}">{escape(link)}</a></p>
        <p>If you did not request this, you can ignore this email. This link expires in 1 hour.</p>
    """
    _send("Reset your password", user.email, html)


def send_checkin_reminder_email(user, course_name: str, minutes_before: int):
    html = f"""
        <p>Hello {escape(user.name)},</p>
        <p>Reminder: your class <strong>{escape(course_name)}</strong> starts in about {minutes_before} minutes.
        Please scan the check-in QR code when you arrive on campus.</p>
    """
    _send("Class starting soon - reminder to check in", user.email, html)
