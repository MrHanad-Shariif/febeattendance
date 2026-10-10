"""Session-level attendance reports for lecturers and students (daily,
monthly, semester or any date range), their summaries and the rankings.

Lecturers check in once a day (models.Attendance), so each of their
sessions is derived here from the timetable and the day's check-in/out:

  * a session a lecturer absence covers -> "Lecturer unavailable"
    (a justified absence when the absence is marked justified);
  * otherwise the check-in is measured against *that* session's start and
    the check-out against its end, with the same minute rules the daily
    status uses (Settings: late_after_minutes, absent_after_minutes,
    left_early_minutes);
  * a day with no row at all is "absent" once the absent deadline passes,
    exactly as the background job would record it.

Student rows come from student_attendance (one stored row per session);
sessions exempted by a lecturer absence are reported as "Class Session
Exempted" and never counted as absences.

Every row carries a `category` used for the summaries and filters:
present | late | absent | justified | left_early | no_checkout | exempted | not_yet
"""
from collections import defaultdict
from datetime import date as date_cls, datetime, timedelta

from app.models import Attendance, StudentAttendance, StudentClassChange, Timetable, User
from app.utils.absences import AbsenceIndex
from app.utils.batches import batch_filter, members
from app.utils.schedule import day_abbr, teaches_on
from app.utils.settings import get_all_settings, get_no_class_dates, get_setting_int, get_setting_str
from app.utils.status import minutes_between
from app.utils.validation import ValidationError, parse_iso_date, parse_month

CATEGORY_LABELS = {
    "present": "Present",
    "late": "Late",
    "absent": "Absent (unjustified)",
    "justified": "Justified absence",
    "left_early": "Left early",
    "no_checkout": "No check-out",
    "exempted": "Exempted",
    "not_yet": "Not yet",
}
LECTURER_STATUS_LABELS = {
    "on_time": "On time",
    "late": "Late",
    "absent": "Absent",
    "left_early": "Left early",
    "no_checkout": "No check-out",
    "lecturer_unavailable": "Lecturer Unavailable",
    "not_yet": "Not yet",
}
STUDENT_CATEGORY = {"on_time": "present", "late": "late", "absent": "absent", "present": "justified", "not_yet": "not_yet"}
MAX_RANGE_DAYS = 400


# ---------- periods ----------

def resolve_period(args, today: date_cls | None = None) -> dict:
    """period=daily|monthly|semester|range (+ date / month / from,to)."""
    today = today or date_cls.today()
    period = (args.get("period") or "daily").lower()
    if period == "daily":
        d = parse_iso_date(args["date"], "date") if args.get("date") else today
        return {"period": "daily", "from": d, "to": d, "label": d.strftime("%A %d %B %Y")}
    if period == "monthly":
        year, month = parse_month(args.get("month") or today.strftime("%Y-%m"))
        start = date_cls(year, month, 1)
        end = (date_cls(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1))
        return {"period": "monthly", "from": start, "to": end, "label": start.strftime("%B %Y")}
    if period == "semester":
        settings = get_all_settings()
        try:
            start = date_cls.fromisoformat(get_setting_str("semester_start_date", settings))
            end = date_cls.fromisoformat(get_setting_str("semester_end_date", settings))
        except ValueError:
            raise ValidationError("The semester dates in Settings are not valid dates")
        if args.get("from"):
            start = parse_iso_date(args["from"], "from")
        if args.get("to"):
            end = parse_iso_date(args["to"], "to")
        name = get_setting_str("semester_name", settings)
        return {"period": "semester", "from": start, "to": end,
                "label": f"{name} ({start:%d %b %Y} – {end:%d %b %Y})"}
    if period == "range":
        if not args.get("from") or not args.get("to"):
            raise ValidationError("Choose a start and an end date")
        start, end = parse_iso_date(args["from"], "from"), parse_iso_date(args["to"], "to")
        return {"period": "range", "from": start, "to": end, "label": f"{start:%d %b %Y} – {end:%d %b %Y}"}
    raise ValidationError("period must be daily, monthly, semester or range")


def _check_range(start: date_cls, end: date_cls):
    if end < start:
        raise ValidationError("The end date must be on or after the start date")
    if (end - start).days > MAX_RANGE_DAYS:
        raise ValidationError(f"A report can cover at most {MAX_RANGE_DAYS} days")


