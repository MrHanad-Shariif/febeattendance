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


# ---------- Committee documents (agendas, minutes, task evidence, notices) ----------

PRIVATE_DIR = "private"

# Recognised by content, not by the name the browser sent.
_DOCUMENT_SIGNATURES = (
    (b"%PDF-", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
)
_ZIP_MAGIC = b"PK\x03\x04"  # docx / xlsx / pptx are zip containers
_OFFICE_EXTENSIONS = {"docx", "xlsx", "pptx"}
MAX_DOCUMENT_NAME = 200


def _display_name(filename: str) -> str:
    name = os.path.basename(filename.replace("\\", "/")).strip() or "document"
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '"<>|:*?')
    return name[-MAX_DOCUMENT_NAME:]


def save_document(file_storage, kind: str) -> tuple[str, str] | None:
    """Validate and store a committee document under UPLOAD_FOLDER/private/<kind>/.

    Accepts PDF, PNG, JPG and Office (docx/xlsx/pptx) files, identified by
    their leading bytes. Files are stored under a random name and are only
    ever served through routes that check the requester's permission (the
    generic /api/uploads route refuses the private folder).
    Returns (display_name, stored_relative_path) or None if no file was sent.
    """
    if not file_storage or not file_storage.filename:
        return None

    head = file_storage.stream.read(8)
    file_storage.stream.seek(0)
    extension = next((ext for magic, ext in _DOCUMENT_SIGNATURES if head.startswith(magic)), None)
    if extension is None and head.startswith(_ZIP_MAGIC):
        claimed = file_storage.filename.rsplit(".", 1)[-1].lower() if "." in file_storage.filename else ""
        if claimed in _OFFICE_EXTENSIONS:
            extension = claimed
    if extension is None:
        raise ValidationError("File must be a PDF, Word, Excel, PowerPoint, PNG or JPG document")

    folder = os.path.join(current_app.config["UPLOAD_FOLDER"], PRIVATE_DIR, kind)
    os.makedirs(folder, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.{extension}"
    file_storage.save(os.path.join(folder, stored))
    return _display_name(file_storage.filename), f"{PRIVATE_DIR}/{kind}/{stored}"


def send_document(relative_path: str, display_name: str, inline: bool = False):
    """Stream a stored private document. Callers must check permission first."""
    from flask import send_from_directory

    return send_from_directory(
        current_app.config["UPLOAD_FOLDER"], relative_path,
        as_attachment=not inline, download_name=display_name,
    )


def delete_document(relative_path: str | None):
    if not relative_path or not relative_path.startswith(PRIVATE_DIR + "/"):
        return
    try:
        os.remove(os.path.join(current_app.config["UPLOAD_FOLDER"], relative_path))
    except OSError:
        pass


def save_generated_document(data: bytes, kind: str, display_name: str, extension: str = "pdf") -> tuple[str, str]:
    """Store a document the system produced (e.g. a generated PDF) the same
    way as an uploaded one. Returns (display_name, stored_relative_path)."""
    folder = os.path.join(current_app.config["UPLOAD_FOLDER"], PRIVATE_DIR, kind)
    os.makedirs(folder, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.{extension}"
    with open(os.path.join(folder, stored), "wb") as fh:
        fh.write(data)
    return _display_name(display_name), f"{PRIVATE_DIR}/{kind}/{stored}"


# ---------- Assignment submissions (any file type) ----------

MAX_SUBMISSION_BYTES = 15 * 1024 * 1024


def save_any_file(file_storage, kind: str) -> tuple[str, str, int] | None:
    """Store a student's submission file of any type.

    The content is never interpreted: it is stored under a random name with
    no extension and only ever served back as a download
    (application/octet-stream, Content-Disposition: attachment) by routes that
    check permission, so a file can't run in the browser as a page or script.
    Returns (display_name, stored_relative_path, size_bytes)."""
    if not file_storage or not file_storage.filename:
        return None
    folder = os.path.join(current_app.config["UPLOAD_FOLDER"], PRIVATE_DIR, kind)
    os.makedirs(folder, exist_ok=True)
    stored = uuid.uuid4().hex
    full = os.path.join(folder, stored)
    file_storage.save(full)
    size = os.path.getsize(full)
    if size == 0:
        os.remove(full)
        raise ValidationError(f"{_display_name(file_storage.filename)} is empty")
    if size > MAX_SUBMISSION_BYTES:
        os.remove(full)
        raise ValidationError("Each file must be 15 MB or smaller")
    return _display_name(file_storage.filename), f"{PRIVATE_DIR}/{kind}/{stored}", size


def send_download(relative_path: str, display_name: str):
    """Serve a stored file strictly as a download, whatever it contains."""
    from flask import send_from_directory

    return send_from_directory(
        current_app.config["UPLOAD_FOLDER"], relative_path,
        as_attachment=True, download_name=display_name, mimetype="application/octet-stream",
    )
