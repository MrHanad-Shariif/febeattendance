"""Lecturer punctuality: late minutes per session, totals, equivalent
sessions for Academic Office review, and makeup sessions.

Late minutes are measured per session from the lecturer's daily check-in
against *that* session's scheduled start (utils/attendance_report): 07:45
for a 07:30 class is 15 late minutes; on time or early is 0. A later class
the same day starts after the check-in, so it is not late. Sessions covered
by an official absence, sessions not yet held and absences are never
counted as lateness. Totals are recalculated from the records every time,
so a corrected check-in is reflected straight away.

Every `late_minutes_per_equivalent_session` minutes (90 by default) make
one equivalent session. Reaching one flags the lecturer for Academic Office
review; nothing is ever marked missed automatically.
"""
from datetime import date as date_cls

from app.models import LatenessReview, MakeupSession, User
from app.utils.attendance_report import lecturer_session_rows
from app.utils.settings import get_all_settings, get_setting_int

HELD = ("present", "late", "left_early", "no_checkout")


def per_session_threshold(settings=None) -> int:
    return max(1, get_setting_int("late_minutes_per_equivalent_session", settings or get_all_settings()))


def lecturer_summary(lecturer_id: int, date_from: date_cls, date_to: date_cls, rows=None) -> dict:
    rows = rows if rows is not None else lecturer_session_rows(date_from, date_to, lecturer_id=lecturer_id)
    rows = [r for r in rows if r["lecturer_id"] == lecturer_id]
    threshold = per_session_threshold()
    counted = [r for r in rows if r["category"] != "not_yet"]
    late_minutes = sum(r.get("late_minutes") or 0 for r in counted)
    equivalent = late_minutes // threshold
    makeups = MakeupSession.query.filter_by(lecturer_id=lecturer_id).all()
    reviews = LatenessReview.query.filter_by(lecturer_id=lecturer_id).order_by(LatenessReview.created_at.desc()).all()
    reviewed_minutes = max((rv.late_minutes for rv in reviews
                            if rv.period_from <= date_to and rv.period_to >= date_from), default=0)
    assigned = [m for m in makeups if m.status != "cancelled" and m.reason == "late_minutes"]
    return {
        "lecturer_id": lecturer_id,
        "late_minutes": late_minutes,
        "late_sessions": sum(1 for r in counted if (r.get("late_minutes") or 0) > 0),
        "scheduled_sessions": len(rows),
        "held_sessions": len(counted),
        "conducted_sessions": sum(1 for r in counted if r["category"] in HELD),
        "absences": sum(1 for r in counted if r["category"] == "absent"),
        "justified_absences": sum(1 for r in counted if r["category"] == "justified"),
        "minutes_per_equivalent_session": threshold,
        "equivalent_sessions": equivalent,
        "minutes_to_next_equivalent": threshold - late_minutes % threshold,
        # Review needed when lateness reached a whole session beyond what was last reviewed.
        "needs_review": equivalent > 0 and late_minutes // threshold > reviewed_minutes // threshold,
        "makeup_assigned": len(assigned),
        "makeup_completed": sum(1 for m in assigned if m.status == "completed"),
        "makeup_outstanding": max(equivalent - sum(1 for m in assigned if m.status == "completed"), 0),
        "makeup_open": sum(1 for m in makeups if m.status == "assigned"),
    }


def all_lecturers(date_from: date_cls, date_to: date_cls) -> list[dict]:
    rows = lecturer_session_rows(date_from, date_to)
    by = {}
    for r in rows:
        by.setdefault(r["lecturer_id"], []).append(r)
    out = []
    for lecturer in User.query.filter_by(role="lecturer").order_by(User.name).all():
        if lecturer.id not in by:
            continue
        s = lecturer_summary(lecturer.id, date_from, date_to, by[lecturer.id])
        out.append({**s, "lecturer_name": lecturer.name, "department": by[lecturer.id][0].get("department")})
    out.sort(key=lambda r: (-r["late_minutes"], r["lecturer_name"].lower()))
    return out
