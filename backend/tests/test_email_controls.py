"""Settings > Email: master switch, per-type switches and sending hours."""
from datetime import datetime
from unittest.mock import patch

import pytest

from app.extensions import db
from app.models import EmailOutbox, Setting
from app.utils.email import email_allowed, send_password_reset_email, within_send_hours
from app.utils.notify import flush_outbox, notify
from app.utils.settings import get_all_settings
from tests.conftest import auth_header

THURSDAY_NOON = datetime(2026, 10, 1, 12, 0)


def set_settings(**values):
    for key, value in values.items():
        db.session.get(Setting, key).value = value
    db.session.commit()


def queue_one(user):
    notify([user], type="information", title="Hello", message="Body", email_subject="Subject")
    db.session.commit()


@pytest.fixture()
def mail_on(app):
    app.config["MAIL_USERNAME"] = "sender@example.com"
    with patch("app.utils.email.mail.send") as send:
        yield send


def test_defaults_send_everything(app):
    settings = get_all_settings()
    assert all(email_allowed(k, settings, THURSDAY_NOON) for k in ("notification", "reminder", "account"))


def test_sending_hours_and_days(app):
    settings = {**get_all_settings(), "email_send_from": "07:00", "email_send_until": "18:00"}
    assert within_send_hours(settings, THURSDAY_NOON)
    assert not within_send_hours(settings, THURSDAY_NOON.replace(hour=18))
    assert not within_send_hours(settings, THURSDAY_NOON.replace(hour=6, minute=59))

    overnight = {**settings, "email_send_from": "20:00", "email_send_until": "06:00"}
    assert within_send_hours(overnight, THURSDAY_NOON.replace(hour=23))
    assert within_send_hours(overnight, THURSDAY_NOON.replace(hour=5))
    assert not within_send_hours(overnight, THURSDAY_NOON)

    no_thursday = {**settings, "email_send_days": "Sat,Sun,Mon,Tue,Wed"}
    assert not within_send_hours(no_thursday, THURSDAY_NOON)


def test_account_emails_ignore_hours_but_not_switches(app):
    set_settings(email_send_from="07:00", email_send_until="08:00")
    assert email_allowed("account", now=THURSDAY_NOON)
    assert not email_allowed("reminder", now=THURSDAY_NOON)
    set_settings(email_account_messages="off")
    assert not email_allowed("account", now=THURSDAY_NOON)


def test_paused_holds_then_sends(app, lecturer, mail_on):
    set_settings(email_mode="paused")
    queue_one(lecturer)
    assert flush_outbox() == 0
    assert EmailOutbox.query.one().status == "pending"
    mail_on.assert_not_called()

    set_settings(email_mode="on")
    assert flush_outbox() == 1
    assert EmailOutbox.query.one().status == "sent"


def test_off_cancels_waiting_and_queues_nothing(app, lecturer, mail_on):
    queue_one(lecturer)
    set_settings(email_mode="off")
    flush_outbox()
    assert EmailOutbox.query.one().status == "cancelled"

    queue_one(lecturer)
    assert EmailOutbox.query.count() == 1  # nothing new queued; in-app notification still made
    mail_on.assert_not_called()


def test_notifications_switch_off_cancels(app, lecturer, mail_on):
    queue_one(lecturer)
    set_settings(email_notifications="off")
    flush_outbox()
    assert EmailOutbox.query.one().status == "cancelled"
    mail_on.assert_not_called()


def test_password_reset_blocked_when_off(app, lecturer, mail_on):
    set_settings(email_mode="off")
    assert send_password_reset_email(lecturer, "token") is False
    mail_on.assert_not_called()
    set_settings(email_mode="on")
    assert send_password_reset_email(lecturer, "token") is True
    mail_on.assert_called_once()


def test_settings_validation(client, admin):
    h = auth_header(admin)
    ok = client.put("/api/admin/settings", headers=h, json={
        "email_mode": "paused", "email_send_from": "7:30", "email_send_until": "18:00",
        "email_send_days": "Sun,Sat,Mon",
    })
    assert ok.status_code == 200
    values = {r["key"]: r["value"] for r in ok.get_json()}
    assert values["email_send_from"] == "07:30"
    assert values["email_send_days"] == "Mon,Sat,Sun"

    for bad in ({"email_mode": "maybe"}, {"email_send_from": "25:00"}, {"email_send_days": ""},
                {"email_send_days": "Funday"}, {"email_send_from": "09:00", "email_send_until": "09:00"}):
        assert client.put("/api/admin/settings", headers=h, json=bad).status_code == 400, bad


def test_email_status_endpoint(client, admin, app):
    app.config["MAIL_USERNAME"] = "sender@example.com"
    set_settings(email_mode="paused")
    res = client.get("/api/admin/email-status", headers=auth_header(admin))
    assert res.status_code == 200
    body = res.get_json()
    assert body["state"] == "paused"
    assert body["kinds"] == {"notification": False, "reminder": False, "account": False}
    assert set(body["queue"]) == {"pending", "sent", "failed", "cancelled"}
