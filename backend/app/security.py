"""Cross-cutting security and robustness wiring, applied once from create_app():

* refuses to boot in production with placeholder secrets / non-HTTPS URLs
* campus time zone (all schedule maths uses naive campus-local time)
* real client IP behind a reverse proxy (needed by the rate limiter)
* security response headers
* JSON error handlers, so clients never receive an HTML traceback page
"""
import os
import time

from flask import jsonify, request
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from app.config import validate_production_config
from app.utils.validation import ValidationError


def init_security(app):
    _check_production_config(app)
    if app.config.get("APP_ENV") == "production":
        app.debug = False  # never expose the interactive debugger, whatever FLASK_DEBUG says
    _apply_timezone(app)

    proxies = app.config.get("TRUSTED_PROXY_COUNT", 0)
    if proxies:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=proxies, x_proto=proxies, x_host=proxies)

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
        if request.path.startswith("/api/"):
            # API responses contain personal data and rotating codes: never cache them.
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    _register_error_handlers(app)


def _check_production_config(app):
    if app.config.get("APP_ENV") != "production":
        return
    problems = validate_production_config(app.config)
    if problems:
        raise RuntimeError(
            "Refusing to start in production with an unsafe configuration:\n  - " + "\n  - ".join(problems)
        )


def _apply_timezone(app):
    tz = app.config.get("APP_TIMEZONE")
    if not tz:
        return
    os.environ["TZ"] = tz
    if hasattr(time, "tzset"):  # not available on Windows; set TZ in the OS there instead
        time.tzset()


def _register_error_handlers(app):
    @app.errorhandler(ValidationError)
    def handle_validation(err):
        return jsonify({"error": err.message}), err.status

    @app.errorhandler(HTTPException)
    def handle_http(err):
        messages = {
            401: "Authentication required",
            403: "Forbidden",
            404: "Not found",
            405: "Method not allowed",
            413: "Upload is too large (max 15 MB)",
            429: "Too many requests. Please wait a moment and try again.",
        }
        return jsonify({"error": messages.get(err.code, err.description)}), err.code

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        app.logger.exception("Unhandled error on %s %s", request.method, request.path)
        return jsonify({"error": "Something went wrong on our side. Please try again."}), 500
