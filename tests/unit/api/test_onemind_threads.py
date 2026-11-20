"""Unit tests for the OneMind direct-chat thread persistence router."""

from __future__ import annotations

import pytest

from octop.api.routers import onemind_threads as ot
from octop.infra.errors import OctopError


class _Settings:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.data.get(key)

    def set(self, key: str, value: str) -> None:
        self.data[key] = value

    def delete(self, key: str) -> None:
        self.data.pop(key, None)


class _Services:
    def __init__(self) -> None:
        self.settings_repo = _Settings()


class _Server:
    def __init__(self) -> None:
        self.services = _Services()


class _User:
    id = 7


@pytest.fixture()
def env():
    return _Server(), _User()


async def test_create_list_get_append_rename_delete(env):
    server, user = env
    created = await ot.create_thread(ot.CreateBody(mode="kbflow"), server=server, user=user)
    tid = created["id"]
    assert created["mode"] == "kbflow"
    assert created["message_count"] == 0

    listed = await ot.list_threads(server=server, user=user)
    assert [t["id"] for t in listed["threads"]] == [tid]

    appended = await ot.append_message(
        tid,
        ot.AppendBody(message={"role": "user", "text": "安全监理日志需要填写哪些内容？"}),
        server=server,
        user=user,
    )
    assert appended["ok"] is True
    assert appended["message_count"] == 1
    # Auto-title from first user question.
    assert appended["title"].startswith("安全监理日志")

    await ot.append_message(
        tid,
        ot.AppendBody(
            message={
                "role": "assistant",
                "text": "answer",
                "citations": [{"doc_name": "a.pdf", "content": "x"}],
                "result": {"sql": ["SELECT 1"], "df": [{"n": 1}]},
                "chart": {"option": []},
                "followups": ["q1"],
            }
        ),
        server=server,
        user=user,
    )
    full = await ot.get_thread(tid, server=server, user=user)
    assert full["message_count"] == 2
    assistant = full["messages"][1]
    assert assistant["citations"][0]["doc_name"] == "a.pdf"
    assert assistant["result"]["sql"] == ["SELECT 1"]
    assert assistant["followups"] == ["q1"]

    renamed = await ot.patch_thread(tid, ot.PatchBody(title="日志要点"), server=server, user=user)
    assert renamed["title"] == "日志要点"
    pinned = await ot.patch_thread(tid, ot.PatchBody(pinned=True), server=server, user=user)
    assert pinned["pinned"] is True

    deleted = await ot.delete_thread(tid, server=server, user=user)
    assert deleted["ok"] is True
    assert (await ot.list_threads(server=server, user=user))["threads"] == []


async def test_mode_filter_and_isolation(env):
    server, user = env
    a = await ot.create_thread(ot.CreateBody(mode="kbflow"), server=server, user=user)
    b = await ot.create_thread(ot.CreateBody(mode="chatbi"), server=server, user=user)
    only_bi = await ot.list_threads(mode="chatbi", server=server, user=user)
    assert [t["id"] for t in only_bi["threads"]] == [b["id"]]
    # A different user sees nothing.
    other = _User()
    other.id = 99
    assert (await ot.list_threads(server=server, user=other))["threads"] == []
    assert a["id"] != b["id"]


async def test_get_missing_raises(env):
    server, user = env
    with pytest.raises(OctopError):
        await ot.get_thread("nope", server=server, user=user)


async def test_corrupt_store_resets(env):
    server, user = env
    server.services.settings_repo.set(ot._store_key(user.id), "{not json")
    assert (await ot.list_threads(server=server, user=user))["threads"] == []
