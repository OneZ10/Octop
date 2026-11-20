"""Tests for the OneMind direct-connect chat SSE proxy."""

from __future__ import annotations

import json
from typing import Any

import pytest

from octop.api.routers import onemind_chat
from octop.infra.errors import OctopError

CREDS_KB = {
    "base_url": "http://127.0.0.1:8084/api-kbflow/v1",
    "api_key": "app-test",
    "app_id": "app-1",
}
CREDS_BI = {
    "base_url": "http://127.0.0.1:8084/api-dbset/v1",
    "api_key": "dbset-test",
    "db_set_id": "ds-1",
}


def _data(obj: dict[str, Any]) -> str:
    return "data: " + json.dumps(obj, ensure_ascii=False)


class _FakeStreamResp:
    def __init__(self, lines: list[str], status: int = 200) -> None:
        self._lines = lines
        self.status_code = status

    async def __aenter__(self) -> _FakeStreamResp:
        return self

    async def __aexit__(self, *args: Any) -> bool:
        return False

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self) -> bytes:
        return b""


class _FakePostResp:
    def __init__(self, data: dict[str, Any], status: int = 200) -> None:
        self._data = data
        self.status_code = status

    def json(self) -> dict[str, Any]:
        return self._data


class _FakeAsyncClient:
    stream_lines: list[str] = []
    stream_status: int = 200
    post_data: dict[str, Any] = {"session_id": "sess-1"}
    captured: dict[str, Any] = {}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *args: Any) -> bool:
        return False

    def stream(self, method: str, url: str, **kwargs: Any) -> _FakeStreamResp:
        _FakeAsyncClient.captured = {
            "url": url,
            "json": kwargs.get("json"),
            "headers": kwargs.get("headers"),
        }
        return _FakeStreamResp(_FakeAsyncClient.stream_lines, _FakeAsyncClient.stream_status)

    async def post(self, url: str, **kwargs: Any) -> _FakePostResp:
        return _FakePostResp(_FakeAsyncClient.post_data)


@pytest.fixture
def fake_http(monkeypatch: pytest.MonkeyPatch):
    _FakeAsyncClient.stream_lines = []
    _FakeAsyncClient.stream_status = 200
    _FakeAsyncClient.captured = {}
    monkeypatch.setattr(onemind_chat.httpx, "AsyncClient", _FakeAsyncClient)
    return _FakeAsyncClient


def _events(raw: list[str]) -> list[dict[str, Any]]:
    out = []
    for chunk in raw:
        assert chunk.startswith("data: ")
        out.append(json.loads(chunk[6:].strip()))
    return out


def test_parse_data_line_variants() -> None:
    assert onemind_chat._parse_data_line('data: {"type":"x"}') == {"type": "x"}
    assert onemind_chat._parse_data_line("event: message") is None
    assert onemind_chat._parse_data_line("data: [DONE]") is None
    assert onemind_chat._parse_data_line("data: not-json") is None
    assert onemind_chat._parse_data_line("data: ") is None


def test_chatbi_completed_events_extracts_three_functions() -> None:
    result = {
        "id": "resp-1",
        "message_id": "msg-1",
        "metadata": {"session_id": "sess-9"},
        "output": [
            {"type": "message", "content": []},
            {
                "type": "function_call",
                "name": "render_chatbi_result",
                "arguments": json.dumps(
                    {
                        "sql": ["SELECT 1"],
                        "last_sql": "SELECT 1",
                        "df": [[{"项目": "A", "数量": 3}]],
                        "row_count": 1,
                        "resultTotalRows": 1,
                        "resultTruncated": False,
                    }
                ),
            },
            {
                "type": "function_call",
                "name": "render_echart_result",
                "arguments": json.dumps(
                    {"option": [{"option_type": "bar_horizontal", "series": []}]}
                ),
            },
            {
                "type": "function_call",
                "name": "suggest_follow_up_questions",
                "arguments": json.dumps({"questions": ["q1", "q2"]}),
            },
        ],
    }
    evts = _events(onemind_chat._chatbi_completed_events(result, None))
    types = [e["type"] for e in evts]
    assert types == ["result", "chart", "followups", "done"]
    assert evts[0]["df"] == [{"项目": "A", "数量": 3}]
    assert evts[0]["sql"] == ["SELECT 1"]
    assert evts[1]["option"][0]["option_type"] == "bar_horizontal"
    assert evts[2]["questions"] == ["q1", "q2"]
    assert evts[3]["session_id"] == "sess-9"
    assert evts[3]["message_id"] == "msg-1"


