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
