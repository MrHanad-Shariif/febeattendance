#!/usr/bin/env python3
"""Print a ready-to-use production .env with freshly generated random secrets.

    python3 deploy/generate_env.py > .env
    # then edit .env: set DEFAULT_ADMIN_EMAIL and the MAIL_* values

Uses only the standard library, so it runs on a bare server before Docker.
"""
import base64
import secrets

TEMPLATE = """\
DOMAIN=febeattendance.mansok.com
APP_TIMEZONE=Africa/Mogadishu

POSTGRES_PASSWORD={db_password}

SECRET_KEY={secret_key}
JWT_SECRET_KEY={jwt_secret}
KIOSK_TOTP_SECRET={kiosk_totp}
KIOSK_ACCESS_KEY={kiosk_key}
STUDENT_CODE_TOTP_SECRET={student_totp}

DEFAULT_ADMIN_NAME=Faculty Admin
DEFAULT_ADMIN_EMAIL=
DEFAULT_ADMIN_PASSWORD={admin_password}

MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_DEFAULT_SENDER=
"""


def base32(nbytes: int = 30) -> str:
    """Random base32 string (valid as a TOTP secret), 48 chars for 30 bytes."""
    return base64.b32encode(secrets.token_bytes(nbytes)).decode().rstrip("=")


print(
    TEMPLATE.format(
        db_password=secrets.token_urlsafe(24),
        secret_key=secrets.token_hex(32),
        jwt_secret=secrets.token_hex(32),
        kiosk_totp=base32(),
        kiosk_key=secrets.token_urlsafe(32),
        student_totp=base32(),
        admin_password=secrets.token_urlsafe(16),
    ),
    end="",
)
