"""OneMind KBFlow REST contract, credential validation, and gateway tools."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from octop.config import OctopConfig
from octop.infra.connectors.builder import validate_create_credentials
from octop.infra.connectors.catalog import catalog_entry_to_dict, get_catalog_entry
from octop.infra.connectors.gateway.adapters import onemind_kbflow
from octop.infra.connectors.gateway.protocol import handle_mcp_request
from octop.infra.connectors.probe import probe_connector
from octop.infra.errors import OctopError

CREDS = {
    "base_url": "http://127.0.0.1:8084/api-kbflow/v1",
    "api_key": "app-test-key",
    "app_id": "app-1",
}


@pytest.fixture
def mock_http(monkeypatch: pytest.MonkeyPatch) -> Callable[..., list[httpx.Request]]:
    original_client = httpx.Client

    def install(
        payload: Any = None, *, status: int = 200, text: str | None = None
    ) -> list[httpx.Request]:
        calls: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            if text is not None:
                return httpx.Response(status, text=text)
            return httpx.Response(status, json=payload)

        def client(**kwargs: Any) -> httpx.Client:
            assert kwargs["follow_redirects"] is False
            return original_client(transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(onemind_kbflow.httpx, "Client", client)
        return calls

    return install


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("http://127.0.0.1:8084/", "http://127.0.0.1:8084/api-kbflow/v1"),
        ("http://10.0.0.5:8084/api-kbflow/v1/", "http://10.0.0.5:8084/api-kbflow/v1"),
    ],
)
def test_credentials_normalize_url(url: str, expected: str) -> None:
    creds = validate_create_credentials("onemind-kbflow", {**CREDS, "base_url": url})
    assert creds["base_url"] == expected
    assert creds["app_id"] == "app-1"
    assert creds["internal_token"]


@pytest.mark.parametrize("key", ["", "  ", "secret\nheader"])
def test_credentials_require_api_key(key: str) -> None:
    with pytest.raises(ValueError, match="API Key"):
        validate_create_credentials("onemind-kbflow", {**CREDS, "api_key": key})


@pytest.mark.parametrize("app_id", ["", "  ", "../secret", "a/b"])
def test_credentials_require_valid_app_id(app_id: str) -> None:
    with pytest.raises(ValueError, match="app ID"):
        validate_create_credentials("onemind-kbflow", {**CREDS, "app_id": app_id})


@pytest.mark.parametrize(
    "url",
    [
        "https://kbflow.example.com?key=secret",
        "http://127.0.0.1:8084/#/chat",
        "http://user:secret@127.0.0.1:8084",
    ],
)
def test_credentials_reject_unsafe_urls(url: str) -> None:
    with pytest.raises((ValueError, OctopError)):
        validate_create_credentials("onemind-kbflow", {**CREDS, "base_url": url})


def test_catalog_localizes_fields_and_marks_key_secret() -> None:
    entry = get_catalog_entry("onemind-kbflow")
    assert entry is not None
    assert (entry.auth_kind, entry.category, entry.mcp_mode) == (
        "custom_fields",
        "knowledge",
        "gateway",
    )
    zh = catalog_entry_to_dict(entry, locale="zh")
    fields = {field["key"]: field for field in zh["credential_fields"]}
    assert fields["base_url"]["label"] == "服务地址"
    assert fields["api_key"]["secret"] is True
    assert fields["api_key"]["required"] is True
    assert fields["app_id"]["required"] is True


def _response_payload(text: str = "答案") -> dict[str, Any]:
    return {
        "id": "resp_1",
        "object": "response",
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "metadata": {"message_id": "msg-1"},
        "conversation_id": "conv-1",
    }


def test_kb_qa_posts_non_streaming_and_extracts_answer(mock_http: Callable[..., Any]) -> None:
    calls = mock_http(_response_payload())
    result = json.loads(
        onemind_kbflow.call_tool(
            CREDS, "kb_qa", {"question": "监理规范?", "conversation_id": "conv-0"}
        )
    )
    assert calls[0].url.path == "/api-kbflow/v1/kb_qa/site/responses"
    assert json.loads(calls[0].content) == {
        "app_id": "app-1",
        "input": "监理规范?",
        "stream": False,
        "conversation_id": "conv-0",
    }
    assert calls[0].headers["authorization"] == "Bearer app-test-key"
    assert result["answer"] == "答案"
    assert result["message_id"] == "msg-1"
    assert result["conversation_id"] == "conv-1"
    assert result["response_id"] == "resp_1"
    assert result["truncated"] is False


def test_kb_qa_extracts_ids_from_real_platform_shape(mock_http: Callable[..., Any]) -> None:
    # Real platform: conversation_id lives in metadata; message id is the output message object id.
    mock_http(
        {
            "id": "resp_real",
            "object": "response",
            "status": "completed",
            "output": [
                {
                    "id": "msg_real",
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "实时答案"}],
                }
            ],
            "metadata": {"conversation_id": "conv_real", "app_id": "app-1"},
        }
    )
    result = json.loads(onemind_kbflow.call_tool(CREDS, "kb_qa", {"question": "q"}))
    assert result["answer"] == "实时答案"
    assert result["conversation_id"] == "conv_real"
    assert result["message_id"] == "msg_real"
    assert result["response_id"] == "resp_real"


def test_kb_qa_accepts_output_text_shortcut(mock_http: Callable[..., Any]) -> None:
    mock_http({"id": "resp_2", "status": "completed", "output_text": "直接文本"})
    result = json.loads(onemind_kbflow.call_tool(CREDS, "kb_qa", {"question": "q"}))
    assert result["answer"] == "直接文本"
    assert "conversation_id" not in result


def test_kb_qa_caps_long_answers(mock_http: Callable[..., Any]) -> None:
    mock_http(_response_payload("长" * 9000))
    result = json.loads(onemind_kbflow.call_tool(CREDS, "kb_qa", {"question": "q"}))
    assert len(result["answer"]) == 8000
    assert result["truncated"] is True


def test_kb_qa_requires_question(mock_http: Callable[..., Any]) -> None:
    calls = mock_http(_response_payload())
    with pytest.raises(ValueError):
        onemind_kbflow.call_tool(CREDS, "kb_qa", {"question": "  "})
    assert calls == []


@pytest.mark.parametrize("value", ["..", "a/b", "x?token=secret"])
def test_kb_qa_rejects_path_injection(value: str, mock_http: Callable[..., Any]) -> None:
    calls = mock_http()
    with pytest.raises(ValueError, match="conversation_id"):
        onemind_kbflow.call_tool(CREDS, "kb_qa", {"question": "q", "conversation_id": value})
    assert not calls


def test_kb_qa_rejects_empty_answer(mock_http: Callable[..., Any]) -> None:
    mock_http({"id": "resp_3", "status": "completed", "output": []})
    with pytest.raises(ValueError, match="invalid API response"):
        onemind_kbflow.call_tool(CREDS, "kb_qa", {"question": "q"})


def test_create_conversation_persists_and_names(mock_http: Callable[..., Any]) -> None:
    calls = mock_http({"id": "row-1", "conversation_id": "conv-new", "user_id": "u-1"})
    result = json.loads(
        onemind_kbflow.call_tool(CREDS, "create_conversation", {"name": "监理会话"})
    )
    assert calls[0].url.path == "/api-kbflow/v1/kb_qa/site/conversation/saveInsert"
    body = json.loads(calls[0].content)
    assert body["app_id"] == "app-1"
    assert body["mode"] == "QA_CHAT"
    assert body["enable_memory"] is True
    assert body["name"] == "监理会话"
    assert result["conversation_id"] == "conv-new"


def test_list_conversations_uses_app_id_and_caps_strings(mock_http: Callable[..., Any]) -> None:
    calls = mock_http([{"conversation_id": "conv-1", "name": "名" * 5000}])
    result = json.loads(onemind_kbflow.call_tool(CREDS, "list_conversations", {}))
    assert calls[0].url.path == "/api-kbflow/v1/kb_qa/site/conversation/list/app-1"
    assert result[0]["name"].endswith("…[truncated]")
    assert len(result[0]["name"]) == 4012


def test_get_messages_reads_conversation_and_caps_content(mock_http: Callable[..., Any]) -> None:
    calls = mock_http({"messages": [{"role": "assistant", "content": "文" * 5000}]})
    result = json.loads(
        onemind_kbflow.call_tool(CREDS, "get_messages", {"conversation_id": "conv-1"})
    )
    assert calls[0].url.path == "/api-kbflow/v1/kb_qa/site/messages/conv-1"
    assert len(result["messages"][0]["content"]) == 4012


@pytest.mark.parametrize("value", ["", "..", "a/b"])
def test_get_messages_rejects_path_injection(value: str, mock_http: Callable[..., Any]) -> None:
    calls = mock_http()
    with pytest.raises(ValueError, match="conversation_id"):
        onemind_kbflow.call_tool(CREDS, "get_messages", {"conversation_id": value})
    assert not calls


@pytest.mark.parametrize("status", [301, 401, 403, 500])
def test_probe_fails_on_http_errors(status: int, mock_http: Callable[..., Any]) -> None:
    calls = mock_http([], status=status)
    with pytest.raises(ValueError, match=f"HTTP {status}"):
        onemind_kbflow.probe_credentials(CREDS)
    assert len(calls) == 1


def test_probe_rejects_non_json_and_business_error(mock_http: Callable[..., Any]) -> None:
    mock_http(text="<html>sign in</html>")
    with pytest.raises(ValueError, match="invalid API response"):
        onemind_kbflow.probe_credentials(CREDS)
    mock_http({"code": 4000, "msg": "invalid key: app-test-key"})
    with pytest.raises(ValueError, match="invalid key") as exc:
        onemind_kbflow.probe_credentials(CREDS)
    assert "app-test-key" not in str(exc.value)


async def test_gateway_probe_validates_auth_before_listing_tools(
    mock_http: Callable[..., Any],
) -> None:
    entry = get_catalog_entry("onemind-kbflow")
    assert entry is not None
    mock_http({"code": 4000, "msg": "invalid key"})
    failed = await probe_connector(entry, CREDS, instance_id="probe", config=OctopConfig())
    assert failed["ok"] is False
    mock_http([])
    success = await probe_connector(entry, CREDS, instance_id="probe", config=OctopConfig())
    assert success["ok"] is True
    assert {tool["name"] for tool in success["tools"]} == {
        "kb_qa",
        "create_conversation",
        "list_conversations",
        "get_messages",
    }


def test_gateway_mcp_routes_calls_and_errors(mock_http: Callable[..., Any]) -> None:
    mock_http([])
    result = handle_mcp_request(
        kind="onemind-kbflow",
        creds=CREDS,
        body={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "list_conversations", "arguments": {}},
        },
    )
    assert result["result"]["isError"] is False
    assert json.loads(result["result"]["content"][0]["text"]) == []
    error = handle_mcp_request(
        kind="onemind-kbflow",
        creds={**CREDS, "_locale": "zh"},
        body={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "delete_conversation", "arguments": {}},
        },
    )
    assert error["result"]["isError"] is True
    assert "未知的 OneMind 智能问答工具" in error["result"]["content"][0]["text"]
