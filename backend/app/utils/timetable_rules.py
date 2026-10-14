"""Timetable rules: clashes, the faculty's daily periods, session durations,
and each course's planned / held / remaining sessions.

Clashes: two classes clash when they share a weekday, their times overlap
and they have the same lecturer or the same room. A combined class (one
lecturer teaching two batches together in one room) is a deliberate
"clash": entering it needs an explicit confirmation, and it is listed so it
can be checked. Classes with no lecturer or no room only clash on what they
do have.

Planned sessions per course come from the approved timetable (meetings in
the semester, minus no-class dates) or the admin's per-class override; the
faculty's standard (Settings: default_course_sessions, 34) is the target the
reports compare against. Held sessions come from the same session rows as
the attendance reports, so every report agrees.
"""
from collections import defaultdict
from datetime import date as date_cls, datetime, time, timedelta

from app.models import Timetable
from app.utils.settings import get_all_settings, get_setting_int, get_setting_str
from app.utils.validation import ValidationError

STANDARD_DURATIONS = (1.5, 2, 2.5, 3)  # hours


def _overlap(a_start, a_end, b_start, b_end) -> bool:
    if not (a_start and b_start):
        return False
    a_end = a_end or (datetime.combine(date_cls.today(), a_start) + timedelta(hours=1)).time()
    b_end = b_end or (datetime.combine(date_cls.today(), b_start) + timedelta(hours=1)).time()
    return a_start < b_end and b_start < a_end


def find_clashes(lecturer_id, room, days, start, end, exclude_id=None, entries=None) -> list[dict]:
    """Other classes this one would clash with."""
    days = set(days or [])
    room_key = (room or "").strip().lower()
    out = []
    for e in entries if entries is not None else Timetable.query.filter(Timetable.start_time.isnot(None)).all():
        if exclude_id is not None and e.id == exclude_id:
            continue
        shared = days & set(e.day_list())
        if not shared or not _overlap(start, end, e.start_time, e.end_time):
            continue
        reasons = []
        if lecturer_id and e.lecturer_id == lecturer_id:
            reasons.append("lecturer")
        if room_key and (e.room or "").strip().lower() == room_key:
            reasons.append("room")
        if reasons:
            out.append({
                "id": e.id, "course_name": e.course_name, "batch": e.batch, "room": e.room,
                "lecturer_name": e.lecturer.name if e.lecturer else None,
                "days": sorted(shared, key=["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"].index),
                "time": f"{e.start_time:%H:%M}–{e.end_time:%H:%M}" if e.end_time else f"{e.start_time:%H:%M}",
                "clash": reasons,
            })
    return out


def clash_message(clashes) -> str:
    parts = []
    for c in clashes[:3]:
        what = " and ".join("the same lecturer" if r == "lecturer" else f"room {c['room']}" for r in c["clash"])
        parts.append(f"{c['course_name']} ({c['batch'] or 'no class'}) on {', '.join(c['days'])} {c['time']} uses {what}")
    more = f" and {len(clashes) - 3} more" if len(clashes) > 3 else ""
    return ("This clashes with " + "; ".join(parts) + more +
            ". Change the time, room or lecturer, or confirm it is one combined class taught together.")


def all_clashes() -> list[dict]:
    """Every clashing pair in the current timetable (each pair once)."""
    entries = Timetable.query.filter(Timetable.start_time.isnot(None)).all()
    seen, out = set(), []
    for e in entries:
        for c in find_clashes(e.lecturer_id, e.room, e.day_list(), e.start_time, e.end_time, exclude_id=e.id, entries=entries):
            key = tuple(sorted((e.id, c["id"])))
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "a": {"id": e.id, "course_name": e.course_name, "batch": e.batch, "room": e.room,
                      "lecturer_name": e.lecturer.name if e.lecturer else None,
                      "time": f"{e.start_time:%H:%M}–{e.end_time:%H:%M}" if e.end_time else f"{e.start_time:%H:%M}"},
                "b": c, "days": c["days"], "clash": c["clash"],
            })
    return out


