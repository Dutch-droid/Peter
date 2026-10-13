"""Password hashing, roles/permissions, CSRF."""
from __future__ import annotations

import hashlib
import hmac
import secrets

ROLES = ["Administrator", "Treasury Officer", "Finance Officer", "Read-Only User"]
MODULES = ["treasury", "finance", "admin"]
# role -> {module: "rw" | "r"}; least privilege: anything not listed is denied (BRD role definitions)
PERMS = {
    "Administrator": {"treasury": "rw", "finance": "rw", "admin": "rw"},
    "Treasury Officer": {"treasury": "rw"},
    "Finance Officer": {"finance": "rw"},
    "Read-Only User": {"treasury": "r", "finance": "r"},
}
ITER = 240_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITER).hex()
    return f"pbkdf2${ITER}${salt}${h}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, it, salt, h = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(it)).hex()
    except ValueError:
        return False
    return hmac.compare_digest(calc, h)


def password_problems(pw: str) -> list[str]:
    out = []
    if len(pw) < 10:
        out.append("at least 10 characters")
    if pw.lower() == pw or pw.upper() == pw:
        out.append("mixed upper and lower case")
    if not any(c.isdigit() for c in pw):
        out.append("a digit")
    return out


def can(role: str, module: str, write: bool = False) -> bool:
    level = PERMS.get(role, {}).get(module)
    return level == "rw" if write else level in ("r", "rw")


def new_csrf() -> str:
    return secrets.token_urlsafe(24)