def _days(start: date_cls, end: date_cls):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _hhmm(dt):
    return dt.strftime("%H:%M") if dt else None


# ---------- lecturers ----------

def _lecturer_session_status(entry, d, record, settings, now):
    """(status, justified) for one session of a lecturer who was not covered
    by an absence, from the day's single check-in/out row."""
    start = datetime.combine(d, entry.start_time)
    end = datetime.combine(d, entry.end_time) if entry.end_time else None
    late_after = get_setting_int("late_after_minutes", settings)
    absent_after = get_setting_int("absent_after_minutes", settings)
    early_after = get_setting_int("left_early_minutes", settings)
    justified = bool(record and record.remarks and record.remarks.strip())

    if record is None or record.checkin_at is None:
        # Measured per session: a later class the same day is still "not
        # yet" even when the day row already says absent for the first one.
        deadline = start + timedelta(minutes=absent_after) if absent_after > 0 else (end or start)
        if now <= deadline:
            return "not_yet", False
        return "absent", justified

    checkin = record.checkin_at
    minutes_late = minutes_between(checkin, start)
    if end and checkin > end:
        return "absent", justified  # arrived after this session had ended
    if absent_after > 0 and minutes_late > absent_after:
        return "absent", justified
    status = "late" if late_after > 0 and minutes_late > late_after else "on_time"

    checkout = record.checkout_at
    if checkout is not None:
        if checkout <= start:
            return "absent", justified  # left before this session began
        if end and early_after > 0 and minutes_between(end, checkout) >= early_after:
            return "left_early", justified
    return status, justified


def _lecturer_category(status, justified):
    if status == "on_time":
        return "present"
    if status == "absent":
        return "justified" if justified else "absent"
    if status == "lecturer_unavailable":
        return "justified" if justified else "absent"
    return status  # late | left_early | no_checkout | not_yet


def lecturer_session_rows(date_from: date_cls, date_to: date_cls, lecturer_id: int | None = None,
                          batch: str | None = None, course: str | None = None) -> list[dict]:
    """One row per lecturer per scheduled session in the range, numbered
    1, 2, 3... within each lecturer's day."""
    _check_range(date_from, date_to)
    settings = get_all_settings()
    no_class_dates = get_no_class_dates(settings)
    now = datetime.now()
    index = AbsenceIndex.current()

    lecturers = User.query.filter_by(role="lecturer")
    if lecturer_id:
        lecturers = lecturers.filter_by(id=lecturer_id)
    lecturers = {u.id: u for u in lecturers.all()}
    if not lecturers:
        return []

    entries_by_lecturer = defaultdict(list)
    for e in Timetable.query.filter(Timetable.lecturer_id.in_(lecturers.keys()), Timetable.start_time.isnot(None)).all():
        entries_by_lecturer[e.lecturer_id].append(e)
    for lst in entries_by_lecturer.values():
        lst.sort(key=lambda e: e.start_time)

    records = {
        (r.lecturer_id, r.date): r
        for r in Attendance.query.filter(
            Attendance.lecturer_id.in_(lecturers.keys()),
            Attendance.date >= date_from, Attendance.date <= date_to,
        ).all()
    }

    rows = []
    for lid, lecturer in lecturers.items():
        entries = entries_by_lecturer.get(lid, [])
        for d in _days(date_from, date_to):
            day_entries = [e for e in entries if teaches_on(e, d, no_class_dates)]
            record = records.get((lid, d))
            if not day_entries:
                if record is not None:
                    # The timetable changed since: keep the saved day visible.
                    rows.append(_orphan_lecturer_row(lecturer, d, record))
                continue
            teaching = [e for e in day_entries if not index.covering(e, d)]
            last_teaching_id = teaching[-1].id if teaching else None
            for n, e in enumerate(day_entries, 1):
                absence = index.covering(e, d)
                review = index.review_item("lecturer", record.id) if record is not None else None
                kept = absence is not None and record is not None and (absence.id, "lecturer", record.id) in index.kept
                if absence is not None and not kept:
                    status, justified = "lecturer_unavailable", absence.justified
                    remarks = absence.reason_label + (f" — {absence.remarks}" if absence.remarks else "")
                    if record is not None and record.checkin_at:
                        remarks += " (lecturer checked in; flagged for review)"
                else:
                    status, justified = _lecturer_session_status(e, d, record, settings, now)
                    if (status not in ("absent", "not_yet") and record is not None and record.status == "no_checkout"
                            and e.id == last_teaching_id):
                        status = "no_checkout"
                    remarks = record.remarks if record is not None and record.remarks else None
                category = _lecturer_category(status, justified)
                if category not in ("absent", "justified", "left_early"):
                    justification = None
                else:
                    justification = "Justified" if justified else "Unjustified"
                start_dt = datetime.combine(d, e.start_time)
                end_dt = datetime.combine(d, e.end_time) if e.end_time else None
                rows.append({
                    "lecturer_id": lid,
                    "lecturer_name": lecturer.name,
                    "date": d.isoformat(),
                    "day": day_abbr(d),
                    "session_number": n,
                    "sessions_that_day": len(day_entries),
                    "timetable_id": e.id,
                    "class_name": e.batch or "—",
                    "course_name": e.course_name,
                    "room": e.room,
                    "periods": e.sessions or 1,
                    "scheduled_start": _hhmm(start_dt),
                    "scheduled_end": _hhmm(end_dt),
                    "scheduled_time": f"{_hhmm(start_dt)}–{_hhmm(end_dt)}" if end_dt else _hhmm(start_dt),
                    "checkin_at": _hhmm(record.checkin_at) if record is not None else None,
                    "checkout_at": _hhmm(record.checkout_at) if record is not None else None,
                    "status": status,
                    "status_label": _status_label(status, category, justified),
                    "category": category,
                    "category_label": CATEGORY_LABELS[category],
                    "justified": justified if category in ("absent", "justified", "left_early") else None,
                    "justification": justification,
                    "remarks": remarks,
                    "absence_id": absence.id if absence is not None else None,
                    "absence_reason": absence.reason_label if absence is not None else None,
                    "flagged_for_review": bool(review and review.resolution == "pending"),
                    "record_id": record.id if record is not None else None,
                })

    rows = [r for r in rows if (not batch or r["class_name"] == batch or batch in members(r["class_name"]))
            and (not course or r["course_name"] == course)]
    rows.sort(key=lambda r: (r["date"], r["lecturer_name"].lower(), r["session_number"]))
    return rows


