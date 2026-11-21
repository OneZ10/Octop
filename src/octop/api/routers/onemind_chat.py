"""OneMind direct-connect rich chat SSE proxy.

Streams the platform kbflow (knowledge QA) and chatbi (data QA) APIs directly,
keeping credentials server-side. The existing onemind-kbflow / onemind-chatbi
connectors remain for agent tool use; this router powers the OneMind QA page's
direct chat UI (streaming answer, source citations, executed SQL, charts and
suggested follow-up questions).
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, Depends, Path
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from octop.api.deps import get_server, require_permission
from octop.infra.connectors.service import ConnectorService
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.server import OctopServer
from octop.infra.users.identity import User

logger = logging.getLogger(__name__)

router = APIRouter()

_TIMEOUT = httpx.Timeout(300.0, connect=30.0)


class ChatBody(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    conversation_id: str | None = Field(default=None, max_length=200)
    session_id: str | None = Field(default=None, max_length=200)


def _connector_service(server: Any) -> ConnectorService:
    return ConnectorService(
        repo=server.services.repos.connector_repo,
        secret_repo=server.services.secret_repo,
        settings_repo=server.services.settings_repo,
        config=server.services.config,
    )


def _resolve_creds(server: OctopServer, user: User, kind: str) -> dict[str, Any]:
    svc = _connector_service(server)
    rows = svc.list_user_instances(user.id, active_only=True, with_credentials=True)
    for row in rows:
        if row.kind == kind:
            creds = svc.decrypt(row.instance_id)
            if creds.get("base_url") and creds.get("api_key"):
                return creds
    raise OctopError(
        ErrorCode.NOT_FOUND,
        f"no configured {kind} connector instance",
        status=404,
    )


def _sse(evt: dict[str, Any]) -> str:
    return f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"


def _parse_data_line(line: str) -> dict[str, Any] | None:
    if not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        obj = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


async def _kbflow_events(
    creds: dict[str, Any], question: str, conversation_id: str | None
) -> AsyncIterator[str]:
    base = str(creds["base_url"]).rstrip("/")
    headers = {
        "Authorization": f"Bearer {creds['api_key']}",
        "Accept": "text/event-stream",
    }
    body: dict[str, Any] = {
        "app_id": creds.get("app_id"),
        "input": question,
        "stream": True,
    }
    if conversation_id:
        body["conversation_id"] = conversation_id
    try:
        async with (
            httpx.AsyncClient(timeout=_TIMEOUT) as client,
            client.stream(
                "POST", f"{base}/kb_qa/site/responses", headers=headers, json=body
            ) as resp,
        ):
            if resp.status_code != 200:
                await resp.aread()
                yield _sse({"type": "error", "message": f"platform HTTP {resp.status_code}"})
                return
            call_by_item: dict[str, str] = {}
            async for line in resp.aiter_lines():
                obj = _parse_data_line(line)
                if obj is None:
                    continue
                etype = obj.get("type")
                if etype == "response.output_text.delta":
                    delta = obj.get("delta")
                    if isinstance(delta, str) and delta:
                        yield _sse({"type": "delta", "text": delta})
                elif etype in ("response.output_item.added", "response.output_item.done"):
                    item = obj.get("item") or {}
                    call_id = item.get("call_id") or item.get("id")
                    if item.get("type") == "function_call" and etype.endswith("added"):
                        if item.get("id") and call_id:
                            call_by_item[str(item.get("id"))] = str(call_id)
                        yield _sse(
                            {"type": "tool_start", "callId": call_id, "name": item.get("name")}
                        )
                    elif item.get("type") == "function_call_output" and etype.endswith("done"):
                        out = item.get("output")
                        yield _sse(
                            {
                                "type": "tool_end",
                                "callId": call_id,
                                "output": out
                                if isinstance(out, str)
                                else json.dumps(out, ensure_ascii=False),
                            }
                        )
                elif etype == "response.function_call_arguments.done":
                    yield _sse(
                        {
                            "type": "tool_args",
                            "callId": obj.get("call_id")
                            or call_by_item.get(str(obj.get("item_id")))
                            or obj.get("item_id"),
                            "arguments": obj.get("arguments"),
                        }
                    )
                elif etype == "response.completed":
                    result = obj.get("response") or {}
                    meta = result.get("metadata") or {}
                    chunks = (meta.get("kb_retrieval") or {}).get("chunks") or []
                    citations = []
                    for chunk in chunks:
                        cm = chunk.get("metadata") or {}
                        citations.append(
                            {
                                "content": chunk.get("content", ""),
                                "doc_name": cm.get("doc_name", ""),
                                "doc_id": cm.get("doc_id"),
                                "score": cm.get("score"),
                                "segment_id": cm.get("segment_id"),
                                "position": cm.get("position"),
                            }
                        )
                    if citations:
                        yield _sse({"type": "citations", "chunks": citations})
                    yield _sse(
                        {
                            "type": "done",
                            "conversation_id": meta.get("conversation_id") or conversation_id,
                            "message_id": result.get("message_id"),
                            "response_id": result.get("id"),
                        }
                    )
    except httpx.HTTPError as exc:
        logger.warning("kbflow stream error: %s", exc)
        yield _sse({"type": "error", "message": f"platform connection error: {exc}"})


def _chatbi_completed_events(result: dict[str, Any], session_id: str | None) -> list[str]:
    events: list[str] = []
    for item in result.get("output") or []:
        if item.get("type") != "function_call":
            continue
        name = item.get("name")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            continue
        if not isinstance(args, dict):
            continue
        if name == "render_chatbi_result":
            rows = args.get("df") or []
            if rows and isinstance(rows[0], list):
                rows = rows[0]
            events.append(
                _sse(
                    {
                        "type": "result",
                        "sql": args.get("sql") or [],
                        "last_sql": args.get("last_sql"),
                        "df": rows,
                        "row_count": args.get("row_count"),
                        "result_total_rows": args.get("resultTotalRows"),
                        "result_truncated": args.get("resultTruncated"),
                    }
                )
            )
        elif name == "render_echart_result":
            events.append(_sse({"type": "chart", "option": args.get("option") or []}))
        elif name == "suggest_follow_up_questions":
            events.append(_sse({"type": "followups", "questions": args.get("questions") or []}))
    meta = result.get("metadata") or {}
    events.append(
        _sse(
            {
                "type": "done",
                "session_id": meta.get("session_id") or session_id,
                "message_id": result.get("message_id"),
                "response_id": result.get("id"),
            }
        )
    )
    return events


async def _chatbi_events(
    creds: dict[str, Any], question: str, session_id: str | None
) -> AsyncIterator[str]:
    base = str(creds["base_url"]).rstrip("/")
    db_set_id = creds.get("db_set_id")
    auth = {"Authorization": f"Bearer {creds['api_key']}"}
    headers = {
        **auth,
        "X-Chatbi-Db-Set-Id": str(db_set_id),
        "Accept": "text/event-stream",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            if not session_id:
                sresp = await client.post(f"{base}/newchat/responses/sessions", headers=auth)
                if sresp.status_code == 200:
                    session_id = (sresp.json() or {}).get("session_id")
            body: dict[str, Any] = {
                "model": "固定-chatbi",
                "input": [{"role": "user", "content": question}],
                "stream": True,
                "db_set_id": db_set_id,
            }
            if session_id:
                body["session_id"] = session_id
            async with client.stream(
                "POST", f"{base}/newchat/responses", headers=headers, json=body
            ) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    yield _sse({"type": "error", "message": f"platform HTTP {resp.status_code}"})
                    return
                async for line in resp.aiter_lines():
                    obj = _parse_data_line(line)
                    if obj is None:
                        continue
                    etype = obj.get("type")
                    if etype == "response.output_text.delta":
                        delta = obj.get("delta")
                        if isinstance(delta, str) and delta:
                            yield _sse({"type": "delta", "text": delta})
                    elif etype == "response.chatbi.progress":
                        yield _sse(
                            {
                                "type": "progress",
                                "step": obj.get("step"),
                                "phase": obj.get("phase"),
                                "label": obj.get("label"),
                                "tool": obj.get("tool"),
                                "content": obj.get("content"),
                            }
                        )
                    elif etype == "response.completed":
                        for evt in _chatbi_completed_events(obj.get("response") or {}, session_id):
                            yield evt
    except httpx.HTTPError as exc:
        logger.warning("chatbi stream error: %s", exc)
        yield _sse({"type": "error", "message": f"platform connection error: {exc}"})


def _stream_response(gen: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/kbflow/stream")
async def kbflow_stream(
    body: ChatBody,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> StreamingResponse:
    creds = _resolve_creds(server, user, "onemind-kbflow")
    return _stream_response(_kbflow_events(creds, body.question, body.conversation_id))


@router.post("/chatbi/stream")
async def chatbi_stream(
    body: ChatBody,
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> StreamingResponse:
    creds = _resolve_creds(server, user, "onemind-chatbi")
    return _stream_response(_chatbi_events(creds, body.question, body.session_id))


class DocPreviewResponse(BaseModel):
    """MinerU-converted preview of a cited knowledge document."""

    doc_id: str = Field(description="Platform document id")
    file_name: str = Field(description="Original uploaded file name")
    file_url: str = Field(
        description="Absolute presigned URL of the converted file (platform-signed, expires ~1h)"
    )
    preview_file_extension: str = Field(
        description="Converted file extension including the dot, e.g. '.pdf'"
    )
    md_content: str | None = Field(
        default=None,
        description="Markdown content when the platform provides it (e.g. xlsx tables)",
    )


def _preview_error(message: str) -> OctopError:
    return OctopError(ErrorCode.NETWORK_ERROR, message, status=502)


def _check_platform_code(payload: dict[str, Any], endpoint: str) -> None:
    code = payload.get("code")
    if isinstance(code, int) and code not in (0, 1):
        reason = str(payload.get("msg") or payload.get("message") or code)
        raise _preview_error(f"platform {endpoint} error: {reason[:300]}")


async def _doc_preview(creds: dict[str, Any], doc_id: str) -> dict[str, Any]:
    """Resolve a citation's doc_id to its MinerU-converted preview file URL.

    Two site-appkey calls (no platform JWT needed): queryDoc fetches the
    document record, mineru_preview returns the converted file's presigned
    URL. Relative URLs are resolved against the connector's platform origin.
    """
    base = str(creds["base_url"]).rstrip("/")
    headers = {
        "Authorization": f"Bearer {creds['api_key']}",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
            resp = await client.get(f"{base}/kb_qa/site/queryDoc/{doc_id}", headers=headers)
            if resp.status_code != 200:
                raise _preview_error(f"platform queryDoc HTTP {resp.status_code}")
            doc = resp.json()
            if not isinstance(doc, dict):
                raise _preview_error("platform queryDoc returned an invalid payload")
            _check_platform_code(doc, "queryDoc")
            storage_path = doc.get("storage_path")
            if not isinstance(storage_path, str) or not storage_path:
                raise _preview_error("platform queryDoc returned no storage_path")
            file_name = str(doc.get("file_name") or doc.get("doc_name") or "")
            body = {
                "storage_path": storage_path,
                "file_name": file_name,
                "file_extension": str(doc.get("file_extension") or ""),
                "md5": str(doc.get("md5_hash") or ""),
                "doc_id": doc_id,
            }
            presp = await client.post(
                f"{base}/kb_qa/site/mineru_preview", headers=headers, json=body
            )
            if presp.status_code != 200:
                raise _preview_error(f"platform mineru_preview HTTP {presp.status_code}")
            preview = presp.json()
    except httpx.HTTPError as exc:
        logger.warning("kbflow doc preview error: %s", exc)
        raise _preview_error(f"platform connection error: {exc}") from exc
    if not isinstance(preview, dict):
        raise _preview_error("platform mineru_preview returned an invalid payload")
    _check_platform_code(preview, "mineru_preview")
    converted = preview.get("converted_file_url")
    if not isinstance(converted, str) or not converted:
        raise _preview_error("platform mineru_preview returned no converted_file_url")
    parsed = urlsplit(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    file_url = (
        converted if converted.startswith(("http://", "https://")) else urljoin(origin, converted)
    )
    if urlsplit(file_url).scheme not in ("http", "https"):
        raise _preview_error("platform returned a non-HTTP preview URL")
    md_content = preview.get("md_content")
    return {
        "doc_id": doc_id,
        "file_name": file_name,
        "file_url": file_url,
        "preview_file_extension": str(preview.get("preview_file_extension") or ""),
        "md_content": md_content if isinstance(md_content, str) else None,
    }


@router.get(
    "/kbflow/doc-preview/{doc_id}",
    response_model=DocPreviewResponse,
    summary="Preview the MinerU-converted source file of a cited KB document",
    description=(
        "Resolves a kbflow citation doc_id through the platform site API "
        "(queryDoc + mineru_preview) and returns an absolute presigned URL of "
        "the converted file (docx/doc → PDF, native PDF re-rendered, xlsx kept "
        "native with optional markdown). The URL needs no Authorization header "
        "and expires after about one hour; re-request to refresh."
    ),
)
async def kbflow_doc_preview(
    doc_id: str = Path(pattern=r"[A-Za-z0-9_-]{1,128}"),
    server: OctopServer = Depends(get_server),
    user: User = Depends(require_permission("onemind_qa")),
) -> DocPreviewResponse:
    creds = _resolve_creds(server, user, "onemind-kbflow")
    return DocPreviewResponse(**await _doc_preview(creds, doc_id))
