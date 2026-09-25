"""Audit trail for tasks (brief item 32). Every route or job that changes a
task records what changed, who did it and when, through record_event()."""
from datetime import datetime

from app.extensions import db
from app.models import Task, TaskEvent, User


def _jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def record_event(task: Task, actor: User | None, action: str, old=None, new=None, note: str | None = None):
    event = TaskEvent(
        task=task,
        actor_id=actor.id if actor else None,
        action=action,
        old_value=_jsonable(old),
        new_value=_jsonable(new),
        note=(note or "")[:500] or None,
    )
    db.session.add(event)
    return event
