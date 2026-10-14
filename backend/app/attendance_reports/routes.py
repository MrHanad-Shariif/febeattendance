"""Attendance reports for lecturers and students, in Summary and Detailed
form, the flexible rankings and the semester warnings, and the same reports
as branded PDF or Excel downloads (RBAC: reports:view).

Query parameters shared by every endpoint:
  period=daily|weekly|monthly|semester|academic_year|all|range
  date=YYYY-MM-DD  month=YYYY-MM  year=YYYY  from=…  to=…
  lecturer_id, student_id, batch (class), course, department, category=present,late,…
Exports also take format=pdf|xlsx.
"""
from datetime import datetime

from flask import jsonify, request

from app.attendance_reports import attendance_reports_bp
from app.models import Timetable, User
from app.utils.attendance_report import (
    CATEGORY_LABELS, lecturer_rankings, lecturer_session_rows, number_sessions, resolve_period,
    student_rankings, student_session_rows, student_warnings, summarize,
)
from app.utils.authz import permission_required
from app.utils.settings import get_all_settings
from app.utils.validation import ValidationError, clean_int
from app.utils import rankings as rk
from app.utils import report_export as rx

DETAIL_LIMIT = 3000

LECTURER_DETAIL_COLUMNS = [
    ("date", "Date", 11), ("day", "Day", 6), ("lecturer_name", "Lecturer", 24), ("session_number", "Session", 8),
    ("class_name", "Class", 12), ("course_name", "Course / subject", 30), ("scheduled_time", "Scheduled time", 13),
    ("checkin_at", "Check-in", 9), ("checkout_at", "Check-out", 9), ("status_label", "Status", 22),
    ("justification", "Justification", 13), ("remarks", "Remarks", 36),
]
LECTURER_SUMMARY_COLUMNS = [
    ("name", "Lecturer", 26), ("scheduled_sessions", "Scheduled sessions", 11), ("counted_sessions", "Counted sessions", 10),
    ("present", "Present (on time)", 10), ("late", "Late", 8), ("absent", "Absent (unjustified)", 12),
    ("justified", "Justified absence", 11), ("left_early", "Left early", 9), ("no_checkout", "No check-out", 9),
    ("present_rate", "On-time %", 9), ("late_rate", "Late %", 8), ("absent_rate", "Unjustified absence %", 12),
    ("justified_rate", "Justified %", 10), ("attendance_rate", "Attendance %", 11),
]
STUDENT_DETAIL_COLUMNS = [
    ("date", "Date", 11), ("day", "Day", 6), ("student_name", "Student", 24), ("student_id_number", "ID number", 13),
    ("session_number", "Session", 8), ("class_name", "Class", 12), ("course_name", "Course / subject", 28),
    ("lecturer_name", "Lecturer", 20), ("scheduled_time", "Scheduled time", 13), ("checkin_at", "Check-in", 9),
    ("status_label", "Status", 20), ("justification", "Justification", 13), ("remarks", "Remarks / justification", 34),
]
STUDENT_SUMMARY_COLUMNS = [
    ("name", "Student", 26), ("student_id_number", "ID number", 13), ("student_class", "Class", 10),
    ("counted_sessions", "Counted sessions", 10), ("present", "Present", 9), ("late", "Late", 8),
    ("absent", "Absent (unjustified)", 12), ("justified", "Justified absence", 11), ("exempted", "Exempted sessions", 11),
    ("present_rate", "Present %", 9), ("late_rate", "Late %", 8), ("absent_rate", "Absent %", 9),
    ("justified_rate", "Justified %", 10), ("attendance_rate", "Attendance %", 11),
]


def _int_arg(name):
    v = request.args.get(name)
    return clean_int(v, name, minimum=1) if v else None


def _categories():
    raw = request.args.get("category") or ""
    cats = [c.strip() for c in raw.split(",") if c.strip()]
    bad = [c for c in cats if c not in CATEGORY_LABELS]
    if bad:
        raise ValidationError(f"Unknown category: {bad[0]}")
    return set(cats)


def _view():
    view = request.args.get("view") or "summary"
    if view not in ("summary", "detailed"):
        raise ValidationError("view must be summary or detailed")
    return view


