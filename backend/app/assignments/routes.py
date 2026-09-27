"""Class assignments.

A lecturer sets an assignment for one of the classes they teach (course +
batch) with a deadline. Students of that batch attach files of any type
until their deadline; after it the assignment closes by itself and uploads
are refused on the server. The lecturer can move the deadline for everyone,
give individual students extra time, and comment on each submission.
"""
from flask import jsonify, request

from app.assignments import assignments_bp
from app.extensions import db
from app.models import (
    Assignment, AssignmentExtension, AssignmentSubmission, Course, SubmissionFile, Timetable, User, utcnow,
)
from app.utils.authz import current_user, roles_required
from app.utils.notify import notify, subject_for
from app.utils.permissions import require
from app.utils.uploads import delete_document, save_any_file, send_download
from app.utils.validation import ValidationError, clean_int, clean_text, parse_deadline

MAX_FILES_PER_SUBMISSION = 10
CLOSED_MESSAGE = "The deadline for this assignment has passed, so it is closed and no more files can be submitted."


def _payload():
    if request.files or request.form:
        return request.form
    return request.get_json(silent=True) or {}


def _fmt(dt) -> str:
    return f"{dt:%d %b %Y %H:%M}"


def lecturer_classes(user: User) -> list[dict]:
    """(course, batch) pairs the lecturer teaches: timetable rows plus
    courses the admin assigned to them."""
    pairs = {
        (c, b) for c, b in Timetable.query.with_entities(Timetable.course_name, Timetable.batch)
        .filter(Timetable.lecturer_id == user.id, Timetable.batch.isnot(None)).distinct()
    }
    pairs |= {
        (c, b) for c, b in Course.query.with_entities(Course.name, Course.batch)
        .filter(Course.lecturer_id == user.id, Course.batch.isnot(None)).distinct()
    }
    return [{"course_name": c, "batch": b} for c, b in sorted(pairs, key=lambda p: (p[1] or "", p[0]))]


def _assignment_or_404(assignment_id) -> Assignment:
    return Assignment.query.get_or_404(assignment_id)


def _require_owner(user: User, assignment: Assignment):
    require(user.role == "lecturer" and assignment.lecturer_id == user.id,
            "Only the lecturer who set this assignment can do that.")


def _require_student_of(user: User, assignment: Assignment):
    require(user.role == "student" and user.batch == assignment.batch, "This assignment is for another class.")


def _batch_students(batch: str) -> list[User]:
    return User.query.filter(User.role == "student", User.batch == batch, User.status == "active").order_by(User.name).all()


def _student_view(assignment: Assignment, student: User) -> dict:
    now = utcnow()
    data = assignment.to_dict()
    submission = AssignmentSubmission.query.filter_by(assignment_id=assignment.id, student_id=student.id).first()
    extension = assignment.extension_for(student.id)
    my_deadline = assignment.deadline_for(student.id)
    data.update({
        "my_deadline": my_deadline.isoformat(),
        "my_extension": extension.to_dict() if extension else None,
        "open": now < my_deadline,
        "seconds_left": max(0, int((my_deadline - now).total_seconds())),
        "submission": submission.to_dict() if submission else None,
        "submitted": bool(submission and submission.files),
    })
    return data


# ---------- Lecturer ----------

@assignments_bp.get("/assignments/my-classes")
@roles_required("lecturer")
def my_classes():
    return jsonify(lecturer_classes(current_user()))


@assignments_bp.get("/assignments")
@roles_required("lecturer", "student")
def list_assignments():
    user = current_user()
    if user.role == "student":
        if not user.batch:
            return jsonify([])
        rows = Assignment.query.filter_by(batch=user.batch).order_by(Assignment.deadline.desc()).all()
        return jsonify([_student_view(a, user) for a in rows])
    rows = Assignment.query.filter_by(lecturer_id=user.id).order_by(Assignment.deadline.desc()).all()
    out = []
    for a in rows:
        data = a.to_dict()
        data["student_count"] = len(_batch_students(a.batch))
        data["submitted_count"] = sum(1 for s in a.submissions if s.files)
        out.append(data)
    return jsonify(out)


