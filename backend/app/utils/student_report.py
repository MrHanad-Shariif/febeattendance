from app.models import StudentAttendance
from app.utils.settings import get_all_settings
from app.utils.absences import AbsenceIndex
from app.utils.student_status import compute_course_stats, course_keys_for_student, course_records_query


def build_student_report(student) -> dict:
    settings = get_all_settings()
    basic_info = {
        "student_id_number": student.student_id_number,
        "name": student.name,
        "email": student.email,
        "department": student.department,
        "faculty": "Faculty of Engineering and Built Environment",
        "batch": student.batch,
        "photo_url": f"/api/uploads/{student.photo_filename}" if student.photo_filename else None,
    }

    course_keys = course_keys_for_student(student)
    index = AbsenceIndex.current()

    summary = []
    detailed = []
    totals = {
        "sessions_held": 0, "total_sessions": 0, "on_time": 0, "late": 0,
        "absent": 0, "present_excused": 0, "effective_absences": 0, "exempted_sessions": 0,
    }

    for batch, course_name in course_keys:
        stats = compute_course_stats(student.id, batch, course_name, settings)
        summary.append(stats)

        for key in totals:
            totals[key] += stats[key]

        records = (
            course_records_query(student.id, batch, course_name)
            .order_by(StudentAttendance.date)
            .all()
        )
        detailed.append({
            "course_name": course_name,
            "batch": batch,
            "needs_retake": stats["needs_retake"],
            "sessions": [
                _session_row(r, index.exempting("student", r, r.timetable_entry, r.date))
                for r in records
            ],
        })

    return {
        "basic_info": basic_info,
        "summary": summary,
        "detailed": detailed,
        "totals": totals,
    }


def _session_row(r, absence) -> dict:
    if absence is not None:
        return {
            "date": r.date.isoformat(),
            "status": "exempted",
            "status_label": "Class Session Exempted",
            "remarks": f"Lecturer unavailable ({absence.reason_label}). Recorded as "
                       f"{StudentAttendance.STATUS_LABELS.get(r.status, r.status)}; not counted.",
            "exempted": True,
        }
    return {
        "date": r.date.isoformat(),
        "status": r.status,
        "status_label": StudentAttendance.STATUS_LABELS.get(r.status, r.status),
        "remarks": r.remarks,
    }


STATUS_CATEGORY = {"on_time": "present", "late": "late", "absent": "absent", "present": "justified", "exempted": "exempted"}


def student_report_export(student, fmt: str):
    """One student's semester report (the same figures as the on-screen
    report) as a PDF or Excel download."""
    from app.utils import report_export as rx

    data = build_student_report(student)
    info, t = data["basic_info"], data["totals"]
    for s in data["summary"]:
        s["standing"] = "Retake required" if s["needs_retake"] else "OK"
        s["category"] = "blocked" if s["needs_retake"] else "present"
    summary_cols = [rx.Column("course_name", "Course", 30), rx.Column("batch", "Class", 10),
                    rx.Column("sessions_held", "Sessions held", 9, "int"), rx.Column("total_sessions", "Planned sessions", 9, "int"),
                    rx.Column("on_time", "On time", 8, "int"), rx.Column("late", "Late", 7, "int"),
                    rx.Column("absent", "Absent", 7, "int"), rx.Column("present_excused", "Excused", 8, "int"),
                    rx.Column("exempted_sessions", "Exempted", 8, "int"),
                    rx.Column("effective_absences", "Effective absences", 9, "int"),
                    rx.Column("absence_percentage", "Absence %", 9, "pct"), rx.Column("standing", "Standing", 13)]
    sessions = []
    for course in data["detailed"]:
        for r in course["sessions"]:
            sessions.append({**r, "course_name": course["course_name"], "batch": course["batch"],
                             "category": STATUS_CATEGORY.get(r["status"])})
    session_cols = [rx.Column("date", "Date", 11), rx.Column("course_name", "Course", 30), rx.Column("batch", "Class", 10),
                    rx.Column("status_label", "Status", 18), rx.Column("remarks", "Remarks", 40)]
    cells = [("Sessions held", t["sessions_held"], None), ("On time", t["on_time"], "present"),
             ("Late", t["late"], "late"), ("Absent", t["absent"], "absent"),
             ("Excused", t["present_excused"], "justified"), ("Exempted (not counted)", t["exempted_sessions"], "exempted")]
    tables = [
        rx.Table("Summary", "Attendance by course", summary_cols, data["summary"], summary=cells, status_col="standing",
                 note="Absence % is measured against each course's planned sessions for the whole semester. "
                      "Exempted sessions (lecturer unavailable) are not counted."),
        rx.Table("Sessions", "Session-by-session record", session_cols, sessions, status_col="status_label"),
    ]
    filters = [f"Student: {info['name']} ({info['student_id_number'] or 'no ID'})", f"Class: {info['batch'] or '-'}"]
    if info.get("department"):
        filters.append(f"Department: {info['department']}")
    semester = get_all_settings().get("semester_name") or "Current semester"
    return rx.send(rx.Report("Student Attendance Report", f"Student_Report_{info['student_id_number'] or student.id}",
                             semester, tables, filters=filters, orientation="landscape"), fmt)
