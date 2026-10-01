from datetime import datetime

from flask import current_app
from flask_mail import Message
from markupsafe import escape

from app.extensions import mail
from app.utils.settings import get_all_settings, get_setting_str

# What the admin can switch on and off under Settings > Email. "account"
# (invites, confirmations, password resets) ignores sending hours: a reset
# link that only arrives the next morning is useless.
KIND_SETTINGS = {
    "notification": "email_notifications",
    "reminder": "email_checkin_reminders",
    "account": "email_account_messages",
}
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def within_send_hours(settings: dict, now: datetime | None = None) -> bool:
    now = now or datetime.now()
    days = {d.strip() for d in get_setting_str("email_send_days", settings).split(",") if d.strip()}
    if WEEKDAYS[now.weekday()] not in days:
        return False
    start = get_setting_str("email_send_from", settings).strip()
    end = get_setting_str("email_send_until", settings).strip()
    if not start and not end:
        return True
    current = now.strftime("%H:%M")
    start = start or "00:00"
    end = end or "24:00"
    if start <= end:
        return start <= current < end
    return current >= start or current < end  # overnight window, e.g. 20:00-06:00


def email_kind_enabled(kind: str, settings: dict) -> bool:
    """Whether this kind of email is wanted at all (ignoring sending hours)."""
    return (get_setting_str("email_mode", settings) == "on"
            and get_setting_str(KIND_SETTINGS[kind], settings) == "on")


def email_allowed(kind: str, settings: dict | None = None, now: datetime | None = None) -> bool:
    """Whether an email of this kind may go out right now."""
    settings = settings if settings is not None else get_all_settings()
    if not email_kind_enabled(kind, settings):
        return False
    return kind == "account" or within_send_hours(settings, now)


def _send(subject: str, recipient: str, html: str):
    if not current_app.config.get("MAIL_USERNAME"):
        current_app.logger.warning("MAIL_USERNAME not configured; skipping email to %s: %s", recipient, subject)
        return
    msg = Message(subject=subject, recipients=[recipient], html=html)
    mail.send(msg)


def _send_if_allowed(kind: str, subject: str, recipient: str, html: str) -> bool:
    if not email_allowed(kind):
        current_app.logger.warning("Email to %s not sent (%s emails are switched off in Settings): %s",
                                   recipient, kind, subject)
        return False
    _send(subject, recipient, html)
    return True


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
    return _send_if_allowed("account", "Activate your lecturer attendance account", user.email, html)


def send_verification_email(user, token: str):
    site_name = get_setting_str("site_name")
    link = f"{current_app.config['FRONTEND_BASE_URL']}/verify-email?token={token}"
    html = f"""
        <p>Hello {escape(user.name)},</p>
        <p>Thanks for signing up on the {escape(site_name)} system. Please confirm this is your email address:</p>
        <p><a href="{escape(link)}">{escape(link)}</a></p>
        <p>This link expires in 48 hours. If you didn't create this account, you can ignore this email.</p>
    """
    return _send_if_allowed("account", "Confirm your email address", user.email, html)


def send_password_reset_email(user, token: str):
    link = f"{current_app.config['FRONTEND_BASE_URL']}/reset-password?token={token}"
    html = f"""
        <p>Hello {escape(user.name)},</p>
        <p>We received a request to reset your password.</p>
        <p><a href="{escape(link)}">{escape(link)}</a></p>
        <p>If you did not request this, you can ignore this email. This link expires in 1 hour.</p>
    """
    return _send_if_allowed("account", "Reset your password", user.email, html)


def send_checkin_reminder_email(user, course_name: str, minutes_before: int):
    html = f"""
        <p>Hello {escape(user.name)},</p>
        <p>Reminder: your class <strong>{escape(course_name)}</strong> starts in about {minutes_before} minutes.
        Please scan the check-in QR code when you arrive on campus.</p>
    """
    return _send_if_allowed("reminder", "Class starting soon - reminder to check in", user.email, html)
