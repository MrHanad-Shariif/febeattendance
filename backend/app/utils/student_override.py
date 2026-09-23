"""Shared logic for admin/lecturer overrides of a student's recorded status
(e.g. turning an unjustified Absent into Present, or correcting a Late).

A remark is mandatory: without one, the change is rejected outright so there
is always a documented reason on file, and the record keeps track of exactly
who made the change (and whether they were the course's lecturer or an
admin), so it's clear later who authorized the alteration.
"""
from app.extensions import db


def apply_override(record, status: str, remarks: str, actor) -> str | None:
    """Returns an error message if the override was rejected, or None on success."""
    if remarks is not None and not isinstance(remarks, str):
        return "Remarks must be text."
    remarks = (remarks or "").strip()
    if not remarks:
        return "A remark explaining the change is required."
    if len(remarks) > 500:
        return "Remarks must be at most 500 characters."

    if status:
        if not isinstance(status, str) or status not in record.STATUS_LABELS:
            return "Invalid status."
        record.status = status

    record.remarks = remarks
    record.modified_by_id = actor.id
    record.modified_by_role = actor.role

    db.session.commit()
    return None
