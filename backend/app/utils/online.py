"""Online teaching: which sessions are delivered online, and what everyone
is told when that changes.

A session (timetable row on a date) is online when a non-cancelled
OnlineArrangement covers that date and the row is in its scope (specific
classes, class/batch, course, lecturer, weekdays; an empty list means "any"
for that part). Everything else is on campus. Online sessions skip the
rotating campus code and the location check -- nothing else: identity (face),
class membership, timing and duplicate checks are unchanged.
"""
from collections import defaultdict
from datetime import date as date_cls, timedelta

from flask import g, has_app_context

from app.extensions import db
from app.models import OnlineArrangement, OnlineArrangementEvent, Timetable, User
from app.utils.batches import members
from app.utils.schedule import day_abbr, teaches_on
from app.utils.settings import get_all_settings, get_no_class_dates
from app.utils.validation import ValidationError, clean_text, parse_iso_date

VALID_DAYS = ("Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri")
MAX_DAYS = 200


def matches_scope(arr, entry, d) -> bool:
    if arr.lecturer_id and entry.lecturer_id != arr.lecturer_id:
        return False
    if arr.timetable_ids and entry.id not in arr.timetable_ids:
        return False
    if arr.batches and not (entry.batch in arr.batches or any(b in arr.batches for b in members(entry.batch))):
        return False
    if arr.courses and entry.course_name not in arr.courses:
        return False
    if arr.days and day_abbr(d) not in arr.days:
        return False
    return True


class OnlineIndex:
    """All non-cancelled arrangements, for many "is this online?" questions."""

    def __init__(self):
        self.arrangements = OnlineArrangement.query.filter(OnlineArrangement.state != "cancelled").all()

    @classmethod
    def current(cls) -> "OnlineIndex":
        if not has_app_context():
            return cls()
        index = g.get("_online_index")
        if index is None:
            index = g._online_index = cls()
        return index

    @staticmethod
    def invalidate():
        if has_app_context():
            g.pop("_online_index", None)

    def covering(self, entry, d):
        if entry is None:
            return None
        for a in self.arrangements:
            if a.covers_date(d) and matches_scope(a, entry, d):
                return a
        return None


def online_for(entry, d):
    return OnlineIndex.current().covering(entry, d)


def delivery_mode(entry, d) -> str:
    return "online" if online_for(entry, d) else "campus"


# ---------- input ----------

def _list(value, label, item_type=str, allowed=None):
    if value in (None, "", []):
        return []
    if not isinstance(value, list):
        raise ValidationError(f"{label} must be a list")
    out = []
    for v in value:
        if item_type is int:
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise ValidationError(f"{label} contains an invalid value")
        else:
            v = str(v).strip()
        if allowed is not None and v not in allowed:
            raise ValidationError(f"{label} contains an invalid value: {v}")
        if v and v not in out:
            out.append(v)
    return out


def clean_input(data: dict, existing: OnlineArrangement | None = None, today: date_cls | None = None) -> dict:
    today = today or date_cls.today()

    def pick(key):
        return data[key] if key in data else (getattr(existing, key) if existing is not None else None)

    lecturer_id = pick("lecturer_id")
    if lecturer_id in ("", None):
        lecturer_id = None
    else:
        try:
            lecturer_id = int(lecturer_id)
        except (TypeError, ValueError):
            raise ValidationError("Unknown lecturer")
        if not User.query.filter_by(id=lecturer_id, role="lecturer").first():
            raise ValidationError("Unknown lecturer")
    timetable_ids = _list(pick("timetable_ids"), "Classes", int)
    if timetable_ids:
        found = {t.id for t in Timetable.query.filter(Timetable.id.in_(timetable_ids)).all()}
        if set(timetable_ids) - found:
            raise ValidationError("A chosen class no longer exists")
    batches = _list(pick("batches"), "Classes (batches)")
    courses = _list(pick("courses"), "Courses")
    days = _list(pick("days"), "Days", allowed=VALID_DAYS)
    if not (lecturer_id or timetable_ids or batches or courses):
        raise ValidationError("Choose what moves online: a session, classes, a course, a class or a lecturer")

    start = pick("start_date")
    start = start if isinstance(start, date_cls) else parse_iso_date(start, "Start date") if start else None
    end = pick("end_date")
    end = end if isinstance(end, date_cls) else parse_iso_date(end, "End date") if end else None
    if start is None or end is None:
        raise ValidationError("Choose the first and the last online day")
    if end < start:
        raise ValidationError("The last online day cannot be before the first")
    if (end - start).days + 1 > MAX_DAYS:
        raise ValidationError(f"An online period can be at most {MAX_DAYS} days; extend it later if needed")
    if existing is None and start < today:
        raise ValidationError("Online teaching can start today or later; past sessions keep how they were taught")

    link = clean_text(pick("meeting_link"), "Meeting link", max_len=500)
    if link and not link.lower().startswith(("https://", "http://")):
        raise ValidationError("The meeting link must start with https://")
    return {
        "title": clean_text(pick("title"), "Title", max_len=200),
        "lecturer_id": lecturer_id, "timetable_ids": timetable_ids or None, "batches": batches or None,
        "courses": courses or None, "days": days or None, "start_date": start, "end_date": end,
        "reason": clean_text(pick("reason"), "Reason", max_len=500),
        "meeting_link": link, "instructions": clean_text(pick("instructions"), "Instructions", max_len=1000),
    }


