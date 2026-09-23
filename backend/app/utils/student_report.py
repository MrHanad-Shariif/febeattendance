from app.models import StudentAttendance
from app.utils.settings import get_all_settings
from app.utils.student_status import all_course_keys_for_batch, compute_course_stats, course_records_query


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

    course_keys = all_course_keys_for_batch(student.batch) if student.batch else []

    summary = []
    detailed = []
    totals = {
        "sessions_held": 0, "total_sessions": 0, "on_time": 0, "late": 0,
        "absent": 0, "present_excused": 0, "effective_absences": 0,
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
            "needs_retake": stats["needs_retake"],
            "sessions": [
                {
                    "date": r.date.isoformat(),
                    "status": r.status,
                    "status_label": StudentAttendance.STATUS_LABELS.get(r.status, r.status),
                    "remarks": r.remarks,
                }
                for r in records
            ],
        })

    return {
        "basic_info": basic_info,
        "summary": summary,
        "detailed": detailed,
        "totals": totals,
    }
