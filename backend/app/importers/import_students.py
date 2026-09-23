"""Import the official student roster export (a GridView "Excel" export that
is actually an HTML table saved with an .xls extension -- a common pattern
from web-based student information systems).

Only a bare skeleton is created here (ID, name, email, batch, department) and
status is left as 'invited': most students will actually activate their
account themselves via the public registration page using a personal email
(see auth.routes.register_student, which "claims" this pre-imported record by
matching the student ID number instead of creating a duplicate), since not
everyone has access to their official @student.simad.edu.so inbox yet.

The roster's "Class" column (e.g. "BTE13-A") includes a section letter that
we deliberately ignore -- only the "Batch" column (e.g. "BTE13", already
without a section) is used, matching the Timetable's own batch codes.

Usage (from backend/, with the venv active):
    flask import-students "..\\stdsRegistered23092026_060313.xls"
"""
import re
from html.parser import HTMLParser

from app.extensions import db
from app.models import User
from app.utils.constants import DEPARTMENTS

DEPARTMENT_KEYWORDS = [
    ("architecture", "Architecture"),
    ("civil", "Civil Engineering"),
    ("telecommunication", "Telecommunication Engineering"),
    ("electrical", "Electrical Engineering"),
    ("city", "City & Regional Planning"),
    ("regional", "City & Regional Planning"),
    ("planning", "City & Regional Planning"),
]

BATCH_PREFIX_DEPARTMENT = {
    "BARE": "Architecture",
    "BCE": "Civil Engineering",
    "BTE": "Telecommunication Engineering",
    "BEE": "Electrical Engineering",
    "BCRP": "City & Regional Planning",
}


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.current_row = None
        self.current_cell = None
        self.in_cell = False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.current_row = []
        elif tag in ("td", "th"):
            self.in_cell = True
            self.current_cell = []

    def handle_endtag(self, tag):
        if tag == "tr" and self.current_row is not None:
            self.rows.append(self.current_row)
            self.current_row = None
        elif tag in ("td", "th"):
            if self.current_row is not None:
                self.current_row.append("".join(self.current_cell).strip())
            self.in_cell = False
            self.current_cell = None

    def handle_data(self, data):
        if self.in_cell:
            self.current_cell.append(data)


def _parse_html_table(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        html = f.read()
    parser = _TableParser()
    parser.feed(html)
    if not parser.rows:
        return []
    header = parser.rows[0]
    return [dict(zip(header, row)) for row in parser.rows[1:] if len(row) == len(header)]


def _guess_department(program: str, batch: str) -> str | None:
    program_l = (program or "").lower()
    for keyword, dept in DEPARTMENT_KEYWORDS:
        if keyword in program_l:
            return dept
    for prefix, dept in BATCH_PREFIX_DEPARTMENT.items():
        if (batch or "").startswith(prefix):
            return dept
    return None


def import_students(path: str):
    records = _parse_html_table(path)
    if not records:
        print("No rows found -- is this the right file?")
        return

    created = 0
    skipped_existing = 0
    skipped_incomplete = 0

    for r in records:
        student_id = (r.get("StudentId") or "").strip()
        name = (r.get("Name") or "").strip()
        email = (r.get("Email") or "").strip().lower()
        batch = (r.get("Batch") or "").strip() or None
        program = (r.get("Program") or "").strip()

        if not student_id or not name:
            skipped_incomplete += 1
            continue

        if User.query.filter_by(student_id_number=student_id, role="student").first():
            skipped_existing += 1
            continue

        department = _guess_department(program, batch)
        if department not in DEPARTMENTS:
            department = None

        final_email = email or f"pending+{re.sub(r'[^a-z0-9]', '', student_id.lower())}@example.invalid"
        if User.query.filter_by(email=final_email).first():
            final_email = f"pending+{re.sub(r'[^a-z0-9]', '', student_id.lower())}@example.invalid"

        db.session.add(User(
            name=name, email=final_email, role="student", status="invited",
            student_id_number=student_id, department=department, batch=batch,
        ))
        created += 1

    db.session.commit()
    print(f"Imported {created} new students. Skipped {skipped_existing} already on file, {skipped_incomplete} incomplete rows.")
    print("These are unclaimed (status='invited') until each student signs up at /register with their ID number, "
          "which attaches their own login to this record instead of creating a duplicate.")