def _scope_text(audience):
    parts = []
    if request.args.get("lecturer_id"):
        u = User.query.get(int(request.args["lecturer_id"]))
        parts.append(f"Lecturer: {u.name if u else '?'}")
    if request.args.get("student_id"):
        u = User.query.get(int(request.args["student_id"]))
        parts.append(f"Student: {u.name if u else '?'} ({u.student_id_number if u else ''})")
    if request.args.get("batch"):
        parts.append(f"Class: {request.args['batch']}")
    if request.args.get("course"):
        parts.append(f"Course: {request.args['course']}")
    if request.args.get("department"):
        parts.append(f"Department: {request.args['department']}")
    if request.args.get("category"):
        parts.append("Showing: " + ", ".join(CATEGORY_LABELS[c] for c in _categories()))
    return " · ".join(parts) or ("All lecturers" if audience == "lecturers" else "All students")


def _lecturer_data():
    period = resolve_period(request.args)
    rows = lecturer_session_rows(period["from"], period["to"], lecturer_id=_int_arg("lecturer_id"),
                                 batch=request.args.get("batch") or None, course=request.args.get("course") or None)
    cats = _categories()
    if cats:
        rows = [r for r in rows if r["category"] in cats]
    return period, rows


def _student_data():
    period = resolve_period(request.args)
    rows = student_session_rows(period["from"], period["to"], student_id=_int_arg("student_id"),
                                batch=request.args.get("batch") or None, course=request.args.get("course") or None,
                                lecturer_id=_int_arg("lecturer_id"))
    number_sessions(rows)
    cats = _categories()
    if cats:
        rows = [r for r in rows if r["category"] in cats]
    return period, rows


def _period_json(period):
    return {"period": period["period"], "from": period["from"].isoformat(), "to": period["to"].isoformat(),
            "label": period["label"]}


def _payload(period, rows, summary, view, audience):
    out = {
        "audience": audience,
        **_period_json(period),
        "scope": _scope_text(audience),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "view": view,
        "totals": summary["totals"],
        "categories": [{"value": k, "label": v} for k, v in CATEGORY_LABELS.items()],
    }
    if view == "summary":
        out["rows"] = summary["rows"]
    else:
        out["rows"] = rows[:DETAIL_LIMIT]
        out["total_rows"] = len(rows)
        out["truncated"] = len(rows) > DETAIL_LIMIT
    return out


@attendance_reports_bp.get("/options")
@permission_required("reports:view")
def report_options():
    settings = get_all_settings()
    lecturers = User.query.filter_by(role="lecturer").order_by(User.name).all()
    students = User.query.filter_by(role="student").order_by(User.name).all()
    pairs = Timetable.query.with_entities(Timetable.batch, Timetable.course_name).distinct().all()
    return jsonify({
        "lecturers": [{"id": u.id, "name": u.name} for u in lecturers],
        "students": [{"id": u.id, "name": u.name, "student_id_number": u.student_id_number, "batch": u.batch} for u in students],
        "batches": sorted({b for b, _ in pairs if b}),
        "courses": sorted({c for _, c in pairs if c}),
        "categories": [{"value": k, "label": v} for k, v in CATEGORY_LABELS.items()],
        "semester": {k: settings.get(k) for k in ("semester_name", "semester_start_date", "semester_end_date")},
    })


@attendance_reports_bp.get("/lecturers")
@permission_required("reports:view")
def lecturer_report():
    period, rows = _lecturer_data()
    return jsonify(_payload(period, rows, summarize(rows, "lecturer_id", "lecturer_name"), _view(), "lecturers"))


@attendance_reports_bp.get("/students")
@permission_required("reports:view")
def student_report():
    period, rows = _student_data()
    summary = summarize(rows, "student_id", "student_name", extra_keys=("student_id_number", "student_class"))
    return jsonify(_payload(period, rows, summary, _view(), "students"))


def _rankings():
    period = resolve_period(request.args)
    min_sessions = clean_int(request.args.get("min_sessions") or 5, "min_sessions", minimum=1, maximum=500)
    late_threshold = clean_int(request.args.get("late_threshold") or 3, "late_threshold", minimum=1, maximum=500)
    lect_rows = lecturer_session_rows(period["from"], period["to"])
    stud_rows = student_session_rows(period["from"], period["to"], batch=request.args.get("batch") or None)
    return period, {
        **_period_json(period),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "lecturers": lecturer_rankings(lect_rows, min_sessions=min_sessions),
        "students": student_rankings(stud_rows, late_threshold=late_threshold, min_sessions=min_sessions),
        "warnings": student_warnings(request.args.get("batch") or None),
    }


