"""Tests for the OneMind enterprise iframe SSO adapter + handoff flow."""

from __future__ import annotations

import json
import time
from unittest.mock import patch

import httpx
import pytest

from octop.config import OctopConfig
from octop.infra.auth.sso.crypto import encrypt_secret
from octop.infra.auth.sso.providers.onemind import (
    ONEMIND_DEFAULT_ROLE_ID,
    ONEMIND_MENU_PERMISSIONS,
    OneMindAdapter,
    canonical_handoff_payload,
    handoff_claims,
    handoff_policies,
    handoff_signature,
    resolve_data_whitelist,
)
from octop.infra.auth.sso.service import SsoService
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.user_roles import role_assignment_for
from octop.infra.db.services import build_shared_services
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.manager import UserManager
from octop.infra.utils.paths import PathLayout

APP_KEY = "test-app-key"
BASE_URL = "http://127.0.0.1:8801"


@pytest.fixture
def service(tmp_path):
    paths = PathLayout(tmp_path / ".octop")
    paths.ensure_root()
    db = SqlitePool(paths.db)
    run_migrations(db)
    services = build_shared_services(db=db, paths=paths, config=OctopConfig())
    return SsoService(services, UserManager(services))


def _onemind_row(service: SsoService):
    secret = encrypt_secret(service._services.secret_repo, APP_KEY)
    return service._services.sso_repo.upsert_by_kind(
        "onemind",
        enabled=True,
        display_name="OneMind",
        issuer="",
        client_id="jqr",
        client_secret_enc=secret,
        scopes="",
        dashboard_origin=None,
        extra={"platform_base_url": BASE_URL},
    )


def _signed_payload(
    *,
    phone: str = "13800000000",
    ext_info: dict | None = None,
    now: int | None = None,
    nonce: str = "nonce-1",
    appid: str = "jqr",
    app_key: str = APP_KEY,
) -> dict:
    ext_info = ext_info if ext_info is not None else {"姓名": "张三", "部门": "监理一部"}
    ts = now if now is not None else int(time.time())
    sign = handoff_signature(appid, phone, ext_info, str(ts), nonce, app_key)
    return {
        "appid": appid,
        "phoneNumber": phone,
        "extInfo": ext_info,
        "timestamp": ts,
        "nonce": nonce,
        "sign": sign,
    }


def _mock_client(handler):
    real_client = httpx.Client

    def factory(*args: object, **kwargs: object) -> httpx.Client:
        kwargs.pop("transport", None)
        return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

    return patch("octop.infra.auth.sso.service.httpx.Client", side_effect=factory)


# --- pure helpers -----------------------------------------------------------


def test_canonical_payload_is_deterministic() -> None:
    a = canonical_handoff_payload("jqr", "138", {"b": 2, "a": 1})
    b = canonical_handoff_payload("jqr", "138", {"a": 1, "b": 2})
    assert a == b
    assert json.loads(a) == {"appid": "jqr", "phoneNumber": "138", "extInfo": {"a": 1, "b": 2}}


def test_handoff_claims_maps_phone_and_name() -> None:
    claims = handoff_claims("13800000000", {"姓名": "张三"})
    assert claims["preferred_username"] == "13800000000"
    assert claims["name"] == "张三"
    assert "name" not in handoff_claims("138", {})


def test_handoff_policies_department_and_whitelist() -> None:
    policies = handoff_policies({"部门": "监理一部", "数据表白名单": ["t_a", "t_b"]})
    assert policies["department"] == "监理一部"
    assert json.loads(policies["data_whitelist"]) == ["t_a", "t_b"]
    assert handoff_policies({"whitelist": "t_a,t_b"})["data_whitelist"] == "t_a,t_b"
    assert handoff_policies({}) == {}


# --- verify_handoff ---------------------------------------------------------


def test_verify_handoff_accepts_valid_signature(service: SsoService) -> None:
    adapter = OneMindAdapter(service)
    now = int(time.time())
    payload = _signed_payload(now=now)
    result = adapter.verify_handoff(payload, app_key=APP_KEY, now=now)
    assert result["phone"] == "13800000000"
    assert result["nonce"] == "nonce-1"
    assert result["ext_info"]["姓名"] == "张三"


def test_verify_handoff_rejects_bad_signature(service: SsoService) -> None:
    adapter = OneMindAdapter(service)
    now = int(time.time())
    payload = _signed_payload(now=now)
    payload["sign"] = "deadbeef"
    with pytest.raises(ValueError, match="signature"):
        adapter.verify_handoff(payload, app_key=APP_KEY, now=now)


def test_verify_handoff_rejects_expired_timestamp(service: SsoService) -> None:
    adapter = OneMindAdapter(service)
    now = int(time.time())
    payload = _signed_payload(now=now - 400)
    with pytest.raises(ValueError, match="window"):
        adapter.verify_handoff(payload, app_key=APP_KEY, now=now)


def test_verify_handoff_rejects_missing_fields(service: SsoService) -> None:
    adapter = OneMindAdapter(service)
    now = int(time.time())
    payload = _signed_payload(now=now)
    payload["phoneNumber"] = ""
    with pytest.raises(ValueError, match="required fields"):
        adapter.verify_handoff(payload, app_key=APP_KEY, now=now)


def test_verify_handoff_rejects_bad_timestamp(service: SsoService) -> None:
    adapter = OneMindAdapter(service)
    payload = _signed_payload()
    payload["timestamp"] = "not-a-number"
    with pytest.raises(ValueError, match="timestamp"):
        adapter.verify_handoff(payload, app_key=APP_KEY, now=int(time.time()))


# --- check_menu_permission --------------------------------------------------


