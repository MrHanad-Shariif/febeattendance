"""Who receives a committee- or faculty-level message."""
from app.models import Committee, User


def committee_users(committee: Committee) -> list[User]:
    return [m.user for m in committee.memberships if m.user]


def audience_users(audience: str, committee: Committee | None = None) -> list[User]:
    if audience == "committee":
        return committee_users(committee) if committee else []
    roles = ("lecturer",) if audience == "lecturers" else ("lecturer", "admin")
    return User.query.filter(User.role.in_(roles), User.status == "active").all()
