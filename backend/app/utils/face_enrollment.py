import io

from flask import request
from werkzeug.datastructures import FileStorage

from app.extensions import db
from app.models import StudentFace
from app.utils import face
from app.utils.settings import get_setting_float
from app.utils.uploads import save_student_photo
from app.utils.validation import ValidationError

# Registering the same face on two accounts is checked with a stricter bar
# than check-in matching, so look-alikes aren't wrongly refused.
DUPLICATE_MIN_THRESHOLD = 0.50

ALREADY_ENROLLED_MESSAGE = (
    "Your face is already registered. If you need to register it again, "
    "please contact the faculty office."
)
DUPLICATE_FACE_MESSAGE = (
    "This face is already registered to another student account. "
    "Each student may register only one account. Please contact the faculty office."
)


def clean_direction(value) -> str:
    if value not in ("left", "right"):
        raise ValidationError("The camera photos were incomplete. Please try again.")
    return value


def enroll_student_face(user) -> StudentFace:
    """Register ``user``'s face from the multipart request: three frontal
    frames (``frontal``) and one head-turned frame (``turned``) in the
    direction given by ``direction``."""
    if user.face is not None:
        raise ValidationError(ALREADY_ENROLLED_MESSAGE, status=409)

    direction = clean_direction(request.form.get("direction"))
    frontal = face.read_frames(request.files, "frontal", 3)
    turned = face.read_frames(request.files, "turned", 1)[0]

    embeddings, portrait = face.enroll(frontal, turned, direction)

    threshold = max(get_setting_float("face_match_threshold"), DUPLICATE_MIN_THRESHOLD)
    for other in StudentFace.query.filter(StudentFace.user_id != user.id).all():
        stored = face.unpack(other.embeddings)
        if any(face.best_match(e, stored) >= threshold for e in embeddings):
            raise ValidationError(DUPLICATE_FACE_MESSAGE, status=409)

    photo = face.encode_jpeg(portrait)
    if photo:
        user.photo_filename = save_student_photo(FileStorage(stream=io.BytesIO(photo), filename="face.jpg"))

    record = StudentFace(
        user_id=user.id,
        embeddings=face.pack(embeddings),
        model_version=face.MODEL_VERSION,
        enrolled_ip=request.remote_addr,
    )
    db.session.add(record)
    db.session.commit()
    return record