class Draft:
    state = "recorded"
    actual_end_date = None

    def __init__(self, fields, arrangement_id=None, actual_end_date=None):
        self.__dict__.update(fields)
        self.id = arrangement_id
        self.actual_end_date = actual_end_date

    effective_end = OnlineArrangement.effective_end
    covers_date = OnlineArrangement.covers_date


def affected_sessions(arr, date_from=None, date_to=None) -> list[tuple]:
    settings = get_all_settings()
    no_class = get_no_class_dates(settings)
    start = max(arr.start_date, date_from) if date_from else arr.start_date
    end = min(arr.effective_end, date_to) if date_to else arr.effective_end
    entries = [e for e in Timetable.query.filter(Timetable.start_time.isnot(None)).all()]
    out = []
    d = start
    while d <= end:
        for e in sorted(entries, key=lambda e: e.start_time):
            if teaches_on(e, d, no_class) and matches_scope(arr, e, d):
                out.append((e, d))
        d += timedelta(days=1)
    return out


def summarize(sessions) -> dict:
    classes = {}
    for e, d in sessions:
        c = classes.setdefault(e.id, {"timetable_id": e.id, "batch": e.batch, "course_name": e.course_name,
                                      "lecturer_name": e.lecturer.name if e.lecturer else None, "room": e.room,
                                      "sessions": 0})
        c["sessions"] += 1
    return {"total_sessions": len(sessions), "classes": sorted(classes.values(), key=lambda c: (c["batch"] or "", c["course_name"]))}


def find_conflicts(arr, exclude_id=None) -> list[OnlineArrangement]:
    mine = {(e.id, d) for e, d in affected_sessions(arr)}
    out = []
    for other in OnlineArrangement.query.filter(OnlineArrangement.state != "cancelled").all():
        if exclude_id and other.id == exclude_id:
            continue
        if other.start_date > arr.effective_end or other.effective_end < arr.start_date:
            continue
        if mine & {(e.id, d) for e, d in affected_sessions(other)}:
            out.append(other)
    return out


def snapshot(arr) -> dict:
    return {k: (getattr(arr, k).isoformat() if isinstance(getattr(arr, k), date_cls) else getattr(arr, k))
            for k in ("title", "lecturer_id", "timetable_ids", "batches", "courses", "days", "start_date",
                      "end_date", "actual_end_date", "meeting_link", "instructions", "state")}


def record_event(arr, actor, action, old=None, new=None, note=None):
    arr.events.append(OnlineArrangementEvent(action=action, old_value=old, new_value=new, note=note,
                                             actor_id=actor.id if actor else None,
                                             actor_name=actor.name if actor else None))


# ---------- notifications ----------

def _people(sessions):
    lecturers, students = {}, {}
    batches = set()
    for e, _ in sessions:
        if e.lecturer:
            lecturers[e.lecturer.id] = e.lecturer
        for b in members(e.batch):
            batches.add(b)
    if batches:
        for s in User.query.filter(User.role == "student", User.status == "active", User.batch.in_(batches)).all():
            students[s.id] = s
    return list(lecturers.values()), list(students.values())


