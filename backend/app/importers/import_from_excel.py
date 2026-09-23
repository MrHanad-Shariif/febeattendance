"""One-time import of lecturers and their course assignments from the
faculty's existing 'Latest Lecturer Attendance.xlsx' spreadsheet (Lecturers +
Timetable tabs) into the database.

Lecturers are created without an email/password (status='invited') since the
original sheet has no email column filled in. An admin should edit each
lecturer afterwards to add their real email, which triggers the activation
invite.

Usage (from the backend/ folder, with the venv active and .env loaded):
    flask import-excel "C:\\path\\to\\Latest Lecturer Attendance.xlsx"
"""
import datetime as dt

from openpyxl import load_workbook

from app.extensions import db
from app.models import User, Timetable


def _parse_time(value):
    if value is None or value == "":
        return None
    if isinstance(value, dt.time):
        return value
    if isinstance(value, dt.datetime):
        return value.time()
    if isinstance(value, str):
        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                return dt.datetime.strptime(value.strip(), fmt).time()
            except ValueError:
                continue
    return None


def import_lecturers_and_timetable(xlsx_path: str):
    wb = load_workbook(xlsx_path, data_only=True)

    lecturers_ws = wb["Lecturers"]
    timetable_ws = wb["Timetable"]

    created_lecturers = 0
    created_courses = 0
    lecturer_by_name = {u.name: u for u in User.query.filter_by(role="lecturer").all()}

    # --- Lecturers tab: Name | PIN | Course | Room | Start time | Days | Email ---
    for row in lecturers_ws.iter_rows(min_row=2, values_only=True):
        name = (row[0] or "").strip() if row and row[0] else ""
        if not name or name in lecturer_by_name:
            continue

        pin = str(row[1]).strip() if len(row) > 1 and row[1] not in (None, "") else None
        email = None
        if len(row) > 6 and row[6]:
            candidate = str(row[6]).strip().lower()
            if "@" in candidate:
                email = candidate

        user = User(
            name=name,
            email=email or f"pending+{abs(hash(name))}@example.invalid",
            role="lecturer",
            status="invited",
            pin_legacy=pin,
        )
        db.session.add(user)
        db.session.flush()
        lecturer_by_name[name] = user
        created_lecturers += 1

    db.session.commit()

    # --- Timetable tab: Lecturer | Course | Room | Days | Start | End | Sessions ---
    existing_pairs = {
        (t.lecturer_id, t.course_name)
        for t in Timetable.query.all()
    }

    for row in timetable_ws.iter_rows(min_row=2, values_only=True):
        lecturer_name = (row[0] or "").strip() if row and row[0] else ""
        course_name = (row[1] or "").strip() if len(row) > 1 and row[1] else ""
        if not lecturer_name or not course_name:
            continue

        lecturer = lecturer_by_name.get(lecturer_name)
        if not lecturer:
            print(f"Skipping course '{course_name}': lecturer '{lecturer_name}' not found")
            continue

        if (lecturer.id, course_name) in existing_pairs:
            continue

        room = (str(row[2]).strip() if len(row) > 2 and row[2] else None)
        days_raw = (str(row[3]).strip() if len(row) > 3 and row[3] else None)
        start_time = _parse_time(row[4]) if len(row) > 4 else None
        end_time = _parse_time(row[5]) if len(row) > 5 else None
        sessions = int(row[6]) if len(row) > 6 and row[6] else 1

        db.session.add(Timetable(
            lecturer_id=lecturer.id,
            course_name=course_name,
            room=room,
            days=days_raw,
            start_time=start_time,
            end_time=end_time,
            sessions=sessions,
        ))
        existing_pairs.add((lecturer.id, course_name))
        created_courses += 1

    db.session.commit()

    print(f"Imported {created_lecturers} new lecturers and {created_courses} new timetable rows.")
    print("Room/Days/Start/End were blank in the source sheet for most rows -- "
          "open Admin > Timetable to fill those in before check-in can work for those classes.")
    print("Lecturers without a real email got a placeholder @example.invalid address -- "
          "edit each lecturer in Admin > Lecturers to set their real email and send the activation invite.")