@pytest.mark.parametrize(
    ("code", "expected"),
    [(1, True), ("1", True), (4000, False), ("4000", False)],
)
def test_check_menu_permission_codes(service: SsoService, code, expected) -> None:
    adapter = OneMindAdapter(service)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"code": code, "msg": "x", "data": {}, "extend": {}})

    with _mock_client(handler):
        result = adapter.check_menu_permission(
            "138", {"姓名": "张三"}, app_key=APP_KEY, base_url=BASE_URL
        )
    assert result is expected
    assert seen[0].url.path == "/api/external/auth/checkMenuPermission"
    body = json.loads(seen[0].content)
    assert body["appKey"] == APP_KEY
    assert body["phoneNumber"] == "138"


def test_check_menu_permission_unexpected_code_raises(service: SsoService) -> None:
    adapter = OneMindAdapter(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 500})

    with _mock_client(handler), pytest.raises(ValueError, match="unexpected code"):
        adapter.check_menu_permission("138", {}, app_key=APP_KEY, base_url=BASE_URL)


def test_check_menu_permission_http_error_raises(service: SsoService) -> None:
    adapter = OneMindAdapter(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    with _mock_client(handler), pytest.raises(ValueError, match="request failed"):
        adapter.check_menu_permission("138", {}, app_key=APP_KEY, base_url=BASE_URL)


# --- configuration ----------------------------------------------------------


def test_is_configured_and_test_connection(service: SsoService) -> None:
    adapter = OneMindAdapter(service)
    row = _onemind_row(service)
    assert adapter.is_configured(row) is True
    result = adapter.test_connection(row)
    assert result["ok"] is True


def test_oauth_redirect_methods_unsupported(service: SsoService) -> None:
    adapter = OneMindAdapter(service)
    row = _onemind_row(service)
    with pytest.raises(ValueError, match="handoff"):
        adapter.authorize_url(
            row=row, state="s", nonce="n", code_challenge="c", redirect_uri="http://x"
        )


# --- nonce single-use -------------------------------------------------------


def test_claim_handoff_nonce_single_use(service: SsoService) -> None:
    row = _onemind_row(service)
    repo = service._services.sso_repo
    expires = int(time.time()) + 300
    assert repo.claim_handoff_nonce(provider_id=row.id, nonce="n1", expires_at=expires) is True
    assert repo.claim_handoff_nonce(provider_id=row.id, nonce="n1", expires_at=expires) is False
    assert repo.claim_handoff_nonce(provider_id=row.id, nonce="n2", expires_at=expires) is True


# --- migration 026 seeds the role template ----------------------------------


def test_migration_seeds_onemind_role(service: SsoService) -> None:
    assignment = role_assignment_for(service._services.db, ONEMIND_DEFAULT_ROLE_ID)
    assert assignment is not None
    assert assignment[0] == ONEMIND_DEFAULT_ROLE_ID
    assert set(ONEMIND_MENU_PERMISSIONS).issubset(set(assignment[2]))


# --- full handoff flow ------------------------------------------------------


async def test_handoff_creates_user_with_role_and_policies(service: SsoService) -> None:
    _onemind_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 1, "msg": "ok", "data": {}, "extend": {}})

    payload = _signed_payload(
        ext_info={"姓名": "张三", "部门": "监理一部", "数据表白名单": ["t_a"]}
    )
    with _mock_client(handler):
        user = await service.handle_onemind_handoff(payload)
    assert user.username == "13800000000"
    assert user.display_name == "张三"
    assert user.role == ONEMIND_DEFAULT_ROLE_ID
    assert set(ONEMIND_MENU_PERMISSIONS).issubset(set(user.permissions))


async def test_handoff_rejects_nonce_replay(service: SsoService) -> None:
    _onemind_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 1})

    payload = _signed_payload(nonce="replay-me")
    with _mock_client(handler):
        await service.handle_onemind_handoff(payload)
        with pytest.raises(ValueError, match="nonce"):
            await service.handle_onemind_handoff(payload)


async def test_handoff_denied_when_platform_returns_4000(service: SsoService) -> None:
    _onemind_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 4000, "msg": "无权限"})

    payload = _signed_payload(nonce="denied-1")
    with _mock_client(handler), pytest.raises(OctopError) as exc_info:
        await service.handle_onemind_handoff(payload)
    assert exc_info.value.code is ErrorCode.FORBIDDEN


async def test_handoff_disabled_provider_rejected(service: SsoService) -> None:
    payload = _signed_payload()
    with pytest.raises(ValueError, match="disabled"):
        await service.handle_onemind_handoff(payload)


def test_resolve_data_whitelist_defaults_to_all_tables() -> None:
    assert resolve_data_whitelist({}) is None
    assert resolve_data_whitelist({"data_whitelist": ""}) is None
    assert resolve_data_whitelist({"data_whitelist": "   "}) is None
    assert resolve_data_whitelist({"department": "监理部"}) is None


def test_resolve_data_whitelist_parses_json_array() -> None:
    assert resolve_data_whitelist({"data_whitelist": '["t1", "t2"]'}) == ["t1", "t2"]
    assert resolve_data_whitelist({"data_whitelist": "[]"}) is None
    assert resolve_data_whitelist({"data_whitelist": '["t1", "", "  "]'}) == ["t1"]


def test_resolve_data_whitelist_parses_csv_and_rejects_malformed() -> None:
    assert resolve_data_whitelist({"data_whitelist": "t1, t2 ,t3"}) == ["t1", "t2", "t3"]
    assert resolve_data_whitelist({"data_whitelist": "[not json"}) is None
    assert resolve_data_whitelist({"data_whitelist": '{"a": 1}'}) is None
