import pytest

from app import create_app
from app.config import TestingConfig
from app.extensions import db
from app.models import User
from app.utils.authz import issue_token
from app.utils.rbac import ensure_rbac_seeded, grant_super_admin
from app.utils.settings import ensure_defaults_seeded


@pytest.fixture()
def app(tmp_path):
    class Config(TestingConfig):
        UPLOAD_FOLDER = str(tmp_path / "uploads")

    app = create_app(Config)
    with app.app_context():
        db.create_all()
        ensure_defaults_seeded()
        ensure_rbac_seeded()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def make_user(email="user@example.com", role="lecturer", status="active", password="correct-horse-1", **extra):
    user = User(name=f"Test {role}", email=email, role=role, status=status, **extra)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return user


@pytest.fixture()
def admin(app):
    user = make_user("admin@example.com", role="admin")
    grant_super_admin(user)
    return user


@pytest.fixture()
def lecturer(app):
    return make_user("lecturer@example.com", role="lecturer")


def auth_header(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}
