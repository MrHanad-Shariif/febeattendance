"""Daily / monthly / semester attendance reports for lecturers and students,
in Summary and Detailed form, the lecturer and student rankings, and the
same reports as print-ready Excel workbooks (RBAC: reports:view).

Query parameters shared by every endpoint:
  period=daily|monthly|semester|range  date=YYYY-MM-DD  month=YYYY-MM  from=…  to=…
  lecturer_id, student_id, batch (class), course, category=present,late,…
"""
from datetime import datetime

from flask import Response, jsonify, request

from app.attendance_reports import attendance_reports_bp
from app.models import Timetable, User
from app.utils.attendance_report import (
    CATEGORY_LABELS, lecturer_rankings, lecturer_session_rows, number_sessions, resolve_period,
    student_rankings, student_session_rows, student_warnings, summarize,
)
from app.utils.authz import permission_required
from app.utils.settings import get_all_settings
from app.utils.validation import ValidationError, clean_int
from app.utils import xlsx_report as xl

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


# ---------- Excel ----------

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


PERIOD_TITLES = {"daily": "Daily", "monthly": "Monthly", "semester": "Semester", "range": "Date-range"}
NOTE = ("Percentages are of counted sessions: every session that has taken place, excluding sessions exempted "
        "because the lecturer was recorded as unavailable. Justified absences are shown separately from unjustified ones.")


@attendance_reports_bp.get("/export")
@permission_required("reports:view")
def export_report():
    audience = request.args.get("audience") or "lecturers"
    view = _view()
    wb = xl.new_workbook()
    generated = datetime.now()

    if audience == "rankings":
        period, data = _rankings()
        title = f"{PERIOD_TITLES[period['period']]} Attendance Rankings"
        lr = data["lecturers"]
        rank_cols = [("rank", "Rank", 6), ("lecturer_name", "Lecturer", 26), ("accountable_sessions", "Accountable sessions", 12),
                     ("on_time", "On time", 8), ("late", "Late", 7), ("unjustified_absences", "Unjustified absences", 12),
                     ("justified_absences", "Justified absences", 11), ("on_time_rate", "On-time %", 9),
                     ("unjustified_absence_rate", "Unjustified absence %", 12), ("late_rate", "Late %", 8), ("tied", "Tied", 6)]
        xl.add_sheet(wb, "Top lecturers", f"{title}: Top lecturers", period["label"], rank_cols, lr["top"],
                     category_key=None, generated=generated, note=lr["method"] + f" Minimum {lr['min_sessions']} accountable sessions.")
        xl.add_sheet(wb, "Highest absence rate", f"{title}: Highest unjustified absence rate", period["label"], rank_cols,
                     lr["highest_absence_rate"], category_key=None, generated=generated)
        xl.add_sheet(wb, "Most unjustified", f"{title}: Most unjustified absences", period["label"], rank_cols,
                     lr["most_unjustified_absences"], category_key=None, generated=generated)
        xl.add_sheet(wb, "Most late", f"{title}: Most late arrivals", period["label"], rank_cols, lr["most_late"],
                     category_key=None, generated=generated)
        sr = data["students"]
        s_cols = [("rank", "Rank", 6), ("student_name", "Student", 26), ("student_id_number", "ID number", 13),
                  ("student_class", "Class", 10), ("counted_sessions", "Counted sessions", 10), ("late", "Late", 7),
                  ("absent", "Absent", 8), ("justified", "Justified", 9), ("late_rate", "Late %", 8),
                  ("absent_rate", "Absent %", 9), ("tied", "Tied", 6)]
        xl.add_sheet(wb, "Students - lateness", f"{title}: Repeated student lateness", period["label"], s_cols,
                     sr["repeated_lateness"], category_key=None, generated=generated,
                     note=f"Students late {sr['late_threshold']} or more times in the period.")
        xl.add_sheet(wb, "Students - absences", f"{title}: Frequent student absences", period["label"], s_cols,
                     sr["frequent_absences"], category_key=None, generated=generated)
        w = data["warnings"]
        xl.add_sheet(wb, "Student warnings", "Students requiring warnings (semester standing)", period["label"],
                     [("student_name", "Student", 26), ("student_id_number", "ID number", 13), ("class_name", "Class", 12),
                      ("course_name", "Course", 28), ("effective_absences", "Effective absences", 11),
                      ("total_sessions", "Planned sessions", 10), ("absence_percentage", "Absence %", 9),
                      ("level_label", "Level", 20)],
                     [{**r, "category": r["level"]} for r in w["rows"]], status_col="level_label", generated=generated,
                     note=f"Warning from {w['warning_percent']}% of planned sessions; {w['threshold_percent']}% or more means retake.")
        filename = f"attendance-rankings-{period['from']}-{period['to']}.xlsx"
    elif audience in ("lecturers", "students"):
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
        scope = _scope_text(audience)
        cells = _summary_cells(summary["totals"], audience)
        if view == "summary":
            xl.add_sheet(wb, "Summary", f"{title} — Summary", period["label"], summary_cols, summary["rows"],
                         summary=cells, category_key=None, scope=scope, generated=generated, note=NOTE)
        else:
            xl.add_sheet(wb, "Detailed", f"{title} — Detailed", period["label"], detail_cols, rows,
                         summary=cells, status_col="status_label", scope=scope, generated=generated, note=NOTE)
            xl.add_sheet(wb, "Summary", f"{title} — Summary", period["label"], summary_cols, summary["rows"],
                         summary=cells, category_key=None, scope=scope, generated=generated, note=NOTE)
        filename = f"{audience[:-1]}-attendance-{view}-{period['from']}-{period['to']}.xlsx"
    else:
        raise ValidationError("audience must be lecturers, students or rankings")

    return Response(
        xl.to_bytes(wb),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
