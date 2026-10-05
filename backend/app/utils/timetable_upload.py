"""Timetable upload from the faculty's Excel workbook.

Each sheet is one batch (the sheet name, or the "Class Name" cell at the top),
laid out as a Day / Time / Instructor / Subject / Room grid. The Day cell is
usually merged over several time slots, so a blank Day means "same day as the
row above". Every row with a subject is imported; a row with no instructor,
or one whose instructor isn't a lecturer in the system yet, is imported as
"not assigned" and listed in the preview so the admin can fix it.

Back-to-back slots of the same class are merged into one timetable row with a
`sessions` count, and the same block on several days becomes one row with a
day list -- the same shape as rows added by hand.

The upload replaces the whole timetable. A class that is unchanged (same
batch, course, lecturer, days and start time) keeps its row, and so its
attendance history; a removed class that already has attendance is only
deleted when the admin explicitly agrees. Missing batches, rooms and courses
are added to their lists as part of the upload.
"""
import datetime as dt
import io
import zipfile

import openpyxl

from app.extensions import db
from app.importers.import_confirmed_timetable import (
    DAY_NORMALIZE, NAME_CORRECTIONS, combine_days, format_room, merge_contiguous, norm, parse_time_range,
    resolve_lecturer_name,
)
from app.models import (
    Batch, BoardCodeAttempt, BoardSession, Course, FaceCheckAttempt, Room, StudentAttendance, Timetable, User,
)
from app.utils.batches import members
from app.utils.settings import get_setting_str
from app.utils.validation import ValidationError

HEADER_ALIASES = {
    "day": {"day", "days"},
    "time": {"time", "period", "time slot", "slot"},
    "instructor": {"instructor", "lecturer", "teacher", "instructor name", "lecturer name"},
    "subject": {"subject", "course", "course name", "module", "subject name"},
    "room": {"room", "rooms", "class room", "classroom", "venue", "hall", "room no", "room number"},
}
DAY_ORDER = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]


# ---------- Batches ----------

def student_batch_codes() -> list[str]:
    """Single batch codes a student can belong to: the Batches list plus any
    batch in the timetable, with shared classes split into their members."""
    codes = {b.code for b in Batch.query.all()}
    codes |= {r[0] for r in Timetable.query.with_entities(Timetable.batch).distinct() if r[0]}
    return sorted({m for code in codes for m in members(code)})


def _ensure_batches(codes) -> int:
    existing = {b.code for b in Batch.query.all()}
    added = 0
    for code in sorted({c for c in codes if c}):
        for item in [code, *members(code)]:
            if item not in existing:
                db.session.add(Batch(code=item))
                existing.add(item)
                added += 1
    return added


def backfill_batches():
    """Fill the Batches list from students, timetable and courses (run on start)."""
    codes = {r[0] for r in User.query.filter_by(role="student").with_entities(User.batch).distinct() if r[0]}
    codes |= {r[0] for r in Timetable.query.with_entities(Timetable.batch).distinct() if r[0]}
    codes |= {r[0] for r in Course.query.with_entities(Course.batch).distinct() if r[0]}
    _ensure_batches(codes)
    db.session.commit()


# ---------- Reading the workbook ----------

def _text(value) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def _find_layout(ws):
    """(header row, {field: column}, class name or None) from the top of a sheet."""
    class_name = None
    for row in ws.iter_rows(min_row=1, max_row=min(20, ws.max_row)):
        cells = [(c.column, _text(c.value)) for c in row if c.value is not None and _text(c.value)]
        lowered = {text.lower().rstrip(":"): col for col, text in cells}
        if "class name" in lowered or "class" in lowered or "batch" in lowered:
            label_col = lowered.get("class name") or lowered.get("class") or lowered.get("batch")
            after = [text for col, text in cells if col > label_col]
            if after and not class_name:
                class_name = after[0]
        columns = {}
        for field, aliases in HEADER_ALIASES.items():
            col = next((lowered[a] for a in aliases if a in lowered), None)
            if col:
                columns[field] = col
        if {"day", "time", "subject"} <= columns.keys():
            return row[0].row, columns, class_name
    return None, None, class_name


def _cell(ws, row, col):
    return ws.cell(row=row, column=col).value if col else None


