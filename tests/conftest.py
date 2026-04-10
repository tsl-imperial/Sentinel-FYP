"""
Network Inspector — pytest fixtures.

CRITICAL: NETINSPECT_SKIP_EE_INIT must be set BEFORE importing application.web.app,
because app.py calls init_ee() at module import time. Without this guard, every
test that needs the Flask app crashes on a CI machine that doesn't have GEE creds.
"""

import os
import sys
from pathlib import Path

# Set BEFORE any application import. setdefault so a real .config/earthengine
# user running pytest locally can override by exporting NETINSPECT_SKIP_EE_INIT=0.
os.environ.setdefault("NETINSPECT_SKIP_EE_INIT", "1")

# Make the repo root importable as a package root.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import pytest  # noqa: E402


@pytest.fixture
def app(monkeypatch, tmp_path):
    """Fresh Flask app per test, with OUTPUT_DIR pointed at a tmp_path.

    Re-importing the module inside the fixture means each test gets a clean
    OUTPUT_DIR resolution and CORS state, regardless of import order.
    """
    monkeypatch.setenv("NETINSPECT_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setenv("NETINSPECT_DEV", "1")
    monkeypatch.setenv("NETINSPECT_SKIP_EE_INIT", "1")

    # Force re-import so module-level OUTPUT_DIR / CORS pick up the patched env.
    if "application.web.app" in sys.modules:
        del sys.modules["application.web.app"]
    from application.web import app as app_module

    app_module.app.config.update(TESTING=True)
    yield app_module.app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def mocked_ee(monkeypatch):
    """Replace ee.Number().getInfo() so /api/healthz/ready is testable without GEE."""
    from application.web import app as app_module

    class _FakeNumber:
        def __init__(self, _v):
            pass

        def getInfo(self):
            return 1

    monkeypatch.setattr(app_module.ee, "Number", _FakeNumber)
    return _FakeNumber


@pytest.fixture
def broken_ee(monkeypatch):
    """Simulate Earth Engine being unavailable for /api/healthz/ready."""
    from application.web import app as app_module

    class _BrokenNumber:
        def __init__(self, _v):
            pass

        def getInfo(self):
            raise RuntimeError("EE auth failed")

    monkeypatch.setattr(app_module.ee, "Number", _BrokenNumber)
    return _BrokenNumber
