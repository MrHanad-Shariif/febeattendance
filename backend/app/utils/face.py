"""Face detection, embedding and liveness checks for student check-in.

Uses OpenCV's YuNet detector and SFace recognizer (both Apache-2.0 models from
opencv_zoo, ~40 MB together, CPU only). Models are loaded once per process on
first use. A small semaphore caps concurrent face jobs so a class checking in
at once can't pin both CPUs of the shared VPS.

Frames are the *unmirrored* camera frames the browser captures (a canvas
drawImage of the <video>), so a student turning their head to their own left
moves their nose toward the image's right edge.
"""
import os
import threading
from dataclasses import dataclass

from flask import current_app

from app.utils.validation import ValidationError

MODEL_VERSION = "sface-2021dec"
DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"

MAX_FRAME_BYTES = 1_500_000
MAX_SIDE = 960  # downscale before detection; faces fill a selfie frame anyway
MIN_FACE_PX = 80
DETECT_SCORE = 0.8

# Head-turn liveness: (nose offset from the eye midpoint) / (eye distance),
# roughly 0.5 * tan(head angle). The browser sends a burst of frames while the
# student turns, and the check passes if any one of them shows the turn, so a
# student who turns a little early or late is no longer refused.
FRONTAL_MAX_YAW = 0.35  # "look straight" frame: within ~35 degrees (phones are often held off-centre)
TURN_MIN_DELTA = 0.12  # best turned frame must move at least this far (~15 degrees), the asked way
SAME_PERSON_TURNED = 0.25  # turned vs frontal similarity; profiles score lower
SAME_PERSON_FRONTAL = 0.45  # enrollment frames must clearly be one person
MAX_TURNED_FRAMES = 10
MAX_TURN_EMBEDDINGS = 3  # same-person check on at most this many of the best-turned frames

BUSY_TIMEOUT_SECONDS = 20

_load_lock = threading.Lock()
_models = None
_slots = threading.BoundedSemaphore(2)


class FaceError(ValidationError):
    """A problem with the captured frames the student can fix by retrying."""

    def __init__(self, message: str, reason: str = "bad_image", stage: str = "", check: "TurnCheck | None" = None):
        super().__init__(message, status=422)
        self.reason = reason
        self.stage = stage  # which check failed, for the attempt log
        self.check = check


@dataclass
class TurnCheck:
    """What the head-turn check measured, kept on every logged attempt so the
    thresholds can be tuned from real data."""
    direction: str
    frontal_yaw: float
    frames: int = 0  # turned frames received
    turn: float | None = None  # best movement the asked way (yaw delta)
    similarity: float | None = None  # frontal vs the accepted (or best) turned frame


@dataclass
class Face:
    embedding: "object"  # np.ndarray float32, L2-normalised
    yaw: float
    portrait: "object"  # np.ndarray BGR crop around the face, for the profile photo


def _load_models():
    global _models
    if _models is None:
        with _load_lock:
            if _models is None:
                import cv2

                cv2.setNumThreads(1)
                model_dir = current_app.config["FACE_MODEL_DIR"]
                detector = cv2.FaceDetectorYN.create(
                    os.path.join(model_dir, DETECTOR_FILE), "", (320, 320), DETECT_SCORE, 0.3, 50
                )
                recognizer = cv2.FaceRecognizerSF.create(os.path.join(model_dir, RECOGNIZER_FILE), "")
                _models = (detector, recognizer, threading.Lock(), threading.Lock())
    return _models


def _decode(image_bytes: bytes):
    import cv2
    import numpy as np

    if not image_bytes or len(image_bytes) > MAX_FRAME_BYTES:
        raise FaceError("The camera image could not be read. Please try again.", stage="unreadable")
    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise FaceError("The camera image could not be read. Please try again.", stage="unreadable")
    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    return img


def _detect(image_bytes: bytes):
    """Decode and find the one face. Returns (image, face row, yaw)."""
    detector, _, detector_lock, _ = _load_models()
    img = _decode(image_bytes)
    h, w = img.shape[:2]

    # OpenCV model objects aren't safe to share between threads mid-call.
    with detector_lock:
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)

    if faces is None or len(faces) == 0:
        raise FaceError("We couldn't see your face clearly. Face the camera in good light and try again.", stage="no_face")

    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    largest = faces[0]
    if len(faces) > 1 and faces[1][2] * faces[1][3] > 0.35 * largest[2] * largest[3]:
        raise FaceError("More than one face is in view. Make sure only you are in front of the camera.", stage="several_faces")
    if min(largest[2], largest[3]) < MIN_FACE_PX:
        raise FaceError("Your face is too far from the camera. Move a little closer and try again.", stage="too_far")

    right_eye, left_eye, nose = largest[4:6], largest[6:8], largest[8:10]
    eye_dist = abs(left_eye[0] - right_eye[0]) or 1.0
    yaw = float((nose[0] - (left_eye[0] + right_eye[0]) / 2) / eye_dist)
    return img, largest, yaw