def _status_label(status, category, justified):
    if status == "lecturer_unavailable":
        return "Lecturer Unavailable" + (" (justified)" if justified else " (unjustified)")
    if status in ("absent", "left_early"):
        return f"{LECTURER_STATUS_LABELS[status]} ({'justified' if justified else 'unjustified'})"
    return LECTURER_STATUS_LABELS.get(status, status)


def _orphan_lecturer_row(lecturer, d, record):
    justified = bool(record.remarks and record.remarks.strip())
    status = record.status
    category = _lecturer_category(status, justified)
    return {
        "lecturer_id": lecturer.id, "lecturer_name": lecturer.name, "date": d.isoformat(), "day": day_abbr(d),
        "session_number": 1, "sessions_that_day": 1, "timetable_id": None,
        "class_name": "—", "course_name": "(no longer on the timetable)", "room": None, "periods": 1,
        "scheduled_start": _hhmm(record.scheduled_start), "scheduled_end": _hhmm(record.scheduled_end),
        "scheduled_time": f"{_hhmm(record.scheduled_start)}–{_hhmm(record.scheduled_end)}" if record.scheduled_end else _hhmm(record.scheduled_start),
        "checkin_at": _hhmm(record.checkin_at), "checkout_at": _hhmm(record.checkout_at),
        "status": status, "status_label": _status_label(status, category, justified),
        "category": category, "category_label": CATEGORY_LABELS[category],
        "justified": justified if category in ("absent", "justified", "left_early") else None,
        "justification": ("Justified" if justified else "Unjustified") if category in ("absent", "justified", "left_early") else None,
        "remarks": record.remarks, "absence_id": None, "absence_reason": None,
        "flagged_for_review": False, "record_id": record.id,
    }


# ---------- students ----------

def batch_on(student_id: int, current_batch: str | None, d: date_cls, changes_by_student) -> str | None:
    """The class a student was registered in on date `d`, using the class
    correction log (the first correction after `d` holds the old class)."""
    for change in changes_by_student.get(student_id, ()):  # sorted oldest first
        if change.changed_at.date() > d:
            return change.old_batch
    return current_batch


