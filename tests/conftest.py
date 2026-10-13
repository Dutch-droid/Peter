import os
import tempfile

_d = tempfile.mkdtemp()
os.environ.setdefault("TREASURY_DB", f"sqlite:///{_d}/test.db")
os.environ.setdefault("TREASURY_SECRET_KEY", "test-secret")
