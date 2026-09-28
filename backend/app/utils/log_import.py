"""Backfill the system log from nginx access logs written before the app kept
its own (see `flask import-access-log`).

Web-server logs hold the IP address, time, browser and URL of every request,
but not who made it: the email is in the sign-in request's body and the
token is in a header, neither of which nginx records. So imported rows have
no user. Actions are grouped under the most recent sign-in from the same IP
address and browser within a token's lifetime, which is usually -- not
always -- the same person.
"""
import hashlib
import re
from datetime import datetime

from flask import current_app
from werkzeug.exceptions import HTTPException

from app.extensions import db
from app.models import ActivityLog
from app.utils.activity_log import describe, write
from app.utils.geoip import locate

_LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] "(?P<method>[A-Z]+) (?P<path>\S+) [^"]*" '
    r'(?P<status>\d{3}) \S+ "[^"]*" "(?P<ua>[^"]*)"'
)

_FAILED_LOGIN = {401: "Wrong email or password", 403: "Account not active (unconfirmed, not activated or disabled)",
                 429: "Too many attempts (blocked)"}


def _parse(line: str):
    m = _LINE.match(line)
    if not m or not m["path"].startswith("/api/"):
        return None
    try:
        # nginx writes UTC offsets; the app stores naive campus-local time.
        at = datetime.strptime(m["time"], "%d/%b/%Y:%H:%M:%S %z").astimezone().replace(tzinfo=None)
    except ValueError:
        return None
    return at, m["ip"], m["method"], m["path"].split("?", 1)[0], int(m["status"]), m["ua"]


def import_access_log(lines, until: datetime | None = None) -> tuple[int, int]:
    """Only lines before ``until`` (default: the first live row) are imported,
    so nothing the app has logged itself is counted twice."""
    first_live = db.session.query(db.func.min(ActivityLog.created_at)).filter(ActivityLog.source == "live").scalar()
    if until and (first_live is None or until < first_live):
        first_live = until
    existing = {
        (r.created_at, r.ip_address, r.method, r.path)
        for r in ActivityLog.query.filter_by(source="imported").with_entities(
            ActivityLog.created_at, ActivityLog.ip_address, ActivityLog.method, ActivityLog.path)
    }
    token_lifetime = current_app.config["JWT_ACCESS_TOKEN_EXPIRES"]
    adapter = current_app.url_map.bind("localhost")

    entries = sorted(filter(None, (_parse(line) for line in lines)))
    sessions: dict[tuple[str, str], tuple[str, datetime]] = {}
    locations: dict[str, str | None] = {}
    added = skipped = 0

    for at, ip, method, path, status, ua in entries:
        if first_live and at >= first_live:
            skipped += 1
            continue
        try:
            endpoint, view_args = adapter.match(path, method=method)
        except HTTPException:
            continue

        if endpoint in ("auth.login", "auth.activate"):
            if status == 200:
                event, detail = "login", "Imported from web-server log: user unknown"
                label = "Signed in" if endpoint == "auth.login" else "Signed in after activating account"
                sid = "imp-" + hashlib.sha256(f"{ip}|{ua}|{at.isoformat()}".encode()).hexdigest()[:28]
                sessions[(ip, ua)] = (sid, at)
            elif endpoint == "auth.login" and status in _FAILED_LOGIN:
                event, label, detail, sid = "login_failed", "Failed sign-in", _FAILED_LOGIN[status], None
            else:
                continue
            area = "Account"
        else:
            described = describe(endpoint, method)
            if described is None or status in (401, 404, 405):
                continue  # not a logged action, or no signed-in user behind it
            area, label = described
            event = "action"
            detail = ", ".join(f"{k.removesuffix('_id').replace('_', ' ')} {v}" for k, v in view_args.items()) or None
            session = sessions.get((ip, ua))
            sid = session[0] if session and at - session[1] <= token_lifetime else None

        if (at, ip, method, path) in existing:
            skipped += 1
            continue
        existing.add((at, ip, method, path))
        if ip not in locations:
            locations[ip] = locate(ip)
        write(event, session_id=sid, action=label, area=area, detail=detail, method=method, path=path,
              status_code=status, ip=ip, user_agent=ua, created_at=at, source="imported", location=locations[ip])
        added += 1
    return added, skipped
