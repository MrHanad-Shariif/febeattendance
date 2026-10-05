"""Batch (class) codes.

A timetable sheet can be shared by two batches taught together, written
"BTE13&BEE11". Students belong to one batch ("BTE13"), so every lookup from a
student's batch to classes, assignments or courses goes through these
helpers, which treat a combined code as containing each of its members.
"""
from sqlalchemy import or_

SEPARATOR = "&"


def members(code: str | None) -> list[str]:
    """"BTE13&BEE11" -> ["BTE13", "BEE11"]; "BCE08" -> ["BCE08"]."""
    return [part.strip() for part in (code or "").split(SEPARATOR) if part.strip()]


def batch_matches(class_batch: str | None, student_batch: str | None) -> bool:
    """Is a student of `student_batch` in the class taught to `class_batch`?"""
    if not class_batch or not student_batch:
        return False
    return class_batch == student_batch or student_batch in members(class_batch)


def batch_filter(column, student_batch: str):
    """SQL condition: `column` (a class batch) includes `student_batch`."""
    return or_(
        column == student_batch,
        column.like(f"{student_batch}{SEPARATOR}%"),
        column.like(f"%{SEPARATOR}{student_batch}"),
        column.like(f"%{SEPARATOR}{student_batch}{SEPARATOR}%"),
    )
