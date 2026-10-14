"""Flexible attendance rankings: any number of results (or all), best or
worst first, by a chosen criterion, for lecturers or for students (ranked
within their own class by default).

Rows come from the same session builders as the attendance reports
(utils/attendance_report), so a ranking always agrees with the reports:

* sessions exempted because the lecturer was unavailable, and sessions that
  haven't happened yet, are not counted at all;
* justified (excused) absences are counted as held sessions but never as a
  penalty: rates are per *accountable* session = held sessions minus
  justified absences;
* only sessions on the timetable for that person count, so a student is
  never ranked on another class's sessions.

Ties: people are compared on the chosen criterion, then on the fixed
tie-breakers listed for that audience. People equal on all of them share a
rank (1, 2, 2, 4) and are listed alphabetically. A "top N" cut-off keeps
everyone tied with the N-th place, so a tie is never split arbitrarily.
"""
from collections import defaultdict

from app.utils.attendance_report import summarize
from app.utils.validation import ValidationError, clean_int

ORDERS = ("best", "worst")
QUICK_LIMITS = (3, 5, 10, 20, 50, 100)

# key -> (label, field, higher_is_better, explanation)
LECTURER_METRICS = {
    "attendance_rate": ("Attendance rate", "attendance_rate", True,
                        "Sessions the lecturer attended (on time, late or left early) out of accountable sessions."),
    "on_time_rate": ("On-time rate", "on_time_rate", True, "Sessions started on time out of accountable sessions."),
    "absences": ("Unjustified absences", "unjustified_absences", False, "Number of sessions missed without justification."),
    "absence_rate": ("Unjustified absence rate", "unjustified_absence_rate", False,
                     "Unjustified absences out of accountable sessions."),
    "late_arrivals": ("Late arrivals", "late", False, "Number of sessions the lecturer arrived late."),
    "late_minutes": ("Accumulated late minutes", "late_minutes", False,
                     "Total minutes late across all sessions (arrival after the scheduled start)."),
}
LECTURER_TIEBREAK = (("attendance_rate", True), ("unjustified_absence_rate", False), ("late_minutes", False))

STUDENT_METRICS = {
    "attendance_rate": ("Attendance rate", "attendance_rate", True,
                        "Sessions attended (on time or late) out of accountable sessions."),
    "absence_rate": ("Absence rate", "absence_rate", False, "Unjustified absences out of accountable sessions."),
    "absences": ("Unjustified absences", "absences", False, "Number of sessions missed without justification."),
    "late_arrivals": ("Late arrivals", "late", False, "Number of sessions the student arrived late."),
}
STUDENT_TIEBREAK = (("attendance_rate", True), ("absences", False), ("late", False))


FIELD_NAMES = {
    "attendance_rate": "attendance rate", "on_time_rate": "on-time rate", "absence_rate": "absence rate",
    "unjustified_absence_rate": "unjustified absence rate", "unjustified_absences": "unjustified absences",
    "absences": "unjustified absences", "late": "late arrivals", "late_minutes": "late minutes",
}


def _pct(n, d):
    return round(n * 100.0 / d, 1) if d else None


def clean_limit(value):
    """None = all eligible records."""
    if value in (None, "", "all"):
        return None
    return clean_int(value, "Number of results", minimum=1)


def _lecturer_people(rows):
    late_minutes = defaultdict(int)
    departments = {}
    for r in rows:
        late_minutes[r["lecturer_id"]] += r.get("late_minutes") or 0
        departments.setdefault(r["lecturer_id"], r.get("department"))
    out = []
    for p in summarize(rows, "lecturer_id", "lecturer_name")["rows"]:
        accountable = p["counted_sessions"] - p["justified"]
        out.append({
            "id": p["id"], "lecturer_id": p["id"], "name": p["name"], "department": departments.get(p["id"]),
            "scheduled_sessions": p["scheduled_sessions"], "held_sessions": p["counted_sessions"],
            "accountable_sessions": accountable, "attended": p["attended"], "on_time": p["present"],
            "late": p["late"], "left_early": p["left_early"], "unjustified_absences": p["absent"],
            "justified_absences": p["justified"], "exempted": p["exempted"],
            "late_minutes": late_minutes[p["id"]],
            "attendance_rate": _pct(p["attended"], accountable),
            "on_time_rate": _pct(p["present"], accountable),
            "unjustified_absence_rate": _pct(p["absent"], accountable),
            "late_rate": _pct(p["late"], accountable),
        })
    return out


def _student_people(rows):
    departments = {}
    for r in rows:
        departments.setdefault(r["student_id"], r.get("department"))
    out = []
    summary = summarize(rows, "student_id", "student_name", extra_keys=("student_id_number", "student_class"))
    for p in summary["rows"]:
        accountable = p["counted_sessions"] - p["justified"]
        out.append({
            "id": p["id"], "student_id": p["id"], "name": p["name"], "student_id_number": p["student_id_number"],
            "student_class": p["student_class"], "department": departments.get(p["id"]),
            "held_sessions": p["counted_sessions"], "accountable_sessions": accountable,
            "attended": p["attended"], "on_time": p["present"], "late": p["late"],
            "absences": p["absent"], "justified_absences": p["justified"], "exempted": p["exempted"],
            "attendance_rate": _pct(p["attended"], accountable),
            "absence_rate": _pct(p["absent"], accountable),
            "late_rate": _pct(p["late"], accountable),
        })
    return out