def _class_text(sessions) -> str:
    names = sorted({f"{e.course_name} ({e.batch})" for e, _ in sessions})
    return ", ".join(names[:5]) + (f" and {len(names) - 5} more" if len(names) > 5 else "")


def notify_change(arr, action: str, sessions=None, note=None):
    """Tell the lecturers and students whose sessions this affects."""
    from app.utils.notify import notify

    sessions = sessions if sessions is not None else affected_sessions(arr, date_from=date_cls.today())
    if not sessions:
        return 0
    lecturers, students = _people(sessions)
    end = arr.effective_end
    back = end + timedelta(days=1)
    span = (f"on {arr.start_date:%A %d %b %Y}" if arr.start_date == end
            else f"from {arr.start_date:%d %b %Y} to {end:%d %b %Y}")
    rooms = sorted({e.room for e, _ in sessions if e.room})
    classes = _class_text(sessions)
    if action == "cancelled":
        title = "Classes stay on campus"
        msg = f"The planned online teaching for {classes} {span} was cancelled. Classes take place on campus as usual."
    elif action == "ended":
        title = "Back to campus teaching"
        msg = (f"{classes}: online teaching ends early. Classes are back on campus from {back:%A %d %b %Y}"
               + (f" (room {', '.join(rooms)})" if rooms else "") + ". The campus code and location check apply again.")
    else:
        title = "Classes move online" if action == "created" else "Online teaching updated"
        msg = (f"{classes} will be taught online {span}. Check in through FEBEMS from anywhere: no campus code "
               f"or location is needed, but your face is still checked. Back on campus from {back:%A %d %b %Y}"
               + (f" (room {', '.join(rooms)})" if rooms else "") + ".")
        if arr.meeting_link:
            msg += f" Online class link: {arr.meeting_link}"
        if arr.instructions:
            msg += f" {arr.instructions}"
    if note:
        msg += f" Note: {note}"
    n = notify(lecturers, type="notice", title=title, message=msg, link="/", related_id=arr.id,
               email_subject=f"FEBEMS – {title}")
    n += notify(students, type="class_notice", title=title, message=msg, link="/", related_id=arr.id,
                email_subject=f"FEBEMS – {title}", include_students=True)
    return n


def send_return_notices(today: date_cls | None = None) -> int:
    """On the last online day, remind everyone that classes are back on
    campus tomorrow (once per end date)."""
    from app.utils.notify import notify

    today = today or date_cls.today()
    sent = 0
    for a in OnlineArrangement.query.filter(OnlineArrangement.state != "cancelled").all():
        end = a.effective_end
        if end != today or a.return_notice_sent_for == end or a.start_date > today:
            continue
        sessions = affected_sessions(a)
        lecturers, students = _people(sessions)
        rooms = sorted({e.room for e, _ in sessions if e.room})
        msg = (f"Online teaching for {_class_text(sessions)} ends today. From {end + timedelta(days=1):%A %d %b %Y} "
               "classes are back on campus" + (f" (room {', '.join(rooms)})" if rooms else "")
               + ": the campus code and location check apply again.")
        sent += notify(lecturers, type="notice", title="Back on campus tomorrow", message=msg, link="/", related_id=a.id)
        sent += notify(students, type="class_notice", title="Back on campus tomorrow", message=msg, link="/",
                       related_id=a.id, include_students=True)
        a.return_notice_sent_for = end
    db.session.commit()
    return sent


def current_for_user(user, today: date_cls | None = None) -> list[dict]:
    """Active and upcoming online arrangements that touch this user's classes."""
    today = today or date_cls.today()
    if user.role == "lecturer":
        entries = Timetable.query.filter_by(lecturer_id=user.id).all()
    elif user.role == "student" and user.batch:
        entries = [e for e in Timetable.query.all() if user.batch in members(e.batch)]
    else:
        return []
    out = []
    for a in OnlineArrangement.query.filter(OnlineArrangement.state != "cancelled").all():
        if a.effective_end < today:
            continue
        mine = [e for e in entries if any(matches_scope(a, e, a.start_date + timedelta(days=i))
                                          for i in range(min(7, (a.effective_end - a.start_date).days + 1)))]
        if not mine:
            continue
        out.append({**a.to_dict(today), "classes": sorted({f"{e.course_name} ({e.batch})" for e in mine}),
                    "rooms": sorted({e.room for e in mine if e.room})})
    return sorted(out, key=lambda r: r["start_date"])