@attendance_reports_bp.get("/rankings")
@permission_required("reports:view")
def rankings():
    return jsonify(_rankings()[1])


def _ranking_data(audience: str):
    """The flexible ranking for `audience`: metric, order, limit (number or
    all), per_class, min_sessions, plus the shared period and filters."""
    period = resolve_period(request.args)
    department = request.args.get("department") or None
    if audience == "lecturers":
        rows = lecturer_session_rows(period["from"], period["to"], lecturer_id=_int_arg("lecturer_id"),
                                     batch=request.args.get("batch") or None, course=request.args.get("course") or None)
    elif audience == "students":
        rows = student_session_rows(period["from"], period["to"], student_id=_int_arg("student_id"),
                                    batch=request.args.get("batch") or None, course=request.args.get("course") or None,
                                    lecturer_id=_int_arg("lecturer_id"))
    else:
        raise ValidationError("audience must be lecturers or students")
    if department:
        rows = [r for r in rows if r.get("department") == department]
    data = rk.build_ranking(
        rows, audience,
        metric=request.args.get("metric") or None,
        order=request.args.get("order") or "best",
        limit=rk.clean_limit(request.args.get("limit")),
        per_class=request.args.get("per_class", "1") not in ("0", "false", "no"),
        min_sessions=clean_int(request.args.get("min_sessions") or 1, "Minimum sessions", minimum=0),
    )
    return period, {**_period_json(period), "scope": _scope_text(audience),
                    "generated_at": datetime.now().isoformat(timespec="seconds"), **data}


@attendance_reports_bp.get("/ranking-table")
@permission_required("reports:view")
def ranking_table():
    return jsonify(_ranking_data(request.args.get("audience") or "students")[1])


@attendance_reports_bp.get("/ranking-options")
@permission_required("reports:view")
def ranking_options():
    depts = {u.department for u in User.query.filter(User.department.isnot(None)).all() if u.department}
    from app.models import Course
    depts |= {d for (d,) in Course.query.with_entities(Course.department).distinct().all() if d}
    return jsonify({"metrics": rk.metric_options(), "quick_limits": list(rk.QUICK_LIMITS),
                    "departments": sorted(depts)})


@attendance_reports_bp.get("/warnings")
@permission_required("reports:view")
def warnings():
    return jsonify(student_warnings(request.args.get("batch") or None))


# ---------- PDF / Excel ----------

def _summary_cells(totals, audience):
    pct = lambda v: f"{v}%" if v is not None else "—"
    cells = [
        ("Scheduled sessions", totals["scheduled_sessions"], None),
        ("Counted sessions", totals["counted_sessions"], None),
        ("Exempted (not counted)", totals["exempted"], "exempted"),
        ("Present" + (" (on time)" if audience == "lecturers" else ""), f"{totals['present']}  ({pct(totals['present_rate'])})", "present"),
        ("Late", f"{totals['late']}  ({pct(totals['late_rate'])})", "late"),
        ("Absent (unjustified)", f"{totals['absent']}  ({pct(totals['absent_rate'])})", "absent"),
        ("Justified absence", f"{totals['justified']}  ({pct(totals['justified_rate'])})", "justified"),
        ("Attendance rate", pct(totals["attendance_rate"]), None),
    ]
    if audience == "lecturers":
        cells[6:6] = [("Left early", totals["left_early"], "left_early"), ("No check-out", totals["no_checkout"], "no_checkout")]
    return cells


PERIOD_TITLES = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly", "semester": "Semester",
                 "academic_year": "Academic Year", "all": "All-Records", "range": "Date-range"}
NOTE = ("Percentages are of counted sessions: every session that has taken place, excluding sessions exempted "
        "because the lecturer was recorded as unavailable. Justified absences are shown separately from unjustified ones.")

NUMERIC = {"scheduled_sessions", "counted_sessions", "present", "late", "absent", "justified", "left_early",
           "no_checkout", "exempted", "session_number", "rank", "effective_absences", "total_sessions",
           "accountable_sessions", "on_time", "unjustified_absences", "justified_absences", "held_sessions",
           "attended", "absences", "late_minutes", "class_rank"}


