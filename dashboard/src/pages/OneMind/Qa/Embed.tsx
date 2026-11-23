import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dropdown, Input, Space, Switch } from "antd";
import { MoreVertical, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatMode } from "../../../api/modules/onemindChat";
import { onemindThreadsApi } from "../../../api/modules/onemindThreads";
import { useIsMobile } from "../../../hooks/useIsMobile";
import ChatDockPanels from "../../Chat/components/ChatDockPanels";
import { useChatDockPanel } from "../../Chat/hooks/useChatDockPanel";
import { useCollapseThinking } from "../../Chat/hooks/useCollapseThinking";
import chatStyles from "../../Chat/index.module.less";
import ChatPanel from "./ChatPanel";
import type { SourceDoc } from "./CitationsBlock";
import { storedToTurns, turnToStored } from "./threadMapping";
import {
  getState,
  hydrate as storeHydrate,
  reset as storeReset,
} from "./onemindStreamStore";
import { useOnemindChat } from "./useOnemindChat";
import styles from "./qa.module.less";

const bumpRail = () =>
  window.dispatchEvent(new Event("onemind-threads-changed"));

/**
 * OneMind direct-connect chat embedded inside the native /chat surface so that
 * selecting a OneMind expert / session from the unified history rail stays
 * under the same menu (no jump to the OneMind page).
 */