@assignments_bp.post("/assignments")
@roles_required("lecturer")
def create_assignment():
    user = current_user()
    data = _payload()
    course_name = clean_text(data.get("course_name"), "Course", max_len=255, required=True)
    batch = clean_text(data.get("batch"), "Batch", max_len=50, required=True)
    if {"course_name": course_name, "batch": batch} not in lecturer_classes(user):
        raise ValidationError("You can only set assignments for classes you teach.", status=403)
    deadline = parse_deadline(data.get("deadline"))
    if deadline is None:
        raise ValidationError("Deadline is required")
    if deadline <= utcnow():
        raise ValidationError("The deadline must be in the future")

    assignment = Assignment(
        lecturer_id=user.id, course_name=course_name, batch=batch, deadline=deadline,
        title=clean_text(data.get("title"), "Title", max_len=255, required=True),
        instructions=clean_text(data.get("instructions"), "Instructions", max_len=20000),
    )
    saved = save_any_file(request.files.get("file"), "assignments")
    if saved:
        assignment.file_name, assignment.file_path, _ = saved
    db.session.add(assignment)
    db.session.flush()
    notify(
        _batch_students(batch), type="assignment", include_students=True,
        title=f"New assignment: {assignment.title}",
        message=f"{course_name} ({batch}). Deadline: {_fmt(deadline)}.",
        link=f"/assignments/{assignment.id}", related_id=assignment.id,
        email_subject=subject_for("assignment_new", assignment.title),
        email_lines=[
            f"Course: {course_name} ({batch})",
            f"Assignment: {assignment.title}",
            f"Lecturer: {user.name}",
            f"Deadline: {_fmt(deadline)}",
            "Submissions close automatically at the deadline.",
        ],
    )
    db.session.commit()
    return jsonify(assignment.to_dict()), 201


@assignments_bp.get("/assignments/<int:assignment_id>")
@roles_required("lecturer", "student")
def get_assignment(assignment_id):
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    if user.role == "student":
        _require_student_of(user, assignment)
        return jsonify(_student_view(assignment, user))

    _require_owner(user, assignment)
    now = utcnow()
    submissions = {s.student_id: s for s in assignment.submissions}
    roster = []
    for student in _batch_students(assignment.batch):
        sub = submissions.get(student.id)
        ext = assignment.extension_for(student.id)
        deadline = assignment.deadline_for(student.id)
        roster.append({
            "student_id": student.id,
            "student_name": student.name,
            "student_id_number": student.student_id_number,
            "deadline": deadline.isoformat(),
            "open": now < deadline,
            "extension": ext.to_dict() if ext else None,
            "submission": sub.to_dict() if sub else None,
            "submitted": bool(sub and sub.files),
            "late": bool(sub and sub.files and sub.updated_at and sub.updated_at > assignment.deadline),
        })
    data = assignment.to_dict()
    data["roster"] = roster
    return jsonify(data)


