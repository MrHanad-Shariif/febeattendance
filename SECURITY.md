# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Contact the repository owner privately (GitHub → *Security* → *Report a vulnerability*, or by direct message) with steps to reproduce.

## Review summary

A full review of authentication, sessions, input validation, uploads, business logic and configuration was carried out on the whole backend. The table lists what was found and its status. Behaviour is covered by the automated tests in `backend/tests/`.

### Fixed

| Severity | Finding | Fix |
|---|---|---|
| **High** | A disabled or deleted account, or a demoted admin, kept working until its JWT expired (12 h): only the token's claims were checked. | `roles_required` reloads the user on every request and rejects inactive users and role mismatches. |
| **High** | Changing or resetting a password did not sign out other sessions. | Tokens carry a fingerprint of the password hash (`pv`); any change invalidates older tokens. `change-password` returns a fresh token. |
| **High** | Weak defaults (`dev-secret-key`, `ChangeMe123!`, default DB password) were silently accepted. | With `APP_ENV=production` the app refuses to start unless every secret is ≥ 32 chars and not a placeholder, URLs are HTTPS, the DB password is not the default and `APP_TIMEZONE` is set. |
| **High** | No brute-force protection on login, password reset, registration, kiosk key or the 4-digit class code. | Flask-Limiter: login 30/min per IP and 8 per 15 min per email; reset/verification/registration/activation limits; check-in 10/min per user; wrong kiosk keys throttled. Real client IP is taken from the proxy (`TRUSTED_PROXY_COUNT`). |
| **High** | `/activate` accepted any token type. A *reset* token could re-activate an account an admin had disabled. | `/activate` accepts only invite tokens; reset and verify tokens are purpose-checked and refuse disabled accounts. |
| **Medium** | Student photos were served to anyone (`/api/uploads/…`). | The endpoint requires a valid session; the SPA fetches images with its token. |
| **Medium** | Uploads were validated by file extension only. | Content is decoded with Pillow, limited to PNG/JPEG/WEBP and 25 MP, resized, and **re-encoded** under a random name. |
| **Medium** | Malformed input caused HTTP 500 or an HTML traceback (`int()`/`fromisoformat()`/`.strip()` on the wrong type, bad month, bad time…). | Central validators (`utils/validation.py`) and JSON error handlers; clients always get a clean 4xx/`{error}`. |
| **Medium** | Settings accepted any text (e.g. latitude `abc`, mode `sometimes`). | Every setting is type- and range-checked; semester dates are cross-checked. |
| **Medium** | Server time zone was assumed to be the campus's. On a UTC VPS every class would be 3 h off, producing wrong late/absent results. | `APP_TIMEZONE` is applied at start-up (and to the scheduler) and is mandatory in production. |
| **Medium** | Students could check in at any time on the class day. | Check-in opens 30 min before the session and closes when it ends. |
| **Medium** | A missed check-out was flagged only on the same day. | The job now also finalises earlier days. |
| **Medium** | Simultaneous submits could raise a database error (500). | Unique-constraint races return `409`. |
| **Low** | Kiosk access key compared with `!=` (timing side channel). | `hmac.compare_digest`. |
| **Low** | Names/site name were interpolated into email HTML unescaped. | All values are HTML-escaped. |
| **Low** | Unknown-user login returned faster than wrong-password (account enumeration by timing). | A dummy bcrypt check equalises timing. |
| **Low** | `run.py` started with `debug=True` on `0.0.0.0` (interactive debugger = remote code execution if exposed). | Debug is opt-in, off in production, bound to localhost. |
| **Low** | No security headers; API responses cacheable. | `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `no-store` on the API; HSTS and a strict CSP from Caddy. |
| **Low** | Students with no batch could match batch-less timetable rows. | Guarded. |

### Open risks and limitations (please read)

1. **Roster claiming relies only on the student ID.** Anyone who knows an imported student's ID number can register first, attach their *own* email and password, and confirm it. Mitigation today: admins can disable accounts, and photos and names are visible in Admin → Students. Recommended next step: verify a second roster fact (e.g. date of birth or mobile number from the export, stored hashed) or require admin approval for claims.
2. **Location is self-reported.** The browser sends GPS coordinates, which a technically capable user can spoof. The rotating code is the stronger control; keep `verification_mode` on `both`.
3. **Class codes can be relayed within the class.** Each session has its own code (useless for other batches), but a student in the room can still message it to a classmate of the same batch within its ~20–40 s validity. The face step stops the classmate from checking in on someone else's account, but not a student checking in for themselves from off campus with a relayed code *and* a spoofed location.
4. **JWTs live in `localStorage`.** A cross-site-scripting bug would expose them. The app has no inline scripts, uses no `dangerouslySetInnerHTML`, and Caddy sends a strict CSP (`script-src 'self'`), which reduces the risk.
5. **Rate-limit counters are in process memory.** This is correct for the supported single-worker deployment; if you scale to several workers, set `RATELIMIT_STORAGE_URI` to Redis.
6. **No audit log** of administrative actions (student status overrides record who changed them; other admin actions do not).
7. **No migration tooling.** Tables are created with `create_all`; schema changes need manual migration. Add Alembic before changing the schema in production.
8. **Email verification uses a GET link**, which some mail scanners pre-fetch and consume.
9. **Imported placeholder emails** (`pending+…@example.invalid`) mark records not yet claimed; they cannot receive mail.
10. **Face checks are not certified anti-spoofing.** The head-turn challenge defeats a held-up photo or a still image; a well-made video or a mask could still pass. Treat the face scan as strong deterrence, not proof.
11. **Biometric data.** Students consent at registration (or on the registration screen for existing accounts). Only face embeddings are stored (`student_faces`), plus a profile photo crop from the scan; both are deleted with the account, and admins can reset a face. Check this matches your institution's data-protection rules before rollout.

## Operator checklist

- [ ] `.env` generated with `deploy/generate_env.py`; file mode `600`; never committed.
- [ ] Admin password changed after the first login; `DEFAULT_ADMIN_PASSWORD` removed or rotated.
- [ ] `DOMAIN` DNS points at the server; ports 80/443 open; everything else closed (`ufw`).
- [ ] SSH: key-only login, root login disabled.
- [ ] Nightly `pg_dump` and a copy of the `uploads` volume stored **off** the server (see docs/DEPLOYMENT.md).
- [ ] `data/` spreadsheets removed from the server after import (or kept root-only) — they contain personal data.
- [ ] `docker compose pull`/rebuild and OS updates applied regularly.
- [ ] Kiosk URL (contains `KIOSK_ACCESS_KEY`) shown only on the campus display.

## Hardening already in place

- Passwords: bcrypt, 8–72 bytes, never logged; generic responses for unknown accounts.
- Sessions: 8-hour JWTs (`JWT_EXPIRES_HOURS`), server-side status/role re-check, revocation on password change.
- Transport: HTTPS only through Caddy with HSTS; the API and database are not exposed to the internet.
- Container: non-root user, single worker, minimal image, secrets via environment only.
- Data: SQLAlchemy ORM (parameterised queries), safe static-file serving, uploads re-encoded.
