import hmac

from flask import request, jsonify, current_app

from app.extensions import limiter
from app.kiosk import kiosk_bp
from app.utils.kiosk_code import current_code, seconds_remaining
from app.utils.settings import get_setting_str


@kiosk_bp.get("/code")
@limiter.limit("120/minute")
@limiter.limit("10/minute", key_func=lambda: "kiosk-bad-key", exempt_when=lambda: _key_ok())
def get_code():
    if not _key_ok():
        return jsonify({"error": "Not authorized"}), 403

    return jsonify({
        "code": current_code(),
        "seconds_remaining": seconds_remaining(),
        "interval": current_app.config["KIOSK_CODE_INTERVAL_SECONDS"],
        "site_name": get_setting_str("site_name"),
    })


def _key_ok() -> bool:
    """Constant-time comparison so the access key can't be recovered by timing."""
    supplied = request.args.get("key", "")
    expected = current_app.config["KIOSK_ACCESS_KEY"]
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))