async def test_kbflow_events_streams_delta_and_citations(fake_http) -> None:
    fake_http.stream_lines = [
        _data({"type": "response.created"}),
        _data({"type": "response.output_text.delta", "delta": "你好"}),
        _data({"type": "response.output_text.delta", "delta": "世界"}),
        _data(
            {
                "type": "response.completed",
                "response": {
                    "id": "r1",
                    "message_id": "m1",
                    "metadata": {
                        "conversation_id": "conv-1",
                        "kb_retrieval": {
                            "chunks": [
                                {
                                    "content": "原文片段",
                                    "metadata": {
                                        "doc_name": "监理规范.pdf",
                                        "score": 0.9,
                                        "segment_id": "s1",
                                    },
                                }
                            ]
                        },
                    },
                },
            }
        ),
    ]
    evts = _events([e async for e in onemind_chat._kbflow_events(CREDS_KB, "问题", None)])
    assert evts[0] == {"type": "delta", "text": "你好"}
    assert evts[1] == {"type": "delta", "text": "世界"}
    assert evts[2]["type"] == "citations"
    assert evts[2]["chunks"][0]["doc_name"] == "监理规范.pdf"
    assert evts[3]["type"] == "done"
    assert evts[3]["conversation_id"] == "conv-1"
    assert fake_http.captured["url"].endswith("/kb_qa/site/responses")
    assert fake_http.captured["json"]["app_id"] == "app-1"
    assert fake_http.captured["headers"]["Authorization"] == "Bearer app-test"


async def test_kbflow_events_error_status(fake_http) -> None:
    fake_http.stream_status = 500
    evts = _events([e async for e in onemind_chat._kbflow_events(CREDS_KB, "q", None)])
    assert evts == [{"type": "error", "message": "platform HTTP 500"}]


async def test_chatbi_events_progress_and_create_session(fake_http) -> None:
    fake_http.stream_lines = [
        _data(
            {
                "type": "response.chatbi.progress",
                "step": "tool",
                "phase": "done",
                "label": "执行SQL",
                "tool": "search_table_schema",
                "content": "done",
            }
        ),
        _data({"type": "response.output_text.delta", "delta": "答案"}),
        _data(
            {
                "type": "response.completed",
                "response": {
                    "id": "r2",
                    "metadata": {"session_id": "sess-1"},
                    "output": [
                        {
                            "type": "function_call",
                            "name": "suggest_follow_up_questions",
                            "arguments": json.dumps({"questions": ["追问"]}),
                        }
                    ],
                },
            }
        ),
    ]
    evts = _events([e async for e in onemind_chat._chatbi_events(CREDS_BI, "问数", None)])
    types = [e["type"] for e in evts]
    assert types == ["progress", "delta", "followups", "done"]
    assert evts[0]["label"] == "执行SQL"
    assert evts[3]["session_id"] == "sess-1"
    assert fake_http.captured["json"]["session_id"] == "sess-1"
    assert fake_http.captured["headers"]["X-Chatbi-Db-Set-Id"] == "ds-1"


async def test_chatbi_events_keeps_existing_session(fake_http) -> None:
    fake_http.stream_lines = [_data({"type": "response.completed", "response": {"output": []}})]
    evts = _events([e async for e in onemind_chat._chatbi_events(CREDS_BI, "q", "existing-sess")])
    assert evts[-1]["type"] == "done"
    assert fake_http.captured["json"]["session_id"] == "existing-sess"


def test_resolve_creds_missing_raises() -> None:
    class _Row:
        kind = "other"
        instance_id = "x"

    class _Svc:
        def __init__(self, **kwargs: Any) -> None:
            pass

        def list_user_instances(self, *a: Any, **k: Any) -> list:
            return [_Row()]

        def decrypt(self, instance_id: str) -> dict:
            return {}

    class _Services:
        class repos:
            connector_repo = None

        secret_repo = None
        settings_repo = None
        config = None

    class _Server:
        services = _Services()

    class _User:
        id = 1

    import octop.api.routers.onemind_chat as mod

    orig = mod.ConnectorService
    mod.ConnectorService = _Svc  # type: ignore[assignment]
    try:
        with pytest.raises(OctopError):
            mod._resolve_creds(_Server(), _User(), "onemind-kbflow")  # type: ignore[arg-type]
    finally:
        mod.ConnectorService = orig
