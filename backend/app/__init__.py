import os

import click
from flask import Flask, send_from_directory
from werkzeug.utils import safe_join

from app.config import Config
from app.extensions import db, migrate, jwt, cors, mail, scheduler, limiter
from app.security import init_security
from app.utils.activity_log import init_activity_log
from app.utils.authz import roles_required


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    init_security(app)
    init_activity_log(app)

    db.init_app(app)
    limiter.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    mail.init_app(app)

    origins = [o.strip() for o in app.config["FRONTEND_ORIGIN"].split(",") if o.strip()]
    cors.init_app(app, resources={r"/api/*": {"origins": origins}})

    from app.auth import auth_bp
    from app.admin import admin_bp
    from app.lecturer import lecturer_bp
    from app.attendance import attendance_bp
    from app.kiosk import kiosk_bp
    from app.student import student_bp
    from app.committees import committees_bp
    from app.meetings import meetings_bp
    from app.notices import notices_bp
    from app.notifications import notifications_bp
    from app.reports import reports_bp
    from app.access import access_bp
    from app.archive import archive_bp
    from app.assignments import assignments_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(lecturer_bp)
    app.register_blueprint(attendance_bp)
    app.register_blueprint(kiosk_bp)
    app.register_blueprint(student_bp)
    # Committees & task management module (shares users, auth and email).
    app.register_blueprint(committees_bp)
    app.register_blueprint(meetings_bp)
    app.register_blueprint(notices_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(reports_bp)
    # User management: users, roles and permissions (fine-grained RBAC).
    app.register_blueprint(access_bp)
    # Committee archive (memos, agendas, reports) and class assignments.
    app.register_blueprint(archive_bp)
    app.register_blueprint(assignments_bp)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/semester")
    @roles_required()
    def semester():
        """The current semester's name and dates, for timetable headers."""
        from app.utils.settings import get_all_settings

        settings = get_all_settings()
        return {key: settings.get(key) for key in ("semester_name", "semester_start_date", "semester_end_date")}

    @app.get("/api/uploads/<path:filename>")
    @roles_required()
    def uploaded_file(filename):
        """Student photos are personal data: only signed-in users may fetch them.
        Committee documents live under private/ and are served only by their
        own routes, which check the requester may see that record."""
        joined = safe_join(app.config["UPLOAD_FOLDER"], filename)
        private_root = os.path.join(os.path.normpath(app.config["UPLOAD_FOLDER"]), "private")
        if joined is None or os.path.normpath(joined) == private_root or os.path.normpath(joined).startswith(private_root + os.sep):
            return {"error": "Not found"}, 404
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

    register_cli(app)

    # Avoid starting two copies of the scheduler under the Flask debug reloader.
    is_reloader_child = os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if not app.config.get("TESTING") and (is_reloader_child or not app.debug):
        from app.jobs import register_jobs

        if not scheduler.running:
            scheduler.init_app(app)
            register_jobs(app, scheduler)
            scheduler.start()

    return app


# Columns added to tables that already exist in deployed databases.
# db.create_all() only creates missing tables, so these are added here.
NEW_COLUMNS = [
    ("student_attendance", "checkin_method", "VARCHAR(20)"),
    ("committees", "scope_of_work", "TEXT"),
    ("tasks", "report_outcomes", "TEXT"),
    ("tasks", "report_challenges", "TEXT"),
    ("tasks", "report_recommendations", "TEXT"),
]

# Settings whose old default was replaced: (key, old default, new value).
# Only rows still holding the old default are changed.
RENAMED_DEFAULTS = [
    ("site_name", "University attendance", "FEBEMS"),
]


def _add_missing_columns():
    inspector = db.inspect(db.engine)
    tables = set(inspector.get_table_names())
    for table, column, ddl in NEW_COLUMNS:
        if table in tables and column not in {c["name"] for c in inspector.get_columns(table)}:
            db.session.execute(db.text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
    db.session.commit()


def _update_renamed_defaults():
    """Apply RENAMED_DEFAULTS and refresh every setting's help text (the
    descriptions are not editable, so they follow the code)."""
    from app.models import Setting

    for key, old, new in RENAMED_DEFAULTS:
        row = Setting.query.get(key)
        if row is not None and row.value == old:
            row.value = new
    for row in Setting.query.all():
        if row.key in Setting.DEFAULTS:
            row.description = Setting.DEFAULTS[row.key][1]
    db.session.commit()


def register_cli(app):
    @app.cli.command("init-db")
    def init_db():
        """Create all tables and seed default settings. Run once on a fresh database."""
        from app.utils.rbac import ensure_rbac_seeded
        from app.utils.settings import ensure_defaults_seeded

        db.create_all()
        _add_missing_columns()
        ensure_defaults_seeded()
        _update_renamed_defaults()
        ensure_rbac_seeded()
        from app.utils.archive import backfill_meeting_agendas
        backfill_meeting_agendas()
        print("Database tables created, default settings and roles seeded.")

    @app.cli.command("seed-admin")
    def seed_admin():
        """Create the default super-admin account from .env, if it doesn't exist yet."""
        from app.models import User

        from app.utils.rbac import grant_super_admin

        email = app.config["DEFAULT_ADMIN_EMAIL"].strip().lower()
        if User.query.filter_by(email=email).first():
            print(f"Admin {email} already exists, skipping.")
            return

        user = User(
            name=app.config["DEFAULT_ADMIN_NAME"],
            email=email,
            role="admin",
            status="active",
        )
        user.set_password(app.config["DEFAULT_ADMIN_PASSWORD"])
        db.session.add(user)
        db.session.commit()
        grant_super_admin(user)
        print(f"Created admin {email} (Super Admin). Log in and change the password immediately.")

    @app.cli.command("seed-settings")
    def seed_settings():
        """Populate the settings table with default values (skips keys already set)."""
        from app.utils.settings import ensure_defaults_seeded

        ensure_defaults_seeded()
        print("Settings defaults ensured.")

    @app.cli.command("import-excel")
    @click.argument("xlsx_path")
    def import_excel(xlsx_path):
        """Import lecturers/timetable from the legacy 'Latest Lecturer Attendance.xlsx' file."""
        from app.importers.import_from_excel import import_lecturers_and_timetable

        import_lecturers_and_timetable(xlsx_path)

    @app.cli.command("import-confirmed-timetable")
    @click.argument("xlsx_path")
    def import_confirmed_timetable_cmd(xlsx_path):
        """Replace the timetable with the confirmed (green-highlighted) sessions
        from the detailed per-batch 'Time_Table_...xlsx' workbook."""
        from app.importers.import_confirmed_timetable import import_confirmed_timetable

        import_confirmed_timetable(xlsx_path)

    @app.cli.command("update-geoip")
    @click.option("--if-missing", is_flag=True, help="Only download when no database is installed yet.")
    def update_geoip(if_missing):
        """Download the free DB-IP city database used to show sign-in locations."""
        from app.utils.geoip import database_path, download_database

        if if_missing and os.path.exists(database_path()):
            print("GeoIP database already installed.")
            return
        print(f"Installed {download_database()} -> {database_path()}")

    @app.cli.command("import-access-log")
    @click.argument("log_file", type=click.File("r"))
    @click.option("--until", type=click.DateTime(), default=None,
                  help="Campus time at which live logging started; later lines are skipped.")
    def import_access_log_cmd(log_file, until):
        """Rebuild system-log rows for the time before logging existed, from an
        nginx access log ("-" reads stdin). Who signed in can't be recovered
        from web-server logs, so those rows show an unknown user."""
        from app.utils.log_import import import_access_log

        added, skipped = import_access_log(log_file, until=until)
        print(f"Imported {added} log rows ({skipped} already present or after live logging began).")

    @app.cli.command("import-students")
    @click.argument("roster_path")
    def import_students_cmd(roster_path):
        """Import the official student roster export (see seed/import_students.py)."""
        from app.importers.import_students import import_students

        import_students(roster_path)
