import os
from datetime import timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Values that ship in .env.example / older versions of this project. The app
# refuses to start in production if any secret still holds one of these.
INSECURE_SECRET_MARKERS = (
    "change", "dev-secret", "dev-jwt", "changeme", "secret-key", "your-",
)
MIN_SECRET_LENGTH = 32


def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Config:
    # development | production | testing
    APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()

    # IANA time zone of the campus, e.g. "Africa/Mogadishu". All scheduling
    # maths uses naive local time, so on a UTC server this MUST be set or every
    # class will look 3 hours off. Applied at start-up (see app/security.py).
    APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "").strip()

    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key")

    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://febe_user:febe_password@localhost:5432/febe_attendance"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-jwt-secret-key")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=int(os.environ.get("JWT_EXPIRES_HOURS", 8)))
    JWT_TOKEN_LOCATION = ["headers"]

    FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
    FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")
    CHECKIN_URL = os.environ.get("CHECKIN_URL", "http://localhost:5173/checkin")
    STUDENT_CHECKIN_URL = os.environ.get("STUDENT_CHECKIN_URL", "http://localhost:5173/student-checkin")

    # Number of reverse proxies in front of the app (Caddy/nginx = 1). Needed so
    # rate limiting sees the real client IP instead of the proxy's.
    TRUSTED_PROXY_COUNT = int(os.environ.get("TRUSTED_PROXY_COUNT", 0))

    RATELIMIT_ENABLED = _env_bool("RATELIMIT_ENABLED", True)
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_HEADERS_ENABLED = True

    KIOSK_TOTP_SECRET = os.environ.get("KIOSK_TOTP_SECRET", "CHANGEMECHANGEMECHANGEMECHANGEME")
    KIOSK_CODE_INTERVAL_SECONDS = int(os.environ.get("KIOSK_CODE_INTERVAL_SECONDS", 60))
    KIOSK_CODE_DIGITS = int(os.environ.get("KIOSK_CODE_DIGITS", 6))
    # Shared secret embedded in the kiosk screen's URL so the rotating-code
    # endpoint can't be read remotely by someone off campus.
    KIOSK_ACCESS_KEY = os.environ.get("KIOSK_ACCESS_KEY", "change-this-kiosk-access-key")

    # Student class-code: a rotating code a lecturer displays on their own
    # laptop next to the session's QR code. Every class session gets its own
    # code derived from this secret (see utils/student_code.py). Access to it
    # is gated by the lecturer's own login (JWT), not a URL key, since only
    # real lecturer accounts should ever show it.
    STUDENT_CODE_TOTP_SECRET = os.environ.get("STUDENT_CODE_TOTP_SECRET", "CHANGEMESTUDENTCHANGEMESTUDENT1")
    STUDENT_CODE_INTERVAL_SECONDS = int(os.environ.get("STUDENT_CODE_INTERVAL_SECONDS", 20))
    STUDENT_CODE_DIGITS = int(os.environ.get("STUDENT_CODE_DIGITS", 6))

    # OpenCV face models (YuNet detector + SFace recognizer), downloaded into
    # the image at build time -- see backend/Dockerfile.
    FACE_MODEL_DIR = os.environ.get("FACE_MODEL_DIR", os.path.join(BASE_DIR, "models"))

    UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", os.path.join(BASE_DIR, "uploads"))
    MAX_CONTENT_LENGTH = 15 * 1024 * 1024  # 15MB: meeting minutes / agenda PDFs (photos are re-encoded smaller)

    MAIL_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = int(os.environ.get("MAIL_PORT", 587))
    MAIL_USE_TLS = _env_bool("MAIL_USE_TLS", True)
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD")
    MAIL_DEFAULT_SENDER = os.environ.get("MAIL_DEFAULT_SENDER", MAIL_USERNAME)

    DEFAULT_ADMIN_NAME = os.environ.get("DEFAULT_ADMIN_NAME", "Faculty Admin")
    DEFAULT_ADMIN_EMAIL = os.environ.get("DEFAULT_ADMIN_EMAIL", "admin@example.com")
    DEFAULT_ADMIN_PASSWORD = os.environ.get("DEFAULT_ADMIN_PASSWORD", "ChangeMe123!")

    SCHEDULER_API_ENABLED = False
    if APP_TIMEZONE:
        SCHEDULER_TIMEZONE = APP_TIMEZONE


class TestingConfig(Config):
    APP_ENV = "testing"
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    RATELIMIT_ENABLED = False
    SECRET_KEY = "test-secret-key-for-unit-tests-only-0123456789"
    JWT_SECRET_KEY = "test-jwt-secret-key-for-unit-tests-only-0123456789"


def validate_production_config(cfg) -> list[str]:
    """Return a list of problems that make the config unsafe for production."""
    problems = []

    for key in ("SECRET_KEY", "JWT_SECRET_KEY", "KIOSK_TOTP_SECRET", "KIOSK_ACCESS_KEY", "STUDENT_CODE_TOTP_SECRET"):
        value = str(cfg.get(key) or "")
        if len(value) < MIN_SECRET_LENGTH:
            problems.append(f"{key} must be at least {MIN_SECRET_LENGTH} characters")
        elif any(marker in value.lower() for marker in INSECURE_SECRET_MARKERS):
            problems.append(f"{key} still contains a placeholder value")

    if "febe_password" in cfg.get("SQLALCHEMY_DATABASE_URI", ""):
        problems.append("DATABASE_URL still uses the default development password")

    if str(cfg.get("DEFAULT_ADMIN_PASSWORD") or "") == "ChangeMe123!":
        problems.append("DEFAULT_ADMIN_PASSWORD still has the default value")

    for key in ("FRONTEND_ORIGIN", "FRONTEND_BASE_URL"):
        value = str(cfg.get(key) or "")
        if "localhost" in value or not value.startswith("https://"):
            problems.append(f"{key} must be an https:// URL in production (got {value!r})")

    if not cfg.get("APP_TIMEZONE"):
        problems.append("APP_TIMEZONE must be set (e.g. Africa/Mogadishu); scheduling assumes campus-local time")

    return problems