def student_session_rows(date_from: date_cls, date_to: date_cls, student_id: int | None = None,
                         batch: str | None = None, course: str | None = None,
                         lecturer_id: int | None = None) -> list[dict]:
    _check_range(date_from, date_to)
    index = AbsenceIndex.current()
    settings = get_all_settings()
    no_class_dates = get_no_class_dates(settings)

    q = (StudentAttendance.query.join(Timetable, StudentAttendance.timetable_id == Timetable.id)
         .filter(StudentAttendance.date >= date_from, StudentAttendance.date <= date_to))
    if student_id:
        q = q.filter(StudentAttendance.student_id == student_id)
    if batch:
        q = q.filter(batch_filter(Timetable.batch, batch))
    if course:
        q = q.filter(Timetable.course_name == course)
    if lecturer_id:
        q = q.filter(Timetable.lecturer_id == lecturer_id)
    records = q.all()

    rows = []
    seen = set()
    for r in records:
        e = r.timetable_entry
        s = r.student
        if s is None or e is None:
            continue
        seen.add((r.student_id, r.timetable_id, r.date))
        absence = index.exempting("student", r, e, r.date)
        review = index.review_item("student", r.id)
        if absence is not None:
            category, status = "exempted", "exempted"
            label = "Class Session Exempted"
            remarks = (f"Lecturer unavailable ({absence.reason_label}). Recorded as "
                       f"{StudentAttendance.STATUS_LABELS.get(r.status, r.status)}.")
        else:
            status = r.status
            category = STUDENT_CATEGORY.get(r.status, "not_yet")
            label = "Justified absence" if r.status == "present" else StudentAttendance.STATUS_LABELS.get(r.status, r.status)
            remarks = r.remarks
        rows.append(_student_row(s, e, r.date, status, label, category, remarks,
                                 checkin=r.checkin_at, flagged=bool(review and review.resolution == "pending"),
                                 absence=absence))

    # Exempted sessions nobody has a stored row for (the normal case: the job
    # skips them) are listed for each student who was in that class then.
    if index.has_any():
        changes = defaultdict(list)
        for c in StudentClassChange.query.order_by(StudentClassChange.changed_at).all():
            changes[c.student_id].append(c)
        entries = Timetable.query.filter(Timetable.start_time.isnot(None), Timetable.lecturer_id.in_(list(index.by_lecturer))).all()
        if course:
            entries = [e for e in entries if e.course_name == course]
        if lecturer_id:
            entries = [e for e in entries if e.lecturer_id == lecturer_id]
        if batch:
            entries = [e for e in entries if e.batch == batch or batch in members(e.batch)]
        all_students = None
        today = date_cls.today()
        for e in entries:
            for d in _days(date_from, min(date_to, today)):
                if not teaches_on(e, d, no_class_dates):
                    continue
                absence = index.covering(e, d)
                if absence is None:
                    continue
                if all_students is None:
                    q = User.query.filter_by(role="student")
                    if student_id:
                        q = q.filter_by(id=student_id)
                    all_students = q.all()
                for s in all_students:
                    if (s.id, e.id, d) in seen:
                        continue
                    if s.status != "active" and not student_id:
                        continue
                    was_in = batch_on(s.id, s.batch, d, changes)
                    if not was_in or not (e.batch == was_in or was_in in members(e.batch)):
                        continue
                    if s.created_at and s.created_at.date() > d:
                        continue
                    rows.append(_student_row(
                        s, e, d, "exempted", "Class Session Exempted", "exempted",
                        f"Lecturer unavailable ({absence.reason_label}).", absence=absence,
                    ))

    rows.sort(key=lambda r: (r["date"], r["scheduled_start"] or "", r["class_name"], r["student_name"].lower()))
    return rows


def _student_row(s, e, d, status, label, category, remarks, checkin=None, flagged=False, absence=None):
    start = datetime.combine(d, e.start_time) if e.start_time else None
    end = datetime.combine(d, e.end_time) if e.end_time else None
    return {
        "student_id": s.id,
        "student_name": s.name,
        "student_id_number": s.student_id_number,
        "student_class": s.batch,
        "date": d.isoformat(),
        "day": day_abbr(d),
        "timetable_id": e.id,
        "class_name": e.batch or "—",
        "course_name": e.course_name,
        "lecturer_name": e.lecturer.name if e.lecturer else None,
        "scheduled_start": _hhmm(start),
        "scheduled_time": f"{_hhmm(start)}–{_hhmm(end)}" if end else _hhmm(start),
        "checkin_at": _hhmm(checkin),
        "status": status,
        "status_label": label,
        "category": category,
        "category_label": CATEGORY_LABELS[category],
        "justification": ("Justified" if category == "justified" else "Unjustified") if category in ("absent", "justified") else None,
        "remarks": remarks,
        "flagged_for_review": flagged,
        "absence_id": absence.id if absence is not None else None,
    }