export default function OneMindChatEmbed({
  mode,
  threadId,
  onNavigateThread,
}: {
  mode: ChatMode;
  threadId: string | null;
  onNavigateThread: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [cur, setCur] = useState<string | null>(threadId);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState(false);
  const dock = useChatDockPanel(isMobile, null);
  const [collapseThinking, setCollapseThinking] = useCollapseThinking(false);
  const curRef = useRef<string | null>(cur);
  curRef.current = cur;
  const loadSeqRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const loadThread = useCallback(async (id: string) => {
    // Guard against out-of-order loads (initial load vs a fast user click).
    const seq = ++loadSeqRef.current;
    const full = await onemindThreadsApi.get(id).catch(() => null);
    if (seq !== loadSeqRef.current) return;
    if (full && getState(id)?.streaming) {
      setCur(id);
      curRef.current = id;
      setTitle(full.title);
      setPinned(Boolean(full.pinned));
      return;
    }
    if (!full) {
      // A native thread id (or deleted thread) may reach the embed; fall back
      // to the most recent OneMind thread for this mode instead of empty state.
      const res = await onemindThreadsApi
        .list(modeRef.current)
        .catch(() => null);
      const first = res?.threads[0];
      if (first && first.id !== id) await loadThread(first.id);
      return;
    }
    const last = [...full.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    // Hydrate the TARGET thread's slot directly; the hook-bound chat.hydrate
    // captures the mount-time key and would leave a switched-to thread empty.
    storeHydrate(
      id,
      storedToTurns(full.messages),
      last?.conversation_id ?? null,
      last?.session_id ?? null,
    );
    setCur(id);
    curRef.current = id;
    setTitle(full.title);
    setPinned(Boolean(full.pinned));
  }, []);

  const chat = useOnemindChat(mode, cur ?? `new:${mode}`, {
    onUser: async (text) => {
      let id = curRef.current;
      if (!id) {
        const created = await onemindThreadsApi
          .create(modeRef.current)
          .catch(() => null);
        if (!created) return;
        id = created.id;
        setCur(id);
        curRef.current = id;
        onNavigateThread(id);
      }
      await onemindThreadsApi
        .append(id, { role: "user", text })
        .catch(() => null);
      bumpRail();
      return id;
    },
    onComplete: (turn, tid, conv, sess) => {
      const id = tid ?? curRef.current;
      if (!id) return;
      void onemindThreadsApi
        .append(id, {
          ...turnToStored(turn),
          conversation_id: conv ?? undefined,
          session_id: sess ?? undefined,
        })
        .catch(() => null)
        .then(bumpRail);
    },
  });

  useEffect(() => {
    void (async () => {
      if (threadId) {
        // Fresh mount/deep link: the store slot is empty, load it. Skip only
        // when this thread is already live/loaded (own-send navigation).
        const loaded = getState(threadId)?.turns.length;
        if (threadId !== curRef.current || !loaded) await loadThread(threadId);
        return;
      }
      storeReset(`new:${mode}`);
      setCur(null);
      curRef.current = null;
      setTitle("");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, threadId]);

  const newChat = () => {
    chat.reset();
    setCur(null);
    curRef.current = null;
    setTitle("");
    onNavigateThread(null);
  };
  const commitRename = () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || !cur || name === title) return;
    setTitle(name);
    void onemindThreadsApi.rename(cur, name).then(bumpRail);
  };
  const deleteCurrent = () => {
    if (!cur) return;
    void onemindThreadsApi.remove(cur).then(() => {
      bumpRail();
      newChat();
    });
  };
  const togglePin = () => {
    if (!cur) return;
    void onemindThreadsApi.get(cur).then((f) => {
      const next = !f.pinned;
      void onemindThreadsApi.patch(cur, { pinned: next }).then(() => {
        setPinned(next);
        bumpRail();
      });
    });
  };
  const onOpenDoc = (doc: SourceDoc) => dock.openOnemindDoc(doc);

  return (
    <div className={styles.embedRoot}>
      <header className={chatStyles.chatTitleBar}>
        <div className={chatStyles.chatTitleLeft}>
          {editing ? (
            <Input
              size="small"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPressEnter={commitRename}
              onBlur={commitRename}
              style={{ maxWidth: 260 }}
            />
          ) : (
            <button
              type="button"
              className={styles.titleBtn}
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
            >
              {title || t("onemind.chat.newChat")}
            </button>
          )}
        </div>
        <div className={chatStyles.chatTitleActions}>
          <Space size={4}>
            <Button
              size="small"
              type="text"
              icon={<Plus size={15} />}
              onClick={newChat}
              title={t("onemind.chat.newChat")}
            />
            <Button
              size="small"
              type="text"
              icon={<Pencil size={15} />}
              disabled={!cur}
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
              title={t("onemind.chat.rename")}
            />
            <Dropdown
              menu={{
                items: [
                  {
                    key: "collapse-thinking",
                    label: (
                      <Space size={8}>
                        <span>{t("onemind.chat.collapseThinking")}</span>
                        <Switch
                          size="small"
                          checked={collapseThinking}
                          onChange={(v) => setCollapseThinking(v)}
                        />
                      </Space>
                    ),
                  },
                  {
                    key: "pin",
                    icon: <Pin size={14} />,
                    label: pinned
                      ? t("onemind.chat.unpinSession")
                      : t("onemind.chat.pinSession"),
                    disabled: !cur,
                  },
                  {
                    key: "delete",
                    icon: <Trash2 size={14} />,
                    label: t("onemind.chat.delete"),
                    danger: true,
                    disabled: !cur,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "delete") deleteCurrent();
                  if (key === "pin") togglePin();
                },
              }}
            >
              <Button
                size="small"
                type="text"
                icon={<MoreVertical size={15} />}
              />
            </Dropdown>
          </Space>
        </div>
      </header>
      <div
        className={styles.body}
        style={{ flexDirection: dock.dockMode === "bottom" ? "column" : "row" }}
      >
        <div className={styles.mainCol}>
          <ChatPanel
            mode={mode}
            turns={chat.turns}
            streaming={chat.streaming}
            send={chat.send}
            stop={chat.stop}
            onOpenDoc={onOpenDoc}
            onNewChat={newChat}
          />
        </div>
        <ChatDockPanels
          isMobile={isMobile}
          dockOpen={dock.dockOpen}
          dockMode={dock.dockMode}
          isResizing={dock.isResizing}
          panelSizes={dock.panelSizes}
          agentId=""
          filePaths={[]}
          openTabs={dock.openTabs}
          activeTabId={dock.activeTabId}
          onSelectTab={dock.setActiveTab}
          onCloseTab={dock.closeTab}
          onOpenFile={dock.openFileAt}
          browserEnvironment="desktop"
          onModeChange={dock.handleModeChange}
          onClose={dock.handleClose}
          onResizeStart={dock.handleResizeStart}
        />
      </div>
    </div>
  );
}