@assignments_bp.put("/assignments/<int:assignment_id>")
@roles_required("lecturer")
def update_assignment(assignment_id):
    """Edit the assignment, including moving the deadline for everyone
    (which re-opens it if the new deadline is in the future)."""
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    _require_owner(user, assignment)
    data = _payload()
    if "title" in data:
        assignment.title = clean_text(data.get("title"), "Title", max_len=255, required=True)
    if "instructions" in data:
        assignment.instructions = clean_text(data.get("instructions"), "Instructions", max_len=20000)
    extended_to = None
    if "deadline" in data:
        deadline = parse_deadline(data.get("deadline"))
        if deadline is None:
            raise ValidationError("Deadline is required")
        if deadline != assignment.deadline:
            if deadline > assignment.deadline and deadline > utcnow():
                extended_to = deadline
            assignment.deadline = deadline
    saved = save_any_file(request.files.get("file"), "assignments")
    if saved:
        delete_document(assignment.file_path)
        assignment.file_name, assignment.file_path, _ = saved
    if extended_to:
        notify(
            _batch_students(assignment.batch), type="assignment", include_students=True,
            title=f"Deadline extended: {assignment.title}",
            message=f"The new deadline is {_fmt(extended_to)}.",
            link=f"/assignments/{assignment.id}", related_id=assignment.id,
            email_subject=subject_for("assignment_extended", assignment.title),
        )
    db.session.commit()
    return jsonify(assignment.to_dict())


@assignments_bp.delete("/assignments/<int:assignment_id>")
@roles_required("lecturer")
def delete_assignment(assignment_id):
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    _require_owner(user, assignment)
    paths = [f.file_path for s in assignment.submissions for f in s.files] + [assignment.file_path]
    db.session.delete(assignment)
    db.session.commit()
    for path in paths:
        delete_document(path)
    return jsonify({"message": "Assignment deleted"})


@assignments_bp.get("/assignments/<int:assignment_id>/brief")
@roles_required("lecturer", "student")
def download_brief(assignment_id):
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    if user.role == "student":
        _require_student_of(user, assignment)
    else:
        _require_owner(user, assignment)
    if not assignment.file_path:
        return jsonify({"error": "Not found"}), 404
    return send_download(assignment.file_path, assignment.file_name)


@assignments_bp.post("/assignments/<int:assignment_id>/extensions")
@roles_required("lecturer")
def grant_extension(assignment_id):
    """Give one student extra time (replaces any earlier extension)."""
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    _require_owner(user, assignment)
    data = request.get_json(silent=True) or {}
    student_id = clean_int(data.get("student_id"), "Student", minimum=1)
    student = User.query.filter_by(id=student_id, role="student", batch=assignment.batch).first() if student_id else None
    if not student:
        raise ValidationError("Choose a student from this class")
    deadline = parse_deadline(data.get("deadline"))
    if deadline is None or deadline <= utcnow():
        raise ValidationError("The extended deadline must be in the future")
    if deadline <= assignment.deadline:
        raise ValidationError("The extended deadline must be later than the assignment's deadline")
    ext = assignment.extension_for(student.id)
    if ext is None:
        ext = AssignmentExtension(assignment=assignment, student_id=student.id)
        db.session.add(ext)
    ext.deadline = deadline
    ext.reason = clean_text(data.get("reason"), "Reason", max_len=500)
    ext.granted_by_id = user.id
    ext.granted_at = utcnow()
    notify(
        [student], type="assignment", include_students=True,
        title=f"Extra time granted: {assignment.title}",
        message=f"You may now submit until {_fmt(deadline)}.",
        link=f"/assignments/{assignment.id}", related_id=assignment.id,
        email_subject=subject_for("assignment_extended", assignment.title),
    )
    db.session.commit()
    return jsonify(ext.to_dict()), 201


@assignments_bp.delete("/assignments/<int:assignment_id>/extensions/<int:student_id>")
@roles_required("lecturer")
def revoke_extension(assignment_id, student_id):
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    _require_owner(user, assignment)
    ext = AssignmentExtension.query.filter_by(assignment_id=assignment.id, student_id=student_id).first_or_404()
    db.session.delete(ext)
    db.session.commit()
    return jsonify({"message": "Extension removed"})


