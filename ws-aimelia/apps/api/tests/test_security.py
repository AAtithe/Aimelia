"""
Security tests: nothing reaches Tom's data or Microsoft 365 without the access key,
no route returns a token, sign-in is bound to the browser and to the owner's account,
and tokens are never stored in plain text.
"""
import os
import tempfile

_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ.update({"DATABASE_URL": f"sqlite:///{_db.name}", "TENANT_ID": "t", "CLIENT_ID": "c", "CLIENT_SECRET": "s",
                   "GRAPH_REDIRECT_URI": "https://api.example/auth/callback", "APP_BASE_URL": "http://x",
                   "AIMELIA_ACCESS_KEY": "secret", "AGENT_LOOP_IN_API": "false"})

import datetime as dt  # noqa: E402
from urllib.parse import parse_qs, urlparse  # noqa: E402

import pytest  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402
import re  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import graph_auth  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import UserToken  # noqa: E402
from app.settings import settings  # noqa: E402
from app.token_manager import token_manager  # noqa: E402

H = {"X-Aimelia-Key": "secret"}
PUBLIC = {("GET", "/"), ("GET", "/health"), ("GET", "/auth/login"), ("GET", "/auth/callback")}


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    Base.metadata.drop_all(engine, tables=[UserToken.__table__])
    Base.metadata.create_all(engine, tables=[UserToken.__table__])
    monkeypatch.setattr(settings, "AIMELIA_ACCESS_KEY", "secret")
    monkeypatch.setattr(settings, "AIMELIA_OWNER_EMAIL", "owner@example.co")
    monkeypatch.setattr(settings, "GRAPH_REDIRECT_URI", "https://api.example/auth/callback")
    monkeypatch.setattr(token_manager, "fernet", Fernet(Fernet.generate_key()))
    yield


@pytest.fixture
def client():
    return TestClient(app, base_url="https://api.example", follow_redirects=False)


def _store(expires_in=3600):
    import asyncio
    db = SessionLocal()
    ok = asyncio.run(token_manager.store_tokens(db, "tom", {"access_token": "ACCESS-123", "refresh_token": "REFRESH-456",
                                                            "expires_in": expires_in}))
    db.close()
    return ok


def test_every_route_except_sign_in_needs_the_key(client):
    # The OpenAPI schema lists every mounted route, including ones in included routers.
    checked = 0
    for route, ops in app.openapi()["paths"].items():
        path = re.sub(r"\{[^}]+\}", "x", route)
        for method in ops:
            method = method.upper()
            if (method, route) in PUBLIC:
                continue
            r = client.request(method, path, headers={"X-Aimelia-Key": "wrong"})
            assert r.status_code == 401, f"{method} {route} answered {r.status_code} without a valid key"
            checked += 1
    assert checked > 40  # every email, calendar, drafting, scheduler, setup and todo route


def test_no_key_configured_means_everything_refuses(client, monkeypatch):
    monkeypatch.setattr(settings, "AIMELIA_ACCESS_KEY", None)
    assert client.get("/auth/token", headers=H).status_code == 503
    assert client.get("/todo/tasks", headers=H).status_code == 503


def test_debug_routes_are_gone(client):
    for path in ["/debug/auth-config", "/debug/token-status", "/debug/check-token", "/test/env", "/auth/test-callback"]:
        assert client.get(path, headers=H).status_code == 404
    assert client.post("/debug/clear-tokens", headers=H).status_code == 404


def test_token_status_never_returns_the_token(client):
    assert _store()
    r = client.get("/auth/token", headers=H).json()
    assert r["has_token"] is True and r["status"] == "ok"
    assert "access_token" not in r and "ACCESS-123" not in str(r) and "REFRESH-456" not in str(r)
    assert "ACCESS-123" not in client.get("/auth/debug", headers=H).text


def test_tokens_are_encrypted_at_rest_and_refused_without_a_key(monkeypatch):
    assert _store()
    db = SessionLocal()
    row = db.query(UserToken).first()
    assert "ACCESS-123" not in row.encrypted_access_token and "REFRESH-456" not in row.encrypted_refresh_token
    db.close()
    monkeypatch.setattr(token_manager, "fernet", None)
    assert _store() is False  # no silent plain-text fallback


def test_expiry_check_handles_timezone_aware_times():
    import asyncio
    assert _store(expires_in=3600)
    db = SessionLocal()
    row = db.query(UserToken).first()
    row.expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)  # aware, as Postgres returns
    db.commit()
    assert asyncio.run(token_manager.get_valid_access_token(db, "tom")) == "ACCESS-123"
    db.close()


def _start_login(client):
    r = client.get("/auth/login")
    assert r.status_code in (302, 307)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    assert graph_auth.STATE_COOKIE in r.cookies or graph_auth.STATE_COOKIE in r.headers.get("set-cookie", "")
    return state


class _Resp:
    def __init__(self, code, body):
        self.status_code, self._body = code, body

    def json(self):
        return self._body


def _fake_microsoft(monkeypatch, email):
    class Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, data=None):
            return _Resp(200, {"access_token": "ACCESS-NEW", "refresh_token": "REFRESH-NEW", "expires_in": 3600})

        async def get(self, url, params=None, headers=None):
            return _Resp(200, {"mail": email, "userPrincipalName": email})
    monkeypatch.setattr(graph_auth.httpx, "AsyncClient", Client)


def _reason(r):
    return parse_qs(urlparse(r.headers["location"]).query)


def test_callback_rejects_forged_or_foreign_state(client, monkeypatch):
    _fake_microsoft(monkeypatch, "owner@example.co")
    r = client.get("/auth/callback", params={"code": "c", "state": "aimelia"})
    assert _reason(r) == {"auth": ["error"], "reason": ["invalid_state"]}
    state = _start_login(client)
    other_browser = TestClient(app, base_url="https://api.example", follow_redirects=False)
    r = other_browser.get("/auth/callback", params={"code": "c", "state": state})
    assert _reason(r)["reason"] == ["invalid_state"]  # a state from someone else's sign-in
    db = SessionLocal()
    assert db.query(UserToken).count() == 0
    db.close()


def test_callback_refuses_anyone_but_the_owner(client, monkeypatch):
    _fake_microsoft(monkeypatch, "someone.else@example.co")
    state = _start_login(client)
    r = client.get("/auth/callback", params={"code": "c", "state": state})
    assert _reason(r)["reason"] == ["wrong_account"]
    db = SessionLocal()
    assert db.query(UserToken).count() == 0
    db.close()


def test_owner_sign_in_is_stored(client, monkeypatch):
    _fake_microsoft(monkeypatch, "Owner@Example.co")
    state = _start_login(client)
    r = client.get("/auth/callback", params={"code": "c", "state": state})
    assert _reason(r) == {"auth": ["success"]}
    assert client.get("/auth/token", headers=H).json()["has_token"] is True


def test_sign_in_is_refused_until_an_owner_is_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "AIMELIA_OWNER_EMAIL", None)
    r = client.get("/auth/login")
    assert _reason(r)["reason"] == ["owner_not_configured"]


def test_revoke_needs_the_key(client):
    assert _store()
    assert client.post("/auth/revoke").status_code == 401
    db = SessionLocal()
    assert db.query(UserToken).count() == 1
    db.close()
