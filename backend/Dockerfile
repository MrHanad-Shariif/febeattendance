# Backend image: Flask API served by gunicorn.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# tzdata: the app runs on campus-local time (APP_TIMEZONE), which needs the zoneinfo database.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Face models (OpenCV zoo, Apache-2.0): YuNet detector + SFace recognizer.
# Pinned by SHA-256 so a changed upstream file fails the build instead of
# silently changing how faces are matched.
RUN mkdir -p /app/models && python - <<'PY'
import hashlib, urllib.request
base = "https://github.com/opencv/opencv_zoo/raw/main/models/"
models = {
    "face_detection_yunet_2023mar.onnx": ("face_detection_yunet/", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "face_recognition_sface_2021dec.onnx": ("face_recognition_sface/", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
}
for name, (folder, sha256) in models.items():
    data = urllib.request.urlopen(base + folder + name, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != sha256:
        raise SystemExit(f"Checksum mismatch for {name}")
    open(f"/app/models/{name}", "wb").write(data)
PY

COPY . .
RUN chmod +x docker-entrypoint.sh \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/uploads \
    && chown -R appuser:appuser /app
USER appuser

ENV FLASK_APP=run.py \
    APP_ENV=production \
    UPLOAD_FOLDER=/app/uploads \
    FACE_MODEL_DIR=/app/models

EXPOSE 5000
ENTRYPOINT ["./docker-entrypoint.sh"]

# ONE worker on purpose: the background scheduler (absence marking, reminders)
# runs inside this process, and several workers would duplicate it and send
# duplicate reminder emails. Concurrency comes from threads.
CMD ["gunicorn", "run:app", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--timeout", "60", "--access-logfile", "-"]