@assignments_bp.put("/assignments/submissions/<int:submission_id>/comment")
@roles_required("lecturer")
def comment_on_submission(submission_id):
    user = current_user()
    submission = AssignmentSubmission.query.get_or_404(submission_id)
    _require_owner(user, submission.assignment)
    data = request.get_json(silent=True) or {}
    submission.lecturer_comment = clean_text(data.get("comment"), "Comment", max_len=5000)
    submission.commented_at = utcnow() if submission.lecturer_comment else None
    if submission.lecturer_comment:
        notify(
            [submission.student], type="assignment", include_students=True,
            title=f"Lecturer comment: {submission.assignment.title}",
            message=submission.lecturer_comment[:300],
            link=f"/assignments/{submission.assignment_id}", related_id=submission.assignment_id,
            email_subject=subject_for("assignment_comment", submission.assignment.title),
        )
    db.session.commit()
    return jsonify(submission.to_dict())


# ---------- Student ----------

def _require_open(assignment: Assignment, student: User):
    if not assignment.is_open_for(student.id):
        raise ValidationError(CLOSED_MESSAGE, status=403)


@assignments_bp.post("/assignments/<int:assignment_id>/submission")
@roles_required("student")
def submit(assignment_id):
    """Attach files (multipart `files`, any type) and/or a note. Allowed
    until the student's deadline; closed afterwards."""
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    _require_student_of(user, assignment)
    _require_open(assignment, user)

    uploads = [f for f in request.files.getlist("files") if f and f.filename]
    submission = AssignmentSubmission.query.filter_by(assignment_id=assignment.id, student_id=user.id).first()
    existing = len(submission.files) if submission else 0
    if existing + len(uploads) > MAX_FILES_PER_SUBMISSION:
        raise ValidationError(f"You can attach at most {MAX_FILES_PER_SUBMISSION} files to one assignment")
    if not uploads and not existing:
        raise ValidationError("Attach at least one file")

    now = utcnow()
    if submission is None:
        submission = AssignmentSubmission(assignment=assignment, student_id=user.id, submitted_at=now)
        db.session.add(submission)
    if "note" in request.form:
        submission.note = clean_text(request.form.get("note"), "Note", max_len=5000)
    saved_paths = []
    try:
        for upload in uploads:
            name, path, size = save_any_file(upload, "submissions")
            saved_paths.append(path)
            submission.files.append(SubmissionFile(file_name=name, file_path=path, size_bytes=size, uploaded_at=now))
    except ValidationError:
        for path in saved_paths:
            delete_document(path)
        raise
    submission.updated_at = now
    if uploads and existing == 0:
        notify(
            [assignment.lecturer], type="assignment",
            title=f"Submission received: {assignment.title}",
            message=f"{user.name} ({assignment.batch}) submitted {len(uploads)} file(s).",
            link=f"/assignments/{assignment.id}", related_id=assignment.id,
        )
    db.session.commit()
    return jsonify(_student_view(assignment, user)), 201


@assignments_bp.delete("/assignments/<int:assignment_id>/submission/files/<int:file_id>")
@roles_required("student")
def remove_submission_file(assignment_id, file_id):
    user = current_user()
    assignment = _assignment_or_404(assignment_id)
    _require_student_of(user, assignment)
    _require_open(assignment, user)
    submission = AssignmentSubmission.query.filter_by(assignment_id=assignment.id, student_id=user.id).first_or_404()
    row = SubmissionFile.query.filter_by(id=file_id, submission_id=submission.id).first_or_404()
    path = row.file_path
    db.session.delete(row)
    submission.updated_at = utcnow()
    db.session.commit()
    delete_document(path)
    return jsonify(_student_view(assignment, user))


@assignments_bp.get("/assignments/submissions/<int:submission_id>/files/<int:file_id>")
@roles_required("lecturer", "student")
def download_submission_file(submission_id, file_id):
    user = current_user()
    submission = AssignmentSubmission.query.get_or_404(submission_id)
    if user.role == "student":
        require(submission.student_id == user.id)
    else:
        _require_owner(user, submission.assignment)
    row = SubmissionFile.query.filter_by(id=file_id, submission_id=submission.id).first_or_404()
    return send_download(row.file_path, row.file_name)
