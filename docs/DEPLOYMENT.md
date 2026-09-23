# Deployment (single VPS, Docker Compose)

Target: `https://febeattendance.mansok.com` on your own VPS.

```
Internet ──443/80──► web (Caddy: HTTPS, React SPA, /api proxy) ──► backend (gunicorn) ──► db (PostgreSQL)
                          only these two ports are published          internal Docker network only
```

## 1. Prerequisites

- A Linux VPS (Ubuntu 22.04/24.04 or Debian 12), 1 vCPU / 1 GB RAM minimum (2 GB comfortable).
- **DNS:** an `A` record `febeattendance.mansok.com → <server IP>` (and `AAAA` if the server has IPv6). Caddy cannot get a certificate until this resolves.
- Ports **80 and 443** reachable from the internet.
- Docker Engine and the Compose plugin:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # log out and in again
docker compose version
```

Recommended firewall:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

## 2. Get the code and configure

```bash
sudo mkdir -p /opt/febeattendance && sudo chown $USER /opt/febeattendance
git clone https://github.com/MrHanad-Shariif/febeattendance.git /opt/febeattendance
cd /opt/febeattendance

python3 deploy/generate_env.py > .env      # random secrets, DB password, first admin password
chmod 600 .env
nano .env                                  # set DEFAULT_ADMIN_EMAIL and the MAIL_* values
```

`docker compose` refuses to start if a required value is missing, and the backend refuses to start with placeholder secrets (see `SECURITY.md`). Keep a copy of `.env` somewhere safe (a password manager): losing `SECRET_KEY` signs everyone out, and losing `POSTGRES_PASSWORD` locks you out of the database volume.

**Email:** invites, student verification and password reset all need working SMTP. For Gmail, create an *app password* (<https://myaccount.google.com/apppasswords>) and use it as `MAIL_PASSWORD`. Without `MAIL_USERNAME` emails are only written to the log.

## 3. Start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend      # wait for "Booting worker"
```

On every start the backend waits for the database, creates missing tables and default settings, and creates the first admin from `DEFAULT_ADMIN_*` if it doesn't exist. Nothing is ever dropped.

Open `https://febeattendance.mansok.com/login`, sign in with `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`, and **change the password**.

## 4. Load the faculty data

The spreadsheets contain personal data and are not in git. Copy them from your PC:

```bash
# from your computer, inside the project folder
scp -r data/*.xls* data/*.xlsx user@your-server:/opt/febeattendance/data/
```

Then import (order matters, see [DATA_IMPORT.md](DATA_IMPORT.md)); `./data` is mounted read-only at `/data` in the backend container:

```bash
cd /opt/febeattendance
docker compose exec backend flask import-excel "/data/Latest Lecturer Attendance.xlsx"
docker compose exec backend flask import-confirmed-timetable "/data/Time_Table_OCTOBER 2026 - FEB 2027 (1).xlsx"
docker compose exec backend flask import-students "/data/stdsRegistered23092026_064554.xls"
```

When it has run, remove the spreadsheets from the server: `rm data/*.xls*`.

## 5. First-run checklist in the app

1. **Settings →** confirm campus latitude/longitude/radius, verification mode, semester dates and holidays.
2. **Lecturers →** set each lecturer's real email (this sends the activation invite).
3. **Timetable →** fill in missing rooms (about a third of imported classes have none).
4. **Lecturers → Today's attendance →** print the check-in QR code; open the *Kiosk screen link* on the campus display.
5. **Students → Overview →** print the student QR code for classrooms.

## 6. Backups

Two things hold state: the PostgreSQL volume and the `uploads` volume (student photos).

```bash
# database, compressed
docker compose exec -T db pg_dump -U febe_user febe_attendance | gzip > /var/backups/febe-$(date +%F).sql.gz
# photos
docker run --rm -v febeattendance_uploads:/u -v /var/backups:/b alpine tar czf /b/febe-uploads-$(date +%F).tgz -C /u .
```

Nightly cron (`crontab -e`), keeping 14 days:

```cron
15 2 * * * cd /opt/febeattendance && docker compose exec -T db pg_dump -U febe_user febe_attendance | gzip > /var/backups/febe-$(date +\%F).sql.gz && find /var/backups -name 'febe-*.sql.gz' -mtime +14 -delete
```

Copy `/var/backups` **off the server** (rsync/rclone to other storage); a backup on the same disk is not a backup.

Restore:

```bash
gunzip -c /var/backups/febe-YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U febe_user febe_attendance
```

(Use a fresh database when restoring over existing data: `docker compose down -v` deletes volumes, so only do that deliberately.)

## 7. Updating

```bash
cd /opt/febeattendance
git pull
docker compose up -d --build        # rebuilds changed images; data volumes are kept
docker compose logs --tail=50 backend
```

## 8. Operations & troubleshooting

| Symptom | Check |
|---|---|
| Site not loading / certificate error | DNS resolves to this server; ports 80/443 open; `docker compose logs web` (Caddy shows ACME errors) |
| Backend restarts in a loop | `docker compose logs backend` — a "Refusing to start in production…" message lists exactly which setting is unsafe |
| Login works but everything says "session expired" | Server time zone/clock wrong, or `SECRET_KEY`/`JWT_SECRET_KEY` changed |
| Lecturers show "late/absent" at wrong times | `APP_TIMEZONE` wrong; compare with `docker compose exec backend date` |
| No emails arrive | `MAIL_*` values; for Gmail an app password is required; see backend logs for SMTP errors |
| "Too many requests" for many students at once | Limits are per user for check-in and per IP for public forms; campus Wi-Fi shares one IP, so avoid raising public-form limits too low |
| Disk filling up | `docker system df`; `docker image prune`; rotate backups |

Useful commands:

```bash
docker compose ps                         # status
docker compose logs -f --tail=100 backend # live API log
curl -s https://febeattendance.mansok.com/api/health
docker compose exec db psql -U febe_user febe_attendance   # database shell
docker compose restart backend
```

## Notes

- **One backend worker, by design.** The scheduler (absence marking, reminders) runs inside the API process; more workers would send duplicate reminders. Scale with threads (`--threads` in `backend/Dockerfile`) rather than workers. If you ever need several workers, move the scheduler to its own process and set `RATELIMIT_STORAGE_URI` to Redis.
- **Static frontend build is baked into the `web` image**, so frontend changes require `docker compose up -d --build`.
- **Caddy certificates** persist in the `caddy_data` volume; do not delete it repeatedly, Let's Encrypt rate-limits reissues.
