"""Development entry point (`python run.py`). Production uses gunicorn: `gunicorn run:app`."""
import os

from dotenv import load_dotenv

load_dotenv()

from app import create_app  # noqa: E402

app = create_app()

if __name__ == "__main__":
    # Debug (and its interactive debugger) is opt-in and never on by default.
    debug = os.environ.get("FLASK_DEBUG", "0") == "1" and app.config["APP_ENV"] != "production"
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=debug)
