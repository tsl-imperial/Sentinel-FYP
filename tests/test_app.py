"""
Network Inspector — backend tests.

Includes the 7 mandatory regression tests (R1-R7) — well, R1-R4 are backend.
R5-R7 live in the frontend test suite.

Iron Rule: regression tests are non-negotiable. They lock the path-resolution
fix so a future "improvement" can't reintroduce the /Users/miranda hardcode.
"""

import os
import sys
import json
from pathlib import Path

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# R1-R4: OUTPUT_DIR regression tests (Iron Rule)
# ─────────────────────────────────────────────────────────────────────────────


def _reload_app(env_overrides):
    """Re-import application.web.app with the given env, return the module.

    Uses importlib.reload to force re-execution of the module body. A naive
    `del sys.modules[...]` + `from application.web import app` doesn't work
    because the parent `application.web` package caches `app` as an attribute,
    so subsequent imports return the old module without re-running it.
    """
    import importlib
    import application.web.app

    for k, v in env_overrides.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    importlib.reload(application.web.app)
    return application.web.app


def test_output_dir_default_resolves_to_repo_root(monkeypatch, tmp_path):
    """R1: With NETINSPECT_OUTPUT_DIR unset, OUTPUT_DIR resolves to <repo>/outputs."""
    monkeypatch.delenv("NETINSPECT_OUTPUT_DIR", raising=False)
    monkeypatch.setenv("NETINSPECT_SKIP_EE_INIT", "1")
    # Run from a different CWD to prove resolution is anchored to __file__, not CWD.
    monkeypatch.chdir(tmp_path)

    app_module = _reload_app({})
    repo_root = Path(__file__).resolve().parents[1]
    assert app_module.OUTPUT_DIR == repo_root / "outputs"
    # And critically, it is NOT the legacy hardcode:
    assert "miranda" not in str(app_module.OUTPUT_DIR).lower()


def test_output_dir_env_override_absolute(monkeypatch, tmp_path):
    """R2: An absolute NETINSPECT_OUTPUT_DIR is honoured verbatim."""
    abs_path = tmp_path / "custom-outputs"
    monkeypatch.setenv("NETINSPECT_OUTPUT_DIR", str(abs_path))
    monkeypatch.setenv("NETINSPECT_SKIP_EE_INIT", "1")

    app_module = _reload_app({})
    assert app_module.OUTPUT_DIR == abs_path
    assert abs_path.exists()  # mkdir(parents=True) ran


def test_output_dir_env_override_relative_resolves_to_repo(monkeypatch, tmp_path):
    """R3: A relative NETINSPECT_OUTPUT_DIR resolves against the repo root, not CWD."""
    monkeypatch.setenv("NETINSPECT_OUTPUT_DIR", "./alt-outputs")
    monkeypatch.setenv("NETINSPECT_SKIP_EE_INIT", "1")
    # Force CWD elsewhere so a CWD-relative resolution would land in tmp_path.
    monkeypatch.chdir(tmp_path)

    app_module = _reload_app({})
    repo_root = Path(__file__).resolve().parents[1]
    assert app_module.OUTPUT_DIR == repo_root / "alt-outputs"
    # And NOT in tmp_path (which would prove CWD leakage):
    assert tmp_path not in app_module.OUTPUT_DIR.parents


def test_output_dir_env_override_relative_NOT_against_cwd(monkeypatch, tmp_path):
    """R3 (companion): repeat the assertion explicitly, since this is the load-bearing fix."""
    monkeypatch.setenv("NETINSPECT_OUTPUT_DIR", "./outputs")
    monkeypatch.setenv("NETINSPECT_SKIP_EE_INIT", "1")
    monkeypatch.chdir(tmp_path)

    app_module = _reload_app({})
    # If resolution had been CWD-relative, OUTPUT_DIR would equal tmp_path/outputs.
    assert app_module.OUTPUT_DIR != tmp_path / "outputs"


