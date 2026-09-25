import os

import click
from flask import Flask, send_from_directory
from werkzeug.utils import safe_join

from app.config import Config
from app.extensions import db, migrate, jwt, cors, mail, scheduler, limiter
from app.security import init_security
from app.utils.authz import roles_required


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    init_security(app)

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

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

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


def register_cli(app):
    @app.cli.command("init-db")
    def init_db():
        """Create all tables and seed default settings. Run once on a fresh database."""
        from app.utils.settings import ensure_defaults_seeded

        db.create_all()
        ensure_defaults_seeded()
        print("Database tables created and default settings seeded.")

    @app.cli.command("seed-admin")
    def seed_admin():
        """Create the default super-admin account from .env, if it doesn't exist yet."""
        from app.models import User

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
        print(f"Created admin {email}. Log in and change the password immediately.")

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

    @app.cli.command("import-students")
    @click.argument("roster_path")
    def import_students_cmd(roster_path):
        """Import the official student roster export (see seed/import_students.py)."""
        from app.importers.import_students import import_students

        import_students(roster_path)