def number_sessions(rows: list[dict]) -> list[dict]:
    """Session 1, 2, 3... per student per day (student rows are per class session)."""
    counter = defaultdict(int)
    for r in sorted(rows, key=lambda r: (r["date"], r["student_id"], r["scheduled_start"] or "")):
        counter[(r["date"], r["student_id"])] += 1
        r["session_number"] = counter[(r["date"], r["student_id"])]
    return rows


# ---------- summaries ----------

COUNTED = ("present", "late", "absent", "justified", "left_early", "no_checkout")


def _pct(n, d):
    return round(n * 100.0 / d, 1) if d else None


def summarize(rows: list[dict], key: str, name_key: str, extra_keys=()) -> dict:
    """Totals and per-person counts. Percentages are over counted sessions:
    every session that has happened, minus exempted ones."""
    def blank():
        return {c: 0 for c in CATEGORY_LABELS}

    totals = blank()
    people = {}
    for r in rows:
        totals[r["category"]] += 1
        p = people.get(r[key])
        if p is None:
            p = people[r[key]] = {"id": r[key], "name": r[name_key], **{k: r.get(k) for k in extra_keys}, **blank()}
        p[r["category"]] += 1

    def finish(c):
        counted = sum(c[k] for k in COUNTED)
        attended = c["present"] + c["late"] + c["left_early"] + c["no_checkout"]
        c["counted_sessions"] = counted
        c["scheduled_sessions"] = counted + c["exempted"] + c["not_yet"]
        c["attended"] = attended
        c["attendance_rate"] = _pct(attended, counted)
        c["present_rate"] = _pct(c["present"], counted)
        c["late_rate"] = _pct(c["late"], counted)
        c["absent_rate"] = _pct(c["absent"], counted)
        c["justified_rate"] = _pct(c["justified"], counted)
        return c

    finish(totals)
    per_person = sorted((finish(p) for p in people.values()), key=lambda p: (p["name"] or "").lower())
    return {"totals": totals, "rows": per_person}


# ---------- rankings ----------

def _rank(items, key, reverse=False, limit=3):
    """Top `limit` by `key`, extended to include everyone tied with the
    last place; each item gets rank and tie flags."""
    ordered = sorted(items, key=key, reverse=reverse)
    out, rank, prev = [], 0, object()
    for i, item in enumerate(ordered):
        k = key(item)
        if k != prev:
            rank = i + 1
            prev = k
        if rank > limit:
            break
        out.append({**item, "rank": rank})
    for item in out:
        item["tied"] = sum(1 for o in out if o["rank"] == item["rank"]) > 1
    return out


def lecturer_rankings(rows: list[dict], min_sessions: int = 5) -> dict:
    """Best and worst lecturers over the period. Rates are per accountable
    session (held sessions minus justified absences), so heavy and light
    teaching loads compare fairly, and justified absences are never a
    penalty. Lecturers with fewer than `min_sessions` accountable sessions
    are listed as insufficient data instead of ranked."""
    summary = summarize(rows, "lecturer_id", "lecturer_name")["rows"]
    eligible, insufficient = [], []
    for p in summary:
        accountable = p["counted_sessions"] - p["justified"]
        stats = {
            "lecturer_id": p["id"],
            "lecturer_name": p["name"],
            "scheduled_sessions": p["scheduled_sessions"],
            "counted_sessions": p["counted_sessions"],
            "accountable_sessions": accountable,
            "on_time": p["present"],
            "late": p["late"],
            "unjustified_absences": p["absent"],
            "justified_absences": p["justified"],
            "left_early": p["left_early"],
            "on_time_rate": _pct(p["present"], accountable),
            "attendance_rate": _pct(p["attended"], accountable),
            "unjustified_absence_rate": _pct(p["absent"], accountable),
            "late_rate": _pct(p["late"], accountable),
        }
        (eligible if accountable >= min_sessions else insufficient).append(stats)

    best_key = lambda s: (-(s["on_time_rate"] or 0), s["unjustified_absence_rate"] or 0, s["late_rate"] or 0)
    return {
        "min_sessions": min_sessions,
        "method": ("Ranked by on-time rate, then lowest unjustified-absence rate, then lowest lateness rate. "
                   "Rates are per accountable session (held sessions minus justified absences)."),
        "top": _rank(eligible, best_key),
        "highest_absence_rate": _rank([s for s in eligible if s["unjustified_absences"]],
                                      lambda s: -(s["unjustified_absence_rate"] or 0)),
        "most_unjustified_absences": _rank([s for s in eligible + insufficient if s["unjustified_absences"]],
                                           lambda s: -s["unjustified_absences"]),
        "most_late": _rank([s for s in eligible + insufficient if s["late"]], lambda s: -s["late"]),
        "insufficient_data": sorted(insufficient, key=lambda s: s["lecturer_name"].lower()),
        "eligible_count": len(eligible),
    }