def _embed(img, largest):
    import numpy as np

    _, recognizer, _, recognizer_lock = _load_models()
    with recognizer_lock:
        aligned = recognizer.alignCrop(img, largest)
        feature = recognizer.feature(aligned).flatten().astype(np.float32)
    norm = np.linalg.norm(feature)
    if not norm:
        raise FaceError("We couldn't see your face clearly. Face the camera in good light and try again.", stage="no_face")
    return feature / norm


def _analyze(image_bytes: bytes) -> Face:
    img, largest, yaw = _detect(image_bytes)
    h, w = img.shape[:2]
    x, y, fw, fh = (int(v) for v in largest[:4])
    pad = int(max(fw, fh) * 0.4)
    portrait = img[max(0, y - pad):min(h, y + fh + pad), max(0, x - pad):min(w, x + fw + pad)]
    return Face(embedding=_embed(img, largest), yaw=yaw, portrait=portrait)


def similarity(a, b) -> float:
    import numpy as np

    return float(np.dot(a, b))


def best_match(embedding, enrolled: list) -> float:
    return max((similarity(embedding, e) for e in enrolled), default=0.0)


def _check_turn(frontal: Face, turned_frames: list[bytes], direction: str) -> TurnCheck:
    """Pass if any turned frame shows the head turned the asked way, by the
    same person. Raises FaceError (with the measurements) otherwise."""
    check = TurnCheck(direction=direction, frontal_yaw=round(frontal.yaw, 3), frames=len(turned_frames))
    if abs(frontal.yaw) > FRONTAL_MAX_YAW:
        raise FaceError("For the first photo, look straight at the camera. Please try again.",
                        "no_liveness", "not_frontal", check)

    candidates = []
    for frame in turned_frames:
        try:
            img, largest, yaw = _detect(frame)
        except FaceError:
            continue  # mid-turn blur or turned too far: another frame may still show it
        delta = yaw - frontal.yaw
        # Student's own left = image right (unmirrored frame) = positive yaw.
        candidates.append((delta if direction == "left" else -delta, img, largest))
    if not candidates:
        raise FaceError("We lost sight of your face while you turned. Turn your head only a little, "
                        "keep your face inside the oval, and try again.", "bad_image", "turn_face_lost", check)

    candidates.sort(key=lambda c: c[0], reverse=True)
    check.turn = round(float(candidates[0][0]), 3)
    turned_enough = [c for c in candidates if c[0] >= TURN_MIN_DELTA][:MAX_TURN_EMBEDDINGS]
    if not turned_enough:
        raise FaceError(
            f"We couldn't confirm the head turn. When asked, turn your head a little to your {direction} "
            "(as if looking at your shoulder) and hold it until the check starts.",
            "no_liveness", "turn_too_small", check,
        )
    for _, img, largest in turned_enough:
        sim = similarity(frontal.embedding, _embed(img, largest))
        check.similarity = round(max(sim, check.similarity or -1.0), 3)
        if sim >= SAME_PERSON_TURNED:
            check.similarity = round(sim, 3)
            return check
    raise FaceError("The photos don't appear to show the same person. Please try again.",
                    "no_liveness", "turn_other_person", check)


def _run(fn):
    if not _slots.acquire(timeout=BUSY_TIMEOUT_SECONDS):
        raise ValidationError("The server is busy checking other students. Please try again in a moment.", status=503)
    try:
        return fn()
    finally:
        _slots.release()


def read_frames(files, field: str, count: int, maximum: int | None = None) -> list[bytes]:
    """Exactly ``count`` frames, or ``count`` to ``maximum`` when given."""
    frames = [f.read(MAX_FRAME_BYTES + 1) for f in files.getlist(field)]
    if not count <= len(frames) <= (maximum or count):
        raise ValidationError("The camera photos were incomplete. Please try again.")
    return frames


def enroll(frontal_frames: list[bytes], turned_frames: list[bytes], direction: str):
    """Analyse enrollment frames. Returns (embeddings, portrait crop).
    Raises FaceError if the frames aren't one live, clearly visible face."""
    def work():
        frontal = [_analyze(b) for b in frontal_frames]
        for other in frontal[1:]:
            if similarity(frontal[0].embedding, other.embedding) < SAME_PERSON_FRONTAL:
                raise FaceError("The photos don't appear to show the same person. Please try again.")
        _check_turn(frontal[0], turned_frames, direction)
        return [f.embedding for f in frontal], frontal[0].portrait

    return _run(work)


def verify(frontal_frame: bytes, turned_frames: list[bytes], direction: str, enrolled: list):
    """Liveness-check the frames. Returns (best similarity to the enrolled
    embeddings, TurnCheck). Raises FaceError for liveness/image problems."""
    def work():
        frontal = _analyze(frontal_frame)
        check = _check_turn(frontal, turned_frames, direction)
        return best_match(frontal.embedding, enrolled), check

    return _run(work)


def pack(embeddings: list) -> bytes:
    import numpy as np

    return np.stack(embeddings).astype(np.float32).tobytes()


def unpack(blob: bytes) -> list:
    import numpy as np

    return list(np.frombuffer(blob, dtype=np.float32).reshape(-1, 128))


def encode_jpeg(image) -> bytes:
    import cv2

    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes() if ok else b""