def read_workbook(data: bytes) -> dict:
    """Parse the uploaded workbook into class records (nothing is saved)."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except (zipfile.BadZipFile, KeyError, OSError, ValueError):
        raise ValidationError("That isn't a readable Excel workbook. Save it as .xlsx and upload it again.")

    sheets, skipped, warnings, records = [], [], [], []
    for ws in wb.worksheets:
        header_row, columns, class_name = _find_layout(ws)
        if header_row is None:
            skipped.append(ws.title.strip())
            continue
        # The sheet name is the batch; a different "Class Name" cell is
        # usually a copy-paste slip, so it is only reported.
        batch = ws.title.strip().replace(" & ", "&")
        if class_name and class_name.replace(" & ", "&") != batch:
            warnings.append(f"Sheet {batch}: its Class Name cell says '{class_name}'. The sheet name {batch} was used.")
        found = 0
        current_day = None
        for r in range(header_row + 1, ws.max_row + 1):
            raw_day = _text(_cell(ws, r, columns["day"]))
            if raw_day:
                current_day = DAY_NORMALIZE.get(raw_day.lower())
                if current_day is None and len(raw_day) > 12:
                    break  # a note under the table ("NB: ...") ends it
                if current_day is None:
                    warnings.append(f"{ws.title.strip()} row {r}: unknown day '{raw_day}', rows under it were skipped")
            subject = _text(_cell(ws, r, columns["subject"]))
            if not subject:
                continue
            time_value = _cell(ws, r, columns["time"])
            start, end = parse_time_range(time_value)
            if not start or not end:
                warnings.append(f"{ws.title.strip()} row {r}: couldn't read the time '{_text(time_value)}' for {subject}")
                continue
            if current_day is None:
                continue
            if end <= start:
                warnings.append(f"{ws.title.strip()} row {r}: end time is before the start time for {subject}")
                continue
            records.append({
                "sheet": ws.title.strip(), "row": r, "batch": batch, "day": current_day, "start": start, "end": end,
                "lecturer": _text(_cell(ws, r, columns.get("instructor"))), "course": subject,
                "room": format_room(_cell(ws, r, columns.get("room"))),
            })
            found += 1
        sheets.append({"sheet": ws.title.strip(), "batch": batch, "slots": found})
    if not records:
        raise ValidationError("No classes were found. Each sheet needs a header row with Day, Time, Subject "
                              "(and Instructor, Room) columns.")
    return {"sheets": sheets, "skipped_sheets": skipped, "warnings": warnings, "records": records}


# ---------- Matching and planning ----------

def _resolve_lecturers(records: list[dict]) -> list[dict]:
    """Set lecturer_id on each record; unknown names stay unassigned."""
    lecturers = User.query.filter_by(role="lecturer").all()
    by_name = {u.name: u for u in lecturers}
    names = list(by_name)
    known = {norm(n) for n in names} | set(NAME_CORRECTIONS)
    unknown: dict[str, dict] = {}
    for rec in records:
        # Instructor and Subject typed in each other's column.
        if rec["lecturer"] and norm(rec["lecturer"]) not in known and norm(rec["course"]) in known:
            rec["lecturer"], rec["course"] = rec["course"], rec["lecturer"]
        canonical = resolve_lecturer_name(rec["lecturer"], names) if rec["lecturer"] else None
        rec["lecturer_id"] = by_name[canonical].id if canonical else None
        rec["excel_instructor"] = rec["lecturer"]
        rec["lecturer"] = canonical or ""
        if rec["excel_instructor"] and not canonical:
            item = unknown.setdefault(norm(rec["excel_instructor"]), {"name": rec["excel_instructor"], "classes": set()})
            item["classes"].add(f"{rec['course']} ({rec['batch']})")
    return [{"name": u["name"], "classes": sorted(u["classes"])} for u in unknown.values()]


def _key(batch, course, lecturer_id, days, start):
    return (batch, course.lower(), lecturer_id, days or "", start.strftime("%H:%M") if start else "")


def build_plan(data: bytes) -> dict:
    parsed = read_workbook(data)
    unknown = _resolve_lecturers(parsed["records"])
    # Merge on the matched lecturer; keep the Excel name for unassigned rows.
    for rec in parsed["records"]:
        rec["lecturer"] = rec["lecturer"] or f"?{rec['excel_instructor']}"
    classes = combine_days(merge_contiguous(parsed["records"]))
    for c in classes:
        c["days"] = sorted(c["days"], key=DAY_ORDER.index)
        c["days_text"] = ",".join(c["days"])

    old_rows = Timetable.query.all()
    old_by_key = {}
    for row in old_rows:
        old_by_key.setdefault(_key(row.batch, row.course_name, row.lecturer_id, row.days, row.start_time), row)
    kept_ids = set()
    for c in classes:
        match = old_by_key.get(_key(c["batch"], c["course"], c["lecturer_id"], c["days_text"], c["start"]))
        if match and match.id not in kept_ids:
            c["keep_id"] = match.id
            kept_ids.add(match.id)
    removed = [r for r in old_rows if r.id not in kept_ids]
    removed_ids = [r.id for r in removed]
    with_history = (
        {r[0] for r in db.session.query(StudentAttendance.timetable_id).filter(StudentAttendance.timetable_id.in_(removed_ids)).distinct()}
        if removed_ids else set()
    )

    rooms = {r.name for r in Room.query.all()}
    courses = {(c.name.lower(), c.batch, c.lecturer_id) for c in Course.query.all()}
    batches = {b.code for b in Batch.query.all()}
    return {
        **parsed,
        "classes": classes,
        "unknown_instructors": unknown,
        "removed": removed,
        "removed_with_history": [r for r in removed if r.id in with_history],
        "new_rooms": sorted({c["room"] for c in classes if c["room"] and c["room"] not in rooms}),
        "new_batches": sorted({b for c in classes for b in [c["batch"], *members(c["batch"])] if b not in batches}),
        "new_courses": sorted({(c["course"], c["batch"], c["lecturer_id"]) for c in classes
                               if (c["course"].lower(), c["batch"], c["lecturer_id"]) not in courses},
                              key=lambda t: (t[1], t[0])),
    }


def _class_view(c: dict) -> dict:
    return {
        "batch": c["batch"], "course_name": c["course"], "days": c["days"], "sessions": c["sessions"],
        "start_time": c["start"].strftime("%H:%M"), "end_time": c["end"].strftime("%H:%M"), "room": c["room"],
        "lecturer_id": c["lecturer_id"], "lecturer_name": c["lecturer"] if c["lecturer_id"] else None,
        "excel_instructor": c["excel_instructor"] or None, "unchanged": "keep_id" in c,
    }


def plan_summary(plan: dict) -> dict:
    """What the upload will do, for the preview."""
    return {
        "sheets": plan["sheets"],
        "skipped_sheets": plan["skipped_sheets"],
        "warnings": plan["warnings"],
        "unknown_instructors": plan["unknown_instructors"],
        "classes": [_class_view(c) for c in plan["classes"]],
        "counts": {
            "classes": len(plan["classes"]),
            "batches": len({c["batch"] for c in plan["classes"]}),
            "unassigned": sum(1 for c in plan["classes"] if not c["lecturer_id"]),
            "unchanged": sum(1 for c in plan["classes"] if "keep_id" in c),
            "removed": len(plan["removed"]),
            "removed_with_history": len(plan["removed_with_history"]),
            "new_rooms": len(plan["new_rooms"]),
            "new_batches": len(plan["new_batches"]),
            "new_courses": len(plan["new_courses"]),
        },
        "removed_with_history": [
            f"{r.course_name} ({r.batch or 'no batch'}) – {r.lecturer.name if r.lecturer else 'not assigned'}"
            for r in plan["removed_with_history"]
        ],
        "new_rooms": plan["new_rooms"],
        "new_batches": plan["new_batches"],
    }


def apply_plan(plan: dict, delete_history: bool) -> dict:
    if plan["removed_with_history"] and not delete_history:
        raise ValidationError(
            f"{len(plan['removed_with_history'])} class(es) that this upload removes already have student "
            "attendance. Tick 'Also delete their attendance' to go ahead.", status=409)

    summary = plan_summary(plan)  # before the removed rows are gone
    removed_ids = [r.id for r in plan["removed"]]
    if removed_ids:
        for model in (BoardCodeAttempt, FaceCheckAttempt, BoardSession, StudentAttendance):
            model.query.filter(model.timetable_id.in_(removed_ids)).delete(synchronize_session=False)
        Timetable.query.filter(Timetable.id.in_(removed_ids)).delete(synchronize_session=False)

    for c in plan["classes"]:
        note = f"Instructor in the uploaded timetable: {c['excel_instructor']}" if c["excel_instructor"] and not c["lecturer_id"] else None
        fields = {
            "lecturer_id": c["lecturer_id"], "course_name": c["course"], "batch": c["batch"], "room": c["room"],
            "days": c["days_text"] or None, "start_time": c["start"], "end_time": c["end"], "sessions": c["sessions"],
        }
        if "keep_id" in c:
            row = db.session.get(Timetable, c["keep_id"])
            for key, value in fields.items():
                setattr(row, key, value)
            if note or (row.note or "").startswith("Instructor in the uploaded timetable"):
                row.note = note
        else:
            db.session.add(Timetable(note=note, **fields))

    for name in plan["new_rooms"]:
        db.session.add(Room(name=name))
    _ensure_batches(c["batch"] for c in plan["classes"])
    semester = get_setting_str("semester_name")
    for name, batch, lecturer_id in plan["new_courses"]:
        db.session.add(Course(name=name, batch=batch, lecturer_id=lecturer_id, semester=semester))
    db.session.commit()
    return summary


# ---------- One batch's week ----------

def week_start_for(d: dt.date) -> dt.date:
    """The Saturday that starts the teaching week containing `d`."""
    return d - dt.timedelta(days=(d.weekday() - 5) % 7)