def plan_clashes(classes: list[dict]) -> list[str]:
    """Clash warnings for a timetable upload (classes as the upload builds them)."""
    warnings = []
    for i, a in enumerate(classes):
        for b in classes[i + 1:]:
            shared = set(a["days"]) & set(b["days"])
            if not shared or not _overlap(a["start"], a["end"], b["start"], b["end"]):
                continue
            same_lecturer = a.get("lecturer_id") and a.get("lecturer_id") == b.get("lecturer_id")
            same_room = (a.get("room") or "").strip().lower() and (a.get("room") or "").strip().lower() == (b.get("room") or "").strip().lower()
            if same_lecturer or same_room:
                what = " and ".join(x for x, on in (("same lecturer", same_lecturer), (f"room {a.get('room')}", same_room)) if on)
                warnings.append(f"Clash ({what}): {a['course']} ({a['batch']}) and {b['course']} ({b['batch']}) on "
                                f"{', '.join(sorted(shared))} {a['start']:%H:%M}–{a['end']:%H:%M}")
    return warnings


# ---------- periods and durations ----------

def periods(settings=None) -> list[dict]:
    """The faculty's daily periods from Settings (e.g. 07:30-09:00,...)."""
    settings = settings if settings is not None else get_all_settings()
    out = []
    for i, raw in enumerate([p.strip() for p in (get_setting_str("timetable_periods", settings) or "").split(",") if p.strip()], 1):
        try:
            a, b = raw.split("-")
            start, end = datetime.strptime(a.strip(), "%H:%M").time(), datetime.strptime(b.strip(), "%H:%M").time()
        except ValueError:
            continue
        out.append({"number": i, "label": f"Period {i}", "start_time": f"{start:%H:%M}", "end_time": f"{end:%H:%M}",
                    "hours": round(_hours(start, end), 2)})
    return out


def clean_periods(value: str) -> str:
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    if not parts:
        raise ValidationError("Enter at least one period, e.g. 07:30-09:00")
    cleaned, last_end = [], None
    for p in parts:
        try:
            a, b = p.split("-")
            start, end = datetime.strptime(a.strip(), "%H:%M").time(), datetime.strptime(b.strip(), "%H:%M").time()
        except ValueError:
            raise ValidationError(f"'{p}' is not a period like 07:30-09:00")
        if end <= start:
            raise ValidationError(f"Period {p} ends before it starts")
        if last_end and start < last_end:
            raise ValidationError(f"Period {p} overlaps the period before it")
        last_end = end
        cleaned.append(f"{start:%H:%M}-{end:%H:%M}")
    return ",".join(cleaned)


def _hours(start: time, end: time | None) -> float:
    if not start or not end:
        return 0.0
    return (datetime.combine(date_cls.today(), end) - datetime.combine(date_cls.today(), start)).seconds / 3600


def end_from_duration(start: time, hours) -> time:
    try:
        hours = float(hours)
    except (TypeError, ValueError):
        raise ValidationError("Duration must be a number of hours, e.g. 1.5")
    if hours not in STANDARD_DURATIONS:
        raise ValidationError("Choose a duration of 1.5, 2, 2.5 or 3 hours, or enter the end time yourself")
    end = datetime.combine(date_cls.today(), start) + timedelta(hours=hours)
    if end.date() != date_cls.today():
        raise ValidationError("The class would end after midnight")
    return end.time()


# ---------- planned, held and remaining sessions ----------

