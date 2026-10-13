"""Settings. Business-rule defaults are ASSUMPTIONS to be confirmed with Treasury (see README)."""
import os
from decimal import Decimal

DATABASE_URL = os.environ.get("TREASURY_DB", "sqlite:///treasury.db")
SECRET_KEY = os.environ.get("TREASURY_SECRET_KEY", "")          # required in production
WHT_RATE = Decimal(os.environ.get("TREASURY_WHT_RATE", "0.15"))   # BRD: 15%
VAT_RATE = Decimal(os.environ.get("TREASURY_VAT_RATE", "0.16"))   # default VAT, overridable per request
DAY_COUNT_BASIS = int(os.environ.get("TREASURY_DAY_COUNT", "365"))  # Actual/365 simple interest
RENT_REMINDER_OFFSETS = (30, 14, 7, 0)       # BRD
INTERNET_REMINDER_OFFSETS = (7, 3, 1, 0)     # BRD says "before due date"; offsets are an assumption
SMTP_HOST = os.environ.get("TREASURY_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("TREASURY_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("TREASURY_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("TREASURY_SMTP_PASSWORD", "")
MAIL_FROM = os.environ.get("TREASURY_MAIL_FROM", "treasury@localhost")
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15