def student_rankings(rows: list[dict], late_threshold: int = 3, min_sessions: int = 5, limit: int = 10) -> dict:
    summary = summarize(rows, "student_id", "student_name", extra_keys=("student_id_number", "student_class"))["rows"]
    people = []
    for p in summary:
        people.append({
            "student_id": p["id"], "student_name": p["name"], "student_id_number": p["student_id_number"],
            "student_class": p["student_class"], "counted_sessions": p["counted_sessions"],
            "present": p["present"], "late": p["late"], "absent": p["absent"], "justified": p["justified"],
            "exempted": p["exempted"], "absent_rate": p["absent_rate"], "late_rate": p["late_rate"],
            "attendance_rate": p["attendance_rate"],
        })
    eligible = [p for p in people if p["counted_sessions"] >= min_sessions]
    return {
        "late_threshold": late_threshold,
        "min_sessions": min_sessions,
        "repeated_lateness": _rank([p for p in people if p["late"] >= late_threshold], lambda p: -p["late"], limit=limit),
        "frequent_absences": _rank([p for p in eligible if p["absent"]], lambda p: -(p["absent_rate"] or 0), limit=limit),
        "insufficient_data": len(people) - len(eligible),
    }


def student_warnings(batch: str | None = None) -> dict:
    """Per-course semester standing (the official 25 % rule, see
    student_status.compute_course_stats): students at or past the warning
    level (60 % of the threshold) or already past the threshold. Every row
    is loaded in one query and run through the same formula."""
    from sqlalchemy.orm import contains_eager

    from app.utils.student_status import stats_from_records

    settings = get_all_settings()
    threshold = get_setting_int("student_absence_threshold_percent", settings)
    warn_at = round(threshold * 0.6, 1)
    q = User.query.filter_by(role="student", status="active")
    if batch:
        q = q.filter(User.batch.in_(members(batch)))
    students = {s.id: s for s in q.all()}
    if not students:
        return {"threshold_percent": threshold, "warning_percent": warn_at, "rows": []}

    grouped = defaultdict(list)
    rows_q = (StudentAttendance.query.join(Timetable, StudentAttendance.timetable_id == Timetable.id)
              .options(contains_eager(StudentAttendance.timetable_entry))
              .filter(StudentAttendance.student_id.in_(students.keys()), Timetable.batch.isnot(None)))
    for r in rows_q.all():
        grouped[(r.student_id, r.timetable_entry.batch, r.timetable_entry.course_name)].append(r)

    planned_cache = {}
    out = []
    for (sid, cls, course), records in grouped.items():
        stats = stats_from_records(records, cls, course, settings, planned_cache)
        if stats["absence_percentage"] >= warn_at and stats["effective_absences"] > 0:
            s = students[sid]
            out.append({
                "student_id": s.id, "student_name": s.name, "student_id_number": s.student_id_number,
                "student_class": s.batch, "class_name": cls, "course_name": course,
                "effective_absences": stats["effective_absences"], "absent": stats["absent"],
                "late": stats["late"], "total_sessions": stats["total_sessions"],
                "absence_percentage": stats["absence_percentage"],
                "level": "blocked" if stats["blocked"] else "warning",
                "level_label": "Over the limit (retake)" if stats["blocked"] else "Warning",
            })
    out.sort(key=lambda r: (-r["absence_percentage"], r["student_name"].lower()))
    return {"threshold_percent": threshold, "warning_percent": warn_at, "rows": out}
