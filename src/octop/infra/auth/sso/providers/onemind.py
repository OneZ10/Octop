"""OneMind enterprise iframe SSO adapter (signed handoff, not OAuth redirect).

The platform frontend posts a signed handoff payload to Octop. Octop verifies the
HMAC signature, timestamp window and single-use nonce, then calls the platform
``checkMenuPermission`` endpoint server-to-server before auto-creating the user.
``authorize_url`` / ``complete_login`` are unused: there is no OAuth redirect.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

import httpx

from octop.infra.auth.sso.crypto import decrypt_secret
from octop.infra.auth.sso.public_base import oauth_callback_path
from octop.infra.db.repos.sso import SsoLoginStateRow, SsoProviderRow

if TYPE_CHECKING:
    from octop.infra.auth.sso.service import SsoService

# Fixed ULID role template seeded by ``_ensure_onemind_role_schema`` (four OneMind menus).
ONEMIND_DEFAULT_ROLE_ID = "01JQ0NEM1ND000000000000000"
ONEMIND_MENU_PERMISSIONS = [
    "onemind_qa",
    "onemind_write",
    "onemind_review",
    "onemind_analysis",
]
_HANDOFF_TIME_WINDOW_SECONDS = 300
_CHECK_MENU_PERMISSION_PATH = "/api/external/auth/checkMenuPermission"


def canonical_handoff_payload(appid: str, phone: str, ext_info: dict[str, Any]) -> str:
    """Deterministic JSON used as the HMAC message body (sorted keys, compact)."""
    return json.dumps(
        {"appid": appid, "phoneNumber": phone, "extInfo": ext_info},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def handoff_signature(
    appid: str,
    phone: str,
    ext_info: dict[str, Any],
    timestamp: str,
    nonce: str,
    app_key: str,
) -> str:
    """HMAC-SHA256(appKey, canonical_payload + timestamp + nonce), hex digest."""
    message = f"{canonical_handoff_payload(appid, phone, ext_info)}{timestamp}{nonce}"
    return hmac.new(app_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def handoff_claims(phone: str, ext_info: dict[str, Any]) -> dict[str, Any]:
    """Map a handoff to UserManager claims (phone becomes the username)."""
    claims: dict[str, Any] = {"preferred_username": phone}
    name = ext_info.get("姓名") or ext_info.get("name")
    if isinstance(name, str) and name.strip():
        claims["name"] = name.strip()
    return claims


def handoff_policies(ext_info: dict[str, Any]) -> dict[str, str]:
    """Extract department / data-table whitelist into user policy pairs."""
    policies: dict[str, str] = {}
    department = ext_info.get("部门") or ext_info.get("department")
    if isinstance(department, str) and department.strip():
        policies["department"] = department.strip()
    whitelist = (
        ext_info.get("数据表白名单") or ext_info.get("data_whitelist") or ext_info.get("whitelist")
    )
    if isinstance(whitelist, (list, tuple)):
        if whitelist:
            policies["data_whitelist"] = json.dumps(list(whitelist), ensure_ascii=False)
    elif isinstance(whitelist, str) and whitelist.strip():
        policies["data_whitelist"] = whitelist.strip()
    return policies


def resolve_data_whitelist(policies: Mapping[str, str]) -> list[str] | None:
    """Resolve the effective data-table whitelist for a user.

    Returns None when no whitelist is stored, meaning the user may query ALL
    tables in the dataset (the default when the platform passes no whitelist).
    A stored whitelist (JSON array or comma-separated string) restricts
    querying to exactly those tables; the chatbi bridge applies it once the
    platform table-query mechanism is wired.
    """
    raw = str(policies.get("data_whitelist") or "").strip()
    if not raw:
        return None
    if raw.startswith(("[", "{")):
        try:
            parsed = json.loads(raw)
        except ValueError:
            return None
        if isinstance(parsed, list):
            tables = [str(item).strip() for item in parsed if str(item).strip()]
            return tables or None
        return None
    tables = [part.strip() for part in raw.split(",") if part.strip()]
    return tables or None


class OneMindAdapter:
    """IdentityProvider-compatible adapter for the OneMind handoff flow."""

    kind = "onemind"
    callback_path = oauth_callback_path()
    default_scopes = ""

    def __init__(self, service: SsoService) -> None:
        self._service = service

    def is_configured(self, row: SsoProviderRow) -> bool:
        base_url = str(row.extra.get("platform_base_url") or "").strip()
        return bool(row.client_secret_enc is not None and base_url)

    def authorize_url(
        self,
        *,
        row: SsoProviderRow,
        state: str,
        nonce: str,
        code_challenge: str,
        redirect_uri: str,
    ) -> str:
        del row, state, nonce, code_challenge, redirect_uri
        raise ValueError("OneMind SSO uses the handoff endpoint, not an OAuth redirect")

    def complete_login(
        self,
        code: str,
        *,
        row: SsoProviderRow,
        login_state: SsoLoginStateRow,
        redirect_uri: str,
    ) -> tuple[str, dict[str, Any]]:
        del code, row, login_state, redirect_uri
        raise ValueError("OneMind SSO uses the handoff endpoint, not an OAuth redirect")

    def test_connection(self, row: SsoProviderRow) -> dict[str, bool | str]:
        if row.client_secret_enc is None:
            return {"ok": False, "detail": "OneMind appKey is not configured"}
        base_url = str(row.extra.get("platform_base_url") or "").strip()
        if not base_url:
            return {"ok": False, "detail": "OneMind platform_base_url is not configured"}
        try:
            decrypt_secret(self._service._services.secret_repo, row.client_secret_enc)
        except Exception as exc:  # noqa: BLE001 - surface decrypt failure as test result
            return {"ok": False, "detail": str(exc)}
        return {"ok": True, "detail": "OneMind appKey and platform URL are configured"}

    def verify_handoff(self, payload: dict[str, Any], *, app_key: str, now: int) -> dict[str, Any]:
        """Validate timestamp window + HMAC signature; return normalized fields."""
        appid = str(payload.get("appid") or "").strip()
        phone = str(payload.get("phoneNumber") or "").strip()
        nonce = str(payload.get("nonce") or "").strip()
        sign = str(payload.get("sign") or "").strip()
        ext_info = payload.get("extInfo")
        if not isinstance(ext_info, dict):
            ext_info = {}
        try:
            timestamp = int(str(payload.get("timestamp")).strip())
        except (TypeError, ValueError) as exc:
            raise ValueError("handoff timestamp is missing or invalid") from exc
        if not appid or not phone or not nonce or not sign:
            raise ValueError("handoff payload is missing required fields")
        if abs(now - timestamp) > _HANDOFF_TIME_WINDOW_SECONDS:
            raise ValueError("handoff timestamp is outside the allowed window")
        expected = handoff_signature(appid, phone, ext_info, str(timestamp), nonce, app_key)
        if not hmac.compare_digest(expected, sign):
            raise ValueError("handoff signature is invalid")
        return {
            "appid": appid,
            "phone": phone,
            "ext_info": ext_info,
            "nonce": nonce,
            "timestamp": timestamp,
        }

    def check_menu_permission(
        self,
        phone: str,
        ext_info: dict[str, Any],
        *,
        app_key: str,
        base_url: str,
    ) -> bool:
        """Server-to-server platform check. True=code:1, False=code:4000."""
        url = f"{base_url.rstrip('/')}{_CHECK_MENU_PERMISSION_PATH}"
        with self._service._http_client() as client:
            try:
                response = client.post(
                    url,
                    json={"appKey": app_key, "phoneNumber": phone, "extInfo": ext_info},
                )
                response.raise_for_status()
                data = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise ValueError(f"checkMenuPermission request failed: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("checkMenuPermission response is not an object")
        code = data.get("code")
        if code in (1, "1"):
            return True
        if code in (4000, "4000"):
            return False
        raise ValueError(f"checkMenuPermission returned unexpected code: {code}")
