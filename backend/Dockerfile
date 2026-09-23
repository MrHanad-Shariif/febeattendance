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

COPY . .
RUN chmod +x docker-entrypoint.sh \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/uploads \
    && chown -R appuser:appuser /app
USER appuser

ENV FLASK_APP=run.py \
    APP_ENV=production \
    UPLOAD_FOLDER=/app/uploads

EXPOSE 5000
ENTRYPOINT ["./docker-entrypoint.sh"]

# ONE worker on purpose: the background scheduler (absence marking, reminders)
# runs inside this process, and several workers would duplicate it and send
# duplicate reminder emails. Concurrency comes from threads.
CMD ["gunicorn", "run:app", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--timeout", "60", "--access-logfile", "-"]