def course_sessions(today: date_cls | None = None, batch: str | None = None, lecturer_id: int | None = None) -> dict:
    """Per class (timetable row): planned sessions for the semester, held,
    cancelled (lecturer officially absent), missed (unjustified), remaining,
    teaching hours and completion %, plus totals per course and class."""
    from app.utils.attendance_report import lecturer_session_rows
    from app.utils.batches import members
    from app.utils.student_status import _estimate_entry_sessions
    from app.utils.settings import get_no_class_dates

    settings = get_all_settings()
    today = today or date_cls.today()
    target = get_setting_int("default_course_sessions", settings)
    try:
        sem_start = date_cls.fromisoformat(get_setting_str("semester_start_date", settings))
        sem_end = date_cls.fromisoformat(get_setting_str("semester_end_date", settings))
    except ValueError:
        raise ValidationError("The semester dates in Settings are not valid dates")
    no_class = get_no_class_dates(settings)

    entries = Timetable.query.filter(Timetable.start_time.isnot(None)).all()
    if batch:
        entries = [e for e in entries if e.batch == batch or batch in members(e.batch)]
    if lecturer_id:
        entries = [e for e in entries if e.lecturer_id == lecturer_id]

    rows_by_entry = defaultdict(list)
    upto = min(today, sem_end)
    if upto >= sem_start:
        for r in lecturer_session_rows(sem_start, upto, lecturer_id=lecturer_id, batch=batch):
            if r.get("timetable_id"):
                rows_by_entry[r["timetable_id"]].append(r)

    out = []
    for e in sorted(entries, key=lambda e: (e.batch or "", e.course_name or "", e.start_time)):
        planned = e.semester_total_sessions or _estimate_entry_sessions(e, sem_start, sem_end, no_class)
        # Counted in sessions (periods): a double period is 2 of the planned sessions.
        rows = [r for r in rows_by_entry.get(e.id, []) if r["category"] != "not_yet"]
        per = e.sessions or 1
        held_meetings = sum(1 for r in rows if r["category"] in ("present", "late", "left_early", "no_checkout"))
        held = held_meetings * per
        cancelled = sum(per for r in rows if r["status"] == "lecturer_unavailable")
        missed = sum(per for r in rows if r["category"] in ("absent", "justified") and r["status"] != "lecturer_unavailable")
        scheduled = len(rows) * per
        hours = _hours(e.start_time, e.end_time)
        out.append({
            "timetable_id": e.id, "batch": e.batch, "course_name": e.course_name,
            "lecturer_name": e.lecturer.name if e.lecturer else None, "room": e.room, "days": ", ".join(e.day_list()),
            "time": f"{e.start_time:%H:%M}–{e.end_time:%H:%M}" if e.end_time else f"{e.start_time:%H:%M}",
            "duration_hours": round(hours, 2), "meetings_per_week": len(e.day_list()),
            "planned_sessions": planned, "planned_source": "set by admin" if e.semester_total_sessions else "from timetable",
            "sessions_per_meeting": per, "scheduled_so_far": scheduled, "held_sessions": held,
            "cancelled_sessions": cancelled, "missed_sessions": missed, "remaining_sessions": max(planned - scheduled, 0),
            "teaching_hours": round(held_meetings * hours, 1),
            "completion_percent": round(held * 100 / planned, 1) if planned else None,
        })
    by_course = defaultdict(lambda: {"planned_sessions": 0, "held_sessions": 0, "cancelled_sessions": 0,
                                     "missed_sessions": 0, "remaining_sessions": 0, "teaching_hours": 0.0, "rows": 0})
    for r in out:
        c = by_course[(r["batch"], r["course_name"])]
        c.update(batch=r["batch"], course_name=r["course_name"], lecturer_name=r["lecturer_name"])
        for k in ("planned_sessions", "held_sessions", "cancelled_sessions", "missed_sessions", "remaining_sessions", "teaching_hours"):
            c[k] += r[k]
        c["rows"] += 1
    courses = []
    for c in by_course.values():
        c["teaching_hours"] = round(c["teaching_hours"], 1)
        c["completion_percent"] = round(c["held_sessions"] * 100 / c["planned_sessions"], 1) if c["planned_sessions"] else None
        c["target_sessions"] = target
        c["differs_from_target"] = c["planned_sessions"] != target
        courses.append(c)
    courses.sort(key=lambda c: (c["batch"] or "", c["course_name"] or ""))
    totals = {k: sum(c[k] for c in courses) for k in ("planned_sessions", "held_sessions", "cancelled_sessions",
                                                      "missed_sessions", "remaining_sessions")}
    totals["teaching_hours"] = round(sum(c["teaching_hours"] for c in courses), 1)
    totals["completion_percent"] = round(totals["held_sessions"] * 100 / totals["planned_sessions"], 1) if totals["planned_sessions"] else None
    return {"target_sessions": target, "semester": {"from": sem_start.isoformat(), "to": sem_end.isoformat(),
                                                    "name": get_setting_str("semester_name", settings)},
            "as_of": upto.isoformat(), "classes": out, "courses": courses, "totals": totals}
