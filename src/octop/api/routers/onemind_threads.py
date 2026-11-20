"""OneMind direct-chat conversation persistence.

Stores the OneMind QA page's threads and rich messages (citations, SQL, charts,
follow-ups) as a per-user JSON document in the settings store. This keeps the
direct-connect SSE proxy stateless while giving the page durable, per-menu
conversation history whose rich artifacts survive reloads exactly as streamed.
No new migration is introduced; the settings key/value table is reused.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from octop.api.deps import get_server, require_permission
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.server import OctopServer
from octop.infra.users.identity import User

logger = logging.getLogger(__name__)

router = APIRouter()


def _store_key(user_id: int | str) -> str:
    return f"onemind_chat:{user_id}"


def _load(server: Any, user: User) -> dict[str, Any]:
    raw = server.services.settings_repo.get(_store_key(user.id))
    if not raw:
        return {"threads": []}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        logger.warning("corrupt onemind chat store for user %s", user.id)
        return {"threads": []}
    if not isinstance(data, dict) or not isinstance(data.get("threads"), list):
        return {"threads": []}
    return cast("dict[str, Any]", data)


def _save(server: Any, user: User, data: dict[str, Any]) -> None:
    server.services.settings_repo.set(_store_key(user.id), json.dumps(data, ensure_ascii=False))


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _find(data: dict[str, Any], tid: str) -> dict[str, Any]:
    for thread in data["threads"]:
        if thread.get("id") == tid:
            return cast("dict[str, Any]", thread)
    raise OctopError(ErrorCode.NOT_FOUND, "thread not found", status=404)


def _meta(thread: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": thread["id"],
        "mode": thread["mode"],
        "title": thread["title"],
        "created_at": thread["created_at"],
        "last_active": thread["last_active"],
        "message_count": len(thread.get("messages", [])),
        "pinned": bool(thread.get("pinned", False)),
    }


class CreateBody(BaseModel):
    mode: Literal["kbflow", "chatbi"]
    title: str | None = Field(default=None, max_length=200)


class AppendBody(BaseModel):
    message: dict[str, Any]


class PatchBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


@router.get("")
async def list_threads(
    mode: str | None = None,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> dict[str, Any]:
    data = _load(server, user)
    threads = [_meta(t) for t in data["threads"]]
    if mode:
        threads = [t for t in threads if t["mode"] == mode]
    threads.sort(key=lambda t: (t["pinned"], t["last_active"]), reverse=True)
    return {"threads": threads}


@router.post("")
async def create_thread(
    body: CreateBody,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> dict[str, Any]:
    data = _load(server, user)
    now = _now()
    thread = {
        "id": uuid.uuid4().hex,
        "mode": body.mode,
        "title": (body.title or "").strip() or ("新对话" if body.mode == "kbflow" else "新问数"),
        "created_at": now,
        "last_active": now,
        "pinned": False,
        "messages": [],
    }
    data["threads"].append(thread)
    _save(server, user, data)
    return _meta(thread)


@router.get("/{tid}")
async def get_thread(
    tid: str,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> dict[str, Any]:
    thread = _find(_load(server, user), tid)
    return {**_meta(thread), "messages": thread.get("messages", [])}


@router.post("/{tid}/messages")
async def append_message(
    tid: str,
    body: AppendBody,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> dict[str, Any]:
    data = _load(server, user)
    thread = _find(data, tid)
    msg = dict(body.message)
    msg.setdefault("id", uuid.uuid4().hex)
    msg.setdefault("ts", _now())
    thread.setdefault("messages", []).append(msg)
    thread["last_active"] = _now()
    # Auto-title from the first user question when still default.
    if msg.get("role") == "user" and thread["title"] in ("新对话", "新问数"):
        text = str(msg.get("text") or "").strip()
        if text:
            thread["title"] = text[:40]
    _save(server, user, data)
    return {"ok": True, "message_count": len(thread["messages"]), "title": thread["title"]}


@router.patch("/{tid}")
async def patch_thread(
    tid: str,
    body: PatchBody,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> dict[str, Any]:
    data = _load(server, user)
    thread = _find(data, tid)
    if body.title is not None:
        thread["title"] = body.title.strip()
    if body.pinned is not None:
        thread["pinned"] = body.pinned
    _save(server, user, data)
    return _meta(thread)


@router.delete("/{tid}")
async def delete_thread(
    tid: str,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> dict[str, Any]:
    data = _load(server, user)
    _find(data, tid)
    data["threads"] = [t for t in data["threads"] if t.get("id") != tid]
    _save(server, user, data)
    return {"ok": True}
