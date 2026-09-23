from app.extensions import db
from app.models import Setting


def get_all_settings() -> dict:
    """Returns a plain dict of setting key -> string value, DB rows overriding defaults."""
    values = {key: default for key, (default, _desc) in Setting.DEFAULTS.items()}
    for row in Setting.query.all():
        if row.value is not None:
            values[row.key] = row.value
    return values


def get_setting_str(key: str, settings: dict | None = None) -> str:
    settings = settings if settings is not None else get_all_settings()
    return settings.get(key, Setting.DEFAULTS.get(key, ("", ""))[0])


def get_setting_int(key: str, settings: dict | None = None) -> int:
    raw = get_setting_str(key, settings)
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return int(float(Setting.DEFAULTS.get(key, ("0", ""))[0]))


def get_setting_float(key: str, settings: dict | None = None) -> float:
    raw = get_setting_str(key, settings)
    try:
        return float(raw)
    except (TypeError, ValueError):
        return float(Setting.DEFAULTS.get(key, ("0", ""))[0])


def ensure_defaults_seeded():
    existing_keys = {row.key for row in Setting.query.all()}
    for key, (default_value, description) in Setting.DEFAULTS.items():
        if key not in existing_keys:
            db.session.add(Setting(key=key, value=default_value, description=description))
    db.session.commit()


def get_no_class_dates(settings: dict | None = None) -> set:
    raw = get_setting_str("no_class_dates", settings)
    return {d.strip() for d in raw.split(",") if d.strip()}