# ─────────────────────────────────────────────────────────────────────────────
# Health endpoints
# ─────────────────────────────────────────────────────────────────────────────


def test_healthz_returns_ok(client):
    """Liveness probe is cheap and unconditional."""
    res = client.get("/api/healthz")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok"}


def test_healthz_ready_with_mocked_ee_ok(client, mocked_ee):
    """Readiness probe returns ok when GEE responds."""
    res = client.get("/api/healthz/ready")
    assert res.status_code == 200
    body = res.get_json()
    assert body["status"] == "ok"
    assert "ee_project" in body


def test_healthz_ready_with_broken_ee_503(client, broken_ee):
    """Readiness probe returns 503 + degraded when GEE fails."""
    res = client.get("/api/healthz/ready")
    assert res.status_code == 503
    body = res.get_json()
    assert body["status"] == "degraded"
    assert "EE auth failed" in body["error"]


# ─────────────────────────────────────────────────────────────────────────────
# CORS gating (NETINSPECT_DEV=1)
# ─────────────────────────────────────────────────────────────────────────────


def test_cors_enabled_when_dev(client):
    """When NETINSPECT_DEV=1, /api/* responses include CORS headers for localhost:3000."""
    res = client.get("/api/healthz", headers={"Origin": "http://127.0.0.1:3000"})
    assert res.status_code == 200
    # flask-cors writes Access-Control-Allow-Origin matching the request Origin.
    assert res.headers.get("Access-Control-Allow-Origin") in (
        "http://127.0.0.1:3000",
        "*",
    )


def test_cors_disabled_when_prod(monkeypatch, tmp_path):
    """When NETINSPECT_DEV is not "1", no CORS header is added.

    Setting it to "0" (rather than deleting) prevents load_dotenv from
    re-populating it from .env during the reload — dotenv's override=False
    leaves an existing value alone, but happily fills in a missing one.
    """
    monkeypatch.setenv("NETINSPECT_DEV", "0")
    monkeypatch.setenv("NETINSPECT_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setenv("NETINSPECT_SKIP_EE_INIT", "1")

    app_module = _reload_app({})
    client = app_module.app.test_client()

    res = client.get("/api/healthz", headers={"Origin": "http://127.0.0.1:3000"})
    assert res.status_code == 200
    assert "Access-Control-Allow-Origin" not in res.headers


# ─────────────────────────────────────────────────────────────────────────────
# Polygon validation on /api/export_polygon_network_s2
# (validation happens before any osmnx/GEE call, so safe to test without mocks)
# ─────────────────────────────────────────────────────────────────────────────


def test_export_rejects_empty_filename(client):
    res = client.post("/api/export_polygon_network_s2", json={"filename": "", "polygon": [[0, 0], [1, 0], [1, 1]]})
    assert res.status_code == 400
    assert "filename" in res.get_json()["error"].lower()


def test_export_rejects_invalid_filename_chars(client):
    # All non-alphanumeric (except - and _) chars are stripped. A filename
    # composed entirely of disallowed chars sanitises to "" and is rejected.
    # ("/../etc/passwd" sanitises to "etcpasswd" which IS valid — strict
    # path-traversal protection isn't needed because the result is alnum-only.)
    res = client.post("/api/export_polygon_network_s2", json={
        "filename": "@@@@",
        "polygon": [[0, 0], [1, 0], [1, 1]],
    })
    assert res.status_code == 400
    assert "filename" in res.get_json()["error"].lower()


def test_export_rejects_short_polygon(client):
    res = client.post("/api/export_polygon_network_s2", json={"filename": "ok", "polygon": [[0, 0], [1, 0]]})
    assert res.status_code == 400
    assert "3 vertices" in res.get_json()["error"]


def test_export_rejects_invalid_polygon_coordinates(client):
    res = client.post("/api/export_polygon_network_s2", json={
        "filename": "ok",
        "polygon": [["not", "a"], ["valid", "polygon"], [1, 2]],
    })
    assert res.status_code == 400
