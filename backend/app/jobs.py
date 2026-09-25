"""Background jobs that finalize attendance statuses without any lecturer action.

Registered with APScheduler in app/__init__.py to run every couple of minutes.
A lecturer has at most one Attendance row per day (see models.Attendance), so
these jobs work per-lecturer, anchored on their first class's start time and
their last class's end time for that day.
"""
from datetime import date, datetime

from app.extensions import db
from app.models import User, Attendance, StudentAttendance
from app.utils.email import send_checkin_reminder_email
from app.utils.schedule import get_day_classes, day_bounds, get_batch_classes, scheduled_datetimes
from app.utils.settings import get_all_settings, get_setting_int, get_no_class_dates
from app.utils.status import should_mark_absent, should_mark_no_checkout
from app.utils.student_status import should_mark_student_absent


def mark_absentees(app):
    with app.app_context():
        today = date.today()
        now = datetime.now()
        settings = get_all_settings()
        no_class_dates = get_no_class_dates(settings)

        for lecturer in User.query.filter_by(role="lecturer").all():
            entries = get_day_classes(lecturer.id, today, no_class_dates)
            if not entries:
                continue
            first_start, last_end = day_bounds(entries, today)
            if not should_mark_absent(first_start, now, settings):
                continue

            record = Attendance.query.filter_by(lecturer_id=lecturer.id, date=today).first()
            if record:
                continue  # already checked in or already finalized

            db.session.add(Attendance(
                lecturer_id=lecturer.id,
                date=today,
                scheduled_start=first_start,
                scheduled_end=last_end,
                status="absent",
            ))
        db.session.commit()


def mark_no_checkouts(app):
    with app.app_context():
        today = date.today()
        now = datetime.now()
        settings = get_all_settings()

        # `<=` (not `==`): a missed check-out must still be flagged after midnight.
        records = Attendance.query.filter(
            Attendance.date <= today,
            Attendance.checkin_at.isnot(None),
            Attendance.checkout_at.is_(None),
            Attendance.status != "no_checkout",
        ).all()
        for record in records:
            if record.scheduled_end and should_mark_no_checkout(record.scheduled_end, now, settings):
                record.status = "no_checkout"
        db.session.commit()


def send_checkin_reminders(app):
    with app.app_context():
        settings = get_all_settings()
        reminder_minutes = get_setting_int("reminder_minutes_before", settings)
        if reminder_minutes <= 0:
            return

        today = date.today()
        now = datetime.now()
        no_class_dates = get_no_class_dates(settings)

        for lecturer in User.query.filter_by(role="lecturer", status="active").all():
            entries = get_day_classes(lecturer.id, today, no_class_dates)
            if not entries:
                continue
            first_start, last_end = day_bounds(entries, today)

            minutes_to_start = (first_start - now).total_seconds() / 60.0
            if not (0 <= minutes_to_start <= reminder_minutes):
                continue

            record = Attendance.query.filter_by(lecturer_id=lecturer.id, date=today).first()
            if record and (record.checkin_at or record.reminder_sent_at):
                continue

            if not record:
                record = Attendance(
                    lecturer_id=lecturer.id,
                    date=today,
                    scheduled_start=first_start,
                    scheduled_end=last_end,
                    status="not_yet",
                )
                db.session.add(record)

            send_checkin_reminder_email(lecturer, entries[0].course_name, reminder_minutes)
            record.reminder_sent_at = now

        db.session.commit()


def mark_student_absentees(app):
    with app.app_context():
        today = date.today()
        now = datetime.now()
        settings = get_all_settings()
        no_class_dates = get_no_class_dates(settings)

        batches = [b[0] for b in User.query.filter_by(role="student").with_entities(User.batch).distinct().all() if b[0]]
        for batch in batches:
            entries = get_batch_classes(batch, today, no_class_dates)
            if not entries:
                continue
            students = User.query.filter_by(role="student", batch=batch, status="active").all()

            for entry in entries:
                start_dt, _ = scheduled_datetimes(entry, today)
                if not should_mark_student_absent(start_dt, now, settings):
                    continue

                for student in students:
                    exists = StudentAttendance.query.filter_by(
                        student_id=student.id, timetable_id=entry.id, date=today
                    ).first()
                    if exists:
                        continue
                    db.session.add(StudentAttendance(
                        student_id=student.id, timetable_id=entry.id, date=today,
                        scheduled_start=start_dt, status="absent",
                    ))
        db.session.commit()


def flush_email_outbox(app):
    from app.utils.notify import flush_outbox

    with app.app_context():
        flush_outbox()


def task_deadline_sweep(app):
    """Remind assignees 24h before a deadline, and tell the assignee and the
    chairperson once when a task becomes overdue. Overdue itself is derived
    from the deadline (Task.is_overdue), so nothing else needs updating."""
    from datetime import timedelta

    from app.models import Task
    from app.utils.notify import notify, subject_for
    from app.utils.task_audit import record_event

    with app.app_context():
        now = datetime.now()
        open_tasks = Task.query.filter(Task.status != "completed", Task.deadline.isnot(None))

        for task in open_tasks.filter(
            Task.deadline >= now, Task.deadline <= now + timedelta(hours=24), Task.due_soon_notified_at.is_(None)
        ).all():
            notify(
                [task.assigned_to], type="task", title=f"Task due soon: {task.title}",
                message=f"{task.committee.name}. Deadline: {task.deadline:%d %b %Y %H:%M}.",
                link=f"/tasks/{task.id}", related_id=task.id,
                email_subject=subject_for("task_due_soon", task.title),
            )
            task.due_soon_notified_at = now
            record_event(task, None, "notification_sent", new={"reminder": "due_soon"})

        for task in open_tasks.filter(Task.deadline < now, Task.overdue_notified_at.is_(None)).all():
            notify(
                [task.assigned_to, task.committee.chairperson], type="task", title=f"Task overdue: {task.title}",
                message=f"{task.committee.name}. The deadline was {task.deadline:%d %b %Y %H:%M}.",
                link=f"/tasks/{task.id}", related_id=task.id,
                email_subject=subject_for("task_overdue", task.title),
            )
            task.overdue_notified_at = now
            record_event(task, None, "status_changed", old=task.status, new="overdue", note="Deadline passed")
        db.session.commit()


def register_jobs(app, scheduler):
    scheduler.add_job(
        id="mark_absentees", func=mark_absentees, args=[app],
        trigger="interval", minutes=2, replace_existing=True,
    )
    scheduler.add_job(
        id="mark_no_checkouts", func=mark_no_checkouts, args=[app],
        trigger="interval", minutes=2, replace_existing=True,
    )
    scheduler.add_job(
        id="send_checkin_reminders", func=send_checkin_reminders, args=[app],
        trigger="interval", minutes=1, replace_existing=True,
    )
    scheduler.add_job(
        id="mark_student_absentees", func=mark_student_absentees, args=[app],
        trigger="interval", minutes=2, replace_existing=True,
    )
    scheduler.add_job(
        id="flush_email_outbox", func=flush_email_outbox, args=[app],
        trigger="interval", minutes=1, replace_existing=True,
    )
    scheduler.add_job(
        id="task_deadline_sweep", func=task_deadline_sweep, args=[app],
        trigger="interval", minutes=15, replace_existing=True,
    )