def _sort_key(fields):
    """Smaller = better. A missing rate (no accountable sessions) sorts last."""
    def key(p):
        out = []
        for name, higher_better in fields:
            v = p.get(name)
            if v is None:
                out.append(float("inf"))
            else:
                out.append(-v if higher_better else v)
        return tuple(out)
    return key


def rank(people, fields, order="best", limit=None):
    """Competition ranking (1, 2, 2, 4) on `fields`; ties listed by name.
    `limit` keeps everyone ranked within the first `limit` places."""
    key = _sort_key(fields)
    ordered = sorted(people, key=lambda p: (p["name"] or "").lower())
    ordered.sort(key=key, reverse=(order == "worst"))
    out, position, prev = [], 0, object()
    for i, p in enumerate(ordered):
        k = key(p)
        if k != prev:
            position, prev = i + 1, k
        if limit is not None and position > limit:
            break
        out.append({**p, "rank": position})
    counts = defaultdict(int)
    for p in out:
        counts[p["rank"]] += 1
    for p in out:
        p["tied"] = counts[p["rank"]] > 1
    return out


def build_ranking(rows, audience, metric=None, order="best", limit=None, per_class=True, min_sessions=1):
    if audience not in ("lecturers", "students"):
        raise ValidationError("audience must be lecturers or students")
    if order not in ORDERS:
        raise ValidationError("order must be best or worst")
    metrics = LECTURER_METRICS if audience == "lecturers" else STUDENT_METRICS
    metric = metric or "attendance_rate"
    if metric not in metrics:
        raise ValidationError(f"Unknown ranking criterion: {metric}")
    label, field, higher_better, explanation = metrics[metric]
    tiebreak = LECTURER_TIEBREAK if audience == "lecturers" else STUDENT_TIEBREAK
    fields = [(field, higher_better)] + [t for t in tiebreak if t[0] != field]

    people = _lecturer_people(rows) if audience == "lecturers" else _student_people(rows)
    eligible = [p for p in people if p["accountable_sessions"] >= min_sessions]
    excluded = len(people) - len(eligible)

    groups = []
    if audience == "students" and per_class:
        by_class = defaultdict(list)
        for p in eligible:
            by_class[p["student_class"] or "—"].append(p)
        for cls in sorted(by_class):
            ranked = rank(by_class[cls], fields, order, limit)
            groups.append({"class_name": cls, "eligible": len(by_class[cls]), "rows": ranked})
        ranked_rows = [{**r, "class_rank": r["rank"]} for g in groups for r in g["rows"]]
    else:
        ranked_rows = rank(eligible, fields, order, limit)

    tie_text = ", then ".join(f"{'highest' if hb else 'lowest'} {FIELD_NAMES[f]}" for f, hb in fields[1:])
    method = (f"Ranked by {label.lower()} ({'highest' if higher_better else 'lowest'} is best), "
              f"{'best' if order == 'best' else 'worst'} first. {explanation} "
              f"Ties are broken by {tie_text}; people still equal share a rank. "
              "Exempted sessions (lecturer unavailable) and sessions not yet held are not counted; "
              "justified absences never count against anyone."
              + (" Students are ranked within their own class." if audience == "students" and per_class else ""))
    return {
        "audience": audience,
        "metric": metric,
        "metric_label": label,
        "metric_field": field,
        "order": order,
        "limit": limit,
        "per_class": bool(audience == "students" and per_class),
        "min_sessions": min_sessions,
        "method": method,
        "eligible_count": len(eligible),
        "excluded_count": excluded,
        "rows": ranked_rows,
        "groups": groups,
        "summary": _summary(eligible, audience),
    }


def _summary(eligible, audience):
    if not eligible:
        return {"people": 0}
    rates = [p["attendance_rate"] for p in eligible if p["attendance_rate"] is not None]
    out = {
        "people": len(eligible),
        "average_attendance_rate": round(sum(rates) / len(rates), 1) if rates else None,
        "held_sessions": sum(p["held_sessions"] for p in eligible),
        "absences": sum(p["unjustified_absences" if audience == "lecturers" else "absences"] for p in eligible),
        "justified_absences": sum(p["justified_absences"] for p in eligible),
        "late": sum(p["late"] for p in eligible),
    }
    if audience == "lecturers":
        out["late_minutes"] = sum(p["late_minutes"] for p in eligible)
    return out


def metric_options():
    return {
        aud: [{"value": k, "label": m[0], "description": m[3]} for k, m in metrics.items()]
        for aud, metrics in (("lecturers", LECTURER_METRICS), ("students", STUDENT_METRICS))
    }
