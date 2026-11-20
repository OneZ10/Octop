"""OneMind KBFlow knowledge-base QA tools over the site responses HTTP API."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from octop.i18n import tr
from octop.infra.connectors.builder import normalize_onemind_kbflow_base_url

_ANSWER_CHARS = 8000
_FIELD_CHARS = 4000
_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]+")

TOOLS: list[dict[str, Any]] = [
    {
        "name": "kb_qa",
        "description": (
            "Ask the OneMind knowledge-base QA app a question and get a grounded answer. "
            "Pass conversation_id from create_conversation to continue a multi-turn session."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "minLength": 1, "description": "Question to ask"},
                "conversation_id": {
                    "type": "string",
                    "description": "Existing conversation ID for multi-turn context; omit for a new one",
                },
            },
            "required": ["question"],
        },
    },
    {
        "name": "create_conversation",
        "description": "Create a persisted OneMind QA conversation and return its conversation_id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Optional conversation name"},
            },
        },
    },
    {
        "name": "list_conversations",
        "description": "List the current user's OneMind QA conversations, newest modified first.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_messages",
        "description": (
            "Read a OneMind QA conversation's messages (content, roles, retrieval references). "
            "Requires conversation_id from create_conversation or list_conversations."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "conversation_id": {"type": "string", "minLength": 1},
            },
            "required": ["conversation_id"],
        },
    },
]


def list_tools() -> list[dict[str, Any]]:
    return TOOLS


def _text(creds: dict[str, Any], key: str, **kwargs: object) -> str:
    return tr(f"onemind-kbflow.{key}", str(creds.get("_locale") or "en"), **kwargs)


def _app_id(creds: dict[str, Any]) -> str:
    app_id = str(creds.get("app_id") or "").strip()
    if not _ID_PATTERN.fullmatch(app_id):
        raise ValueError(_text(creds, "app_id_required"))
    return app_id


def _request(
    creds: dict[str, Any],
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> Any:
    base_url = normalize_onemind_kbflow_base_url(str(creds.get("base_url") or ""))
    api_key = str(creds.get("api_key") or "").strip()
    if not api_key or any(char in api_key for char in "\r\n\x00"):
        raise ValueError(_text(creds, "api_key_required"))
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            response = client.request(
                method,
                f"{base_url}{path}",
                headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
                json=body,
            )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ValueError(_text(creds, "http_error", status=exc.response.status_code)) from exc
    except httpx.HTTPError as exc:
        raise ValueError(_text(creds, "network_error")) from exc
    # Redirects must never forward the credential to another host.
    if response.is_redirect:
        raise ValueError(_text(creds, "http_error", status=response.status_code))
    try:
        payload = response.json()
    except ValueError as exc:
        raise ValueError(_text(creds, "invalid_response")) from exc
    if not isinstance(payload, (dict, list)):
        raise ValueError(_text(creds, "invalid_response"))
    if isinstance(payload, dict):
        code = payload.get("code")
        if isinstance(code, int) and code not in (0, 1):
            reason = str(payload.get("msg") or payload.get("message") or code)
            raise ValueError(_text(creds, "api_error", reason=reason.replace(api_key, "***")[:500]))
    return payload


def _cap_strings(value: Any, limit: int = _FIELD_CHARS) -> Any:
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…[truncated]"
    if isinstance(value, list):
        return [_cap_strings(item, limit) for item in value]
    if isinstance(value, dict):
        return {key: _cap_strings(item, limit) for key, item in value.items()}
    return value


def _answer_text(payload: dict[str, Any]) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct
    parts: list[str] = []
    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "output_text":
                    text = block.get("text")
                    if isinstance(text, str):
                        parts.append(text)
    return "\n".join(parts)


def _kb_qa(creds: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    question = str(args.get("question") or "").strip()
    if not question:
        raise ValueError(_text(creds, "query_required"))
    body: dict[str, Any] = {
        "app_id": _app_id(creds),
        "input": question,
        "stream": False,
    }
    conversation_id = str(args.get("conversation_id") or "").strip()
    if conversation_id:
        if not _ID_PATTERN.fullmatch(conversation_id):
            raise ValueError(_text(creds, "invalid_id", field="conversation_id"))
        body["conversation_id"] = conversation_id
    payload = _request(creds, "POST", "/kb_qa/site/responses", body=body, timeout=120.0)
    if not isinstance(payload, dict):
        raise ValueError(_text(creds, "invalid_response"))
    answer = _answer_text(payload)
    if not answer.strip():
        raise ValueError(_text(creds, "invalid_response"))
    metadata_raw = payload.get("metadata")
    metadata: dict[str, Any] = metadata_raw if isinstance(metadata_raw, dict) else {}
    message_id = metadata.get("message_id")
    if not message_id:
        output = payload.get("output")
        if isinstance(output, list):
            for item in output:
                if isinstance(item, dict) and item.get("type") == "message" and item.get("id"):
                    message_id = item.get("id")
                    break
    result: dict[str, Any] = {
        "question": question,
        "answer": answer[:_ANSWER_CHARS],
        "truncated": len(answer) > _ANSWER_CHARS,
        "response_id": payload.get("id"),
        "status": payload.get("status"),
        "message_id": message_id,
    }
    returned_conversation = (
        metadata.get("conversation_id") or payload.get("conversation_id") or conversation_id
    )
    if returned_conversation:
        result["conversation_id"] = returned_conversation
    return result


def _create_conversation(creds: dict[str, Any], args: dict[str, Any]) -> Any:
    body: dict[str, Any] = {
        "app_id": _app_id(creds),
        "mode": "QA_CHAT",
        "from_source": "WEB",
        "invoke_from": "WEB",
        "enable_memory": True,
    }
    name = str(args.get("name") or "").strip()
    if name:
        body["name"] = name[:200]
    return _request(creds, "POST", "/kb_qa/site/conversation/saveInsert", body=body)


def _list_conversations(creds: dict[str, Any]) -> Any:
    return _cap_strings(_request(creds, "GET", f"/kb_qa/site/conversation/list/{_app_id(creds)}"))


def _get_messages(creds: dict[str, Any], args: dict[str, Any]) -> Any:
    conversation_id = str(args.get("conversation_id") or "").strip()
    if not _ID_PATTERN.fullmatch(conversation_id):
        raise ValueError(_text(creds, "invalid_id", field="conversation_id"))
    return _cap_strings(_request(creds, "GET", f"/kb_qa/site/messages/{conversation_id}"))


def call_tool(creds: dict[str, Any], name: str, args: dict[str, Any]) -> str:
    if name == "kb_qa":
        result = _kb_qa(creds, args)
    elif name == "create_conversation":
        result = _create_conversation(creds, args)
    elif name == "list_conversations":
        result = _list_conversations(creds)
    elif name == "get_messages":
        result = _get_messages(creds, args)
    else:
        raise ValueError(_text(creds, "unknown_tool", name=name))
    return json.dumps(result, ensure_ascii=False)


def probe_credentials(creds: dict[str, Any]) -> None:
    payload = _request(creds, "GET", f"/kb_qa/site/conversation/list/{_app_id(creds)}")
    if not isinstance(payload, (dict, list)):
        raise ValueError(_text(creds, "invalid_response"))
