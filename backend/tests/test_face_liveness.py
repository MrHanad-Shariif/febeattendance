"""The head-turn liveness check, with face detection and embedding stubbed:
each fake "frame" is just the yaw (or None for no face) the detector reports."""
import numpy as np
import pytest

from app.utils import face

SAME = np.array([1.0, 0.0], np.float32)
OTHER = np.array([0.0, 1.0], np.float32)


@pytest.fixture()
def frames(monkeypatch):
    """Frames are dicts: {"yaw": float | None, "who": SAME | OTHER}."""
    def detect(frame):
        if frame["yaw"] is None:
            raise face.FaceError("no face", stage="no_face")
        return None, frame, frame["yaw"]

    monkeypatch.setattr(face, "_detect", detect)
    monkeypatch.setattr(face, "_embed", lambda img, row: row["who"])


def frontal(yaw=0.0):
    return face.Face(embedding=SAME, yaw=yaw, portrait=None)


def f(yaw, who=SAME):
    return {"yaw": yaw, "who": who}


def test_one_turned_frame_in_the_burst_is_enough(frames):
    # Student turned late: only the last frame shows it. Left = positive yaw.
    check = face._check_turn(frontal(), [f(0.0), f(0.02), f(0.05), f(0.2)], "left")
    assert check.turn == 0.2 and check.frames == 4 and check.similarity == 1.0


def test_right_turn_is_negative_yaw(frames):
    assert face._check_turn(frontal(0.05), [f(-0.1)], "right").turn == pytest.approx(0.15)


def test_turning_the_wrong_way_fails(frames):
    with pytest.raises(face.FaceError) as err:
        face._check_turn(frontal(), [f(0.3), f(0.4)], "right")
    assert (err.value.reason, err.value.stage) == ("no_liveness", "turn_too_small")
    assert err.value.check.turn == -0.3


def test_too_small_a_turn_fails(frames):
    with pytest.raises(face.FaceError) as err:
        face._check_turn(frontal(), [f(0.05), f(0.08)], "left")
    assert err.value.stage == "turn_too_small" and err.value.check.turn == 0.08


def test_modest_turn_now_passes(frames):
    # 0.14 (about 15 degrees) was refused by the old 0.18 bar.
    assert face._check_turn(frontal(), [f(0.14)], "left").turn == 0.14


def test_first_photo_must_be_roughly_frontal(frames):
    face._check_turn(frontal(0.3), [f(0.5)], "left")  # 0.3 is now accepted (was refused above 0.25)
    with pytest.raises(face.FaceError) as err:
        face._check_turn(frontal(0.4), [f(0.6)], "left")
    assert (err.value.reason, err.value.stage) == ("no_liveness", "not_frontal")


def test_frames_where_the_face_is_lost_are_skipped(frames):
    assert face._check_turn(frontal(), [f(None), f(0.25), f(None)], "left").turn == 0.25


def test_face_lost_in_every_turned_frame_is_a_retry_not_a_strike(frames):
    with pytest.raises(face.FaceError) as err:
        face._check_turn(frontal(), [f(None), f(None)], "left")
    assert (err.value.reason, err.value.stage) == ("bad_image", "turn_face_lost")


def test_turned_frame_of_another_person_fails(frames):
    with pytest.raises(face.FaceError) as err:
        face._check_turn(frontal(), [f(0.3, OTHER), f(0.25, OTHER)], "left")
    assert (err.value.reason, err.value.stage) == ("no_liveness", "turn_other_person")


def test_falls_back_to_a_smaller_turn_by_the_same_person(frames):
    check = face._check_turn(frontal(), [f(0.5, OTHER), f(0.2)], "left")
    assert check.similarity == 1.0


def test_read_frames_accepts_a_range():
    from werkzeug.datastructures import FileStorage, MultiDict
    import io

    files = MultiDict([("turned", FileStorage(io.BytesIO(b"x"))) for _ in range(3)])
    assert len(face.read_frames(files, "turned", 1, 5)) == 3
    with pytest.raises(face.ValidationError):
        face.read_frames(files, "turned", 1)
    with pytest.raises(face.ValidationError):
        face.read_frames(files, "turned", 4, 5)