def _cols(tuples):
    """(key, header, width) -> Column, typing numbers and percentages."""
    out = []
    for key, header, width in tuples:
        kind = "pct" if key.endswith("_rate") or key.endswith("percentage") else "int" if key in NUMERIC else None
        out.append(rx.Column(key, header, width, kind))
    return out


RANKING_COLUMNS = {
    "lecturers": [("rank", "Rank", 6), ("name", "Lecturer", 26), ("department", "Department", 18),
                  ("scheduled_sessions", "Sessions scheduled", 10), ("held_sessions", "Sessions held", 9),
                  ("attended", "Attended", 9), ("unjustified_absences", "Absences (unjustified)", 11),
                  ("justified_absences", "Justified absences", 10), ("late", "Late arrivals", 9),
                  ("late_minutes", "Late minutes", 9), ("attendance_rate", "Attendance %", 10)],
    "students": [("rank", "Rank", 6), ("name", "Student", 26), ("student_id_number", "Student ID", 13),
                 ("student_class", "Class", 10), ("held_sessions", "Sessions held", 9), ("attended", "Sessions attended", 10),
                 ("absences", "Absences (unjustified)", 11), ("justified_absences", "Justified absences", 10),
                 ("late", "Late", 7), ("attendance_rate", "Attendance %", 10)],
}


def _ranking_report(period, data):
    audience = data["audience"]
    who = "Lecturer" if audience == "lecturers" else "Student"
    order = "best to worst" if data["order"] == "best" else "worst to best"
    count = f"Top {data['limit']}" if data["limit"] else "All eligible"
    title = f"{who} Attendance Rankings: {data['metric_label']}"
    summ = data["summary"]
    cells = [(f"{who}s ranked", summ.get("people", 0), None),
             ("Average attendance", f"{summ['average_attendance_rate']}%" if summ.get("average_attendance_rate") is not None else "—", "present"),
             ("Unjustified absences", summ.get("absences", 0), "absent"),
             ("Justified absences", summ.get("justified_absences", 0), "justified"),
             ("Late arrivals", summ.get("late", 0), "late")]
    if audience == "lecturers":
        cells.append(("Late minutes", summ.get("late_minutes", 0), "late"))
    note = data["method"] + (f" {data['excluded_count']} with fewer than {data['min_sessions']} accountable sessions are not ranked."
                             if data["excluded_count"] else "")
    columns = _cols(RANKING_COLUMNS[audience])
    tables = []
    if data["per_class"]:
        for i, g in enumerate(data["groups"]):
            tables.append(rx.Table(f"Class {g['class_name']}"[:31], f"Class {g['class_name']}", columns, g["rows"],
                                   summary=cells if i == 0 else None, note=note if i == 0 else None))
        if not tables:
            tables.append(rx.Table("Rankings", title, columns, [], summary=cells, note=note))
    else:
        tables.append(rx.Table("Rankings", title, columns, data["rows"], summary=cells, note=note))
    filters = [x for x in [data["scope"], f"{count}, {order}"] if x]
    return rx.Report(title, f"{who}_Rankings", period["label"], tables, filters=filters)


def _warnings_report(period):
    w = student_warnings(request.args.get("batch") or None)
    cols = _cols([("student_name", "Student", 26), ("student_id_number", "ID number", 13), ("class_name", "Class", 12),
                  ("course_name", "Course", 28), ("effective_absences", "Effective absences", 11),
                  ("total_sessions", "Planned sessions", 10), ("absence_percentage", "Absence %", 9),
                  ("level_label", "Level", 20)])
    rows = [{**r, "category": r["level"]} for r in w["rows"]]
    note = f"Warning from {w['warning_percent']}% of planned sessions; {w['threshold_percent']}% or more means retake."
    table = rx.Table("Student warnings", "Students requiring warnings (semester standing)", cols, rows,
                     note=note, status_col="level_label",
                     summary=[("Students listed", len({r["student_id"] for r in rows}), None),
                              ("Warnings", sum(1 for r in rows if r["level"] == "warning"), "warning"),
                              ("Over the limit (retake)", sum(1 for r in rows if r["level"] == "blocked"), "blocked")])
    return rx.Report("Students Requiring Warnings", "Student_Warnings", period["label"], [table],
                     filters=[f"Class: {request.args['batch']}"] if request.args.get("batch") else [])


