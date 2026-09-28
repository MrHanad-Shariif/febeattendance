#!/bin/sh
# Prepare the database, then hand over to the container command (gunicorn).
# Every step is idempotent, so it is safe to run on every start.
set -e

echo "Waiting for the database..."
python - <<'PY'
import os, sys, time
import sqlalchemy as sa

engine = sa.create_engine(os.environ["DATABASE_URL"])
for attempt in range(30):
    try:
        with engine.connect() as conn:
            conn.execute(sa.text("select 1"))
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        print(f"  not ready yet ({attempt + 1}/30): {exc.__class__.__name__}")
        time.sleep(2)
print("Database never became reachable", file=sys.stderr)
sys.exit(1)
PY

flask init-db      # creates missing tables + default settings (never drops anything)
flask seed-admin   # creates the first admin from DEFAULT_ADMIN_* if it does not exist
# Location lookups for the system log; without it locations are just blank.
flask update-geoip --if-missing || echo "GeoIP database download failed; sign-in locations stay blank until it succeeds."

exec "$@"
