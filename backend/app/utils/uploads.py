import os
import uuid

from flask import current_app
from PIL import Image, UnidentifiedImageError

from app.utils.validation import ValidationError

ALLOWED_FORMATS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
MAX_DIMENSION = 1024  # profile photos are shown small; cap the stored size
MAX_PIXELS = 25_000_000  # reject decompression bombs before decoding


def save_student_photo(file_storage) -> str | None:
    """Validate and store an uploaded profile photo.

    The file's *content* is decoded with Pillow (not just its extension), then
    re-encoded to a bounded-size image under a random name. Anything that isn't
    a real PNG/JPEG/WEBP is rejected, and metadata/embedded payloads are dropped
    by the re-encode. Returns the stored path relative to UPLOAD_FOLDER.
    """
    if not file_storage or not file_storage.filename:
        return None

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        image = Image.open(file_storage.stream)
        image_format = image.format
        if image_format not in ALLOWED_FORMATS:
            raise ValidationError("Photo must be a PNG, JPG, or WEBP image")
        image.load()
    except ValidationError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        raise ValidationError("That file is not a valid image")

    image.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
    if image_format == "JPEG" and image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    folder = os.path.join(current_app.config["UPLOAD_FOLDER"], "student_photos")
    os.makedirs(folder, exist_ok=True)

    filename = f"{uuid.uuid4().hex}.{ALLOWED_FORMATS[image_format]}"
    image.save(os.path.join(folder, filename), format=image_format)
    return f"student_photos/{filename}"
