"""Approximate location (city, region, country) of an IP address, for the
system log.

Lookups are offline, against the free DB-IP "IP to City Lite" database
(CC BY 4.0, https://db-ip.com), so visitors' IP addresses are never sent to a
third-party service. `flask update-geoip` downloads it into the uploads
volume; without the file every lookup just returns None.

Accuracy is city-level at best, and mobile carriers often route through
another city, so treat the result as a hint rather than proof.
"""
import gzip
import ipaddress
import os
import shutil
import tempfile
import threading
import urllib.request
from datetime import date

from flask import current_app

_lock = threading.Lock()
_reader = None
_reader_mtime = None


def database_path() -> str:
    return current_app.config.get("GEOIP_DB_PATH") or os.path.join(
        current_app.config["UPLOAD_FOLDER"], "private", "geoip", "dbip-city-lite.mmdb"
    )


def _get_reader():
    """Open the database once, reopening it if `update-geoip` replaced it."""
    global _reader, _reader_mtime
    path = database_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    with _lock:
        if _reader is None or mtime != _reader_mtime:
            import maxminddb

            if _reader is not None:
                _reader.close()
            _reader = maxminddb.open_database(path)
            _reader_mtime = mtime
        return _reader


def locate(ip: str | None) -> str | None:
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if addr.is_private or addr.is_loopback or addr.is_link_local:
        return "Local network"
    try:
        reader = _get_reader()
        record = reader.get(ip) if reader else None
    except Exception:  # noqa: BLE001 -- a broken database must never break a request
        current_app.logger.exception("GeoIP lookup failed")
        return None
    if not record:
        return None

    def name(node):
        return (node or {}).get("names", {}).get("en")

    city = name(record.get("city"))
    region = name((record.get("subdivisions") or [None])[0])
    country = name(record.get("country"))
    parts = [city, region if region != city else None, country]
    return ", ".join(p for p in parts if p) or None


def download_database(month: date | None = None) -> str:
    """Fetch this month's database (falling back to last month's, which DB-IP
    keeps up for a while) and swap it in atomically."""
    today = month or date.today()
    prev = date(today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1, 1)
    path = database_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)

    import maxminddb

    last_error = None
    for d in (today, prev):
        url = f"https://download.db-ip.com/free/dbip-city-lite-{d:%Y-%m}.mmdb.gz"
        fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".part")
        try:
            # DB-IP's CDN rejects Python's default User-Agent.
            req = urllib.request.Request(url, headers={"User-Agent": "FEBEMS-attendance/1.0 (+geoip update)"})
            with os.fdopen(fd, "wb") as tmp, urllib.request.urlopen(req, timeout=300) as resp:
                with gzip.GzipFile(fileobj=resp) as gz:
                    shutil.copyfileobj(gz, tmp)
            maxminddb.open_database(tmp_path).close()  # refuse a truncated/corrupt file
            os.replace(tmp_path, path)
            return url
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    raise RuntimeError(f"Could not download the GeoIP database: {last_error}")