@attendance_reports_bp.get("/export")
@permission_required("reports:view")
def export_report():
    """audience=lecturers|students (view=summary|detailed), ranking, warnings
    or the legacy rankings workbook; format=pdf|xlsx."""
    audience = request.args.get("audience") or "lecturers"
    fmt = rx.export_format()

    if audience == "ranking":
        period, data = _ranking_data(request.args.get("ranking_audience") or "students")
        return rx.send(_ranking_report(period, data), fmt)
    if audience == "warnings":
        return rx.send(_warnings_report(resolve_period(request.args)), fmt)
    if audience == "rankings":
        return rx.send(_legacy_rankings_report(), fmt)
    if audience not in ("lecturers", "students"):
        raise ValidationError("audience must be lecturers, students, ranking, warnings or rankings")

    view = _view()
    if audience == "lecturers":
        period, rows = _lecturer_data()
        summary = summarize(rows, "lecturer_id", "lecturer_name")
        detail_cols, summary_cols = LECTURER_DETAIL_COLUMNS, LECTURER_SUMMARY_COLUMNS
        who = "Lecturer"
    else:
        period, rows = _student_data()
        summary = summarize(rows, "student_id", "student_name", extra_keys=("student_id_number", "student_class"))
        detail_cols, summary_cols = STUDENT_DETAIL_COLUMNS, STUDENT_SUMMARY_COLUMNS
        who = "Student"
    title = f"{PERIOD_TITLES[period['period']]} {who} Attendance Report"
    cells = _summary_cells(summary["totals"], audience)
    summary_table = rx.Table("Summary", f"{title} - Summary", _cols(summary_cols), summary["rows"],
                             summary=cells, note=NOTE)
    if view == "summary":
        tables = [summary_table]
    else:
        summary_table.summary = None
        summary_table.note = None
        tables = [rx.Table("Detailed", f"{title} - Detailed", _cols(detail_cols), rows, summary=cells,
                           status_col="status_label", note=NOTE), summary_table]
    filters = [] if _scope_text(audience).startswith("All ") else [_scope_text(audience)]
    report = rx.Report(f"{title} ({view.title()})", f"{who}_Attendance_{view.title()}", period["label"], tables,
                       filters=filters)
    return rx.send(report, fmt)


def _legacy_rankings_report():
    period, data = _rankings()
    title = f"{PERIOD_TITLES[period['period']]} Attendance Rankings"
    lr = data["lecturers"]
    rank_cols = _cols([("rank", "Rank", 6), ("lecturer_name", "Lecturer", 26), ("accountable_sessions", "Accountable sessions", 12),
                       ("on_time", "On time", 8), ("late", "Late", 7), ("unjustified_absences", "Unjustified absences", 12),
                       ("justified_absences", "Justified absences", 11), ("on_time_rate", "On-time %", 9),
                       ("unjustified_absence_rate", "Unjustified absence %", 12), ("late_rate", "Late %", 8), ("tied", "Tied", 6)])
    sr = data["students"]
    s_cols = _cols([("rank", "Rank", 6), ("student_name", "Student", 26), ("student_id_number", "ID number", 13),
                    ("student_class", "Class", 10), ("counted_sessions", "Counted sessions", 10), ("late", "Late", 7),
                    ("absent", "Absent", 8), ("justified", "Justified", 9), ("late_rate", "Late %", 8),
                    ("absent_rate", "Absent %", 9), ("tied", "Tied", 6)])
    tables = [
        rx.Table("Top lecturers", "Top lecturers", rank_cols, lr["top"],
                 note=lr["method"] + f" Minimum {lr['min_sessions']} accountable sessions."),
        rx.Table("Highest absence rate", "Highest unjustified absence rate", rank_cols, lr["highest_absence_rate"]),
        rx.Table("Most unjustified", "Most unjustified absences", rank_cols, lr["most_unjustified_absences"]),
        rx.Table("Most late", "Most late arrivals", rank_cols, lr["most_late"]),
        rx.Table("Students - lateness", "Repeated student lateness", s_cols, sr["repeated_lateness"],
                 note=f"Students late {sr['late_threshold']} or more times in the period."),
        rx.Table("Students - absences", "Frequent student absences", s_cols, sr["frequent_absences"]),
    ]
    return rx.Report(title, "Attendance_Rankings", period["label"], tables + _warnings_report(period).tables)
