"""OneMind enterprise iframe SSO handoff route (public, signed payload)."""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from octop.api.deps import get_server, sign_token
from octop.api.routers.auth import _user_json
from octop.infra.auth.sso.service import SsoService
from octop.infra.auth.tokens import PURPOSE_ACCESS
from octop.infra.errors import OctopError
from octop.infra.users.identity import User

router = APIRouter()


class OnemindHandoffBody(BaseModel):
    appid: str = Field(min_length=1)
    phoneNumber: str = Field(min_length=1)
    extInfo: dict[str, Any] = Field(default_factory=dict)
    timestamp: int | str
    nonce: str = Field(min_length=1)
    sign: str = Field(min_length=1)


def _service(server: Any) -> SsoService:
    return cast(SsoService, server.sso_service)


def _login_data(user: User, server: Any) -> dict[str, Any]:
    """Mirror exchange_login_code_response: session token for the iframe."""
    secret = server.services.secret_repo.get("jwt")
    ttl = server.services.config.access_token_ttl_seconds
    row = server.services.user_repo.get(user.id)
    mfa_version = int(row.mfa_version) if row is not None else 0
    password_version = int(row.password_version) if row is not None else 0
    return {
        "access_token": sign_token(
            secret,
            sub=user.id,
            uname=user.username,
            role=user.role,
            purpose=PURPOSE_ACCESS,
            ttl_seconds=ttl,
            mfa_version=mfa_version,
            password_version=password_version,
        ),
        "token_type": "Bearer",
        "expires_in": ttl,
        "user": _user_json(user, locale=user.locale),
    }


@router.post("/onemind/handoff", summary="OneMind iframe SSO handoff")
async def onemind_handoff(
    body: OnemindHandoffBody, server: Any = Depends(get_server)
) -> dict[str, Any]:
    """Verify a signed platform handoff and return a session token for the iframe.

    The response mirrors the platform envelope {code, msg, data, extend}; the
    platform frontend forwards data.access_token to the embedded dashboard.
    """
    try:
        user = await _service(server).handle_onemind_handoff(body.model_dump())
    except OctopError as exc:
        return {"code": 4000, "msg": exc.message, "data": {}, "extend": {}}
    except ValueError as exc:
        return {"code": 4000, "msg": str(exc), "data": {}, "extend": {}}
    return {
        "code": 1,
        "msg": "用户拥有访问权限",
        "data": _login_data(user, server),
        "extend": {},
    }
