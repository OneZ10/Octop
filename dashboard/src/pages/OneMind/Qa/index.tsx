import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Dropdown, Input, Space, Switch } from "antd";
import {
  Database,
  MessagesSquare,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  connectorsApi,
  type ConnectorInstance,
} from "../../../api/modules/connectors";
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
import { PillSegmented } from "./ui";

const bumpRail = () =>
  window.dispatchEvent(new Event("onemind-threads-changed"));

/**
 * OneMind 智能问答: direct-connect rich chat over kbflow / chatbi using the
 * Octop native conversation chrome (title bar / column width / turn renderer /
 * welcome screen / composer). Conversation history lives in the left expert
 * rail (OneMindExpertNav), not a second in-page column.
 */
export default function OneMindQaPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<ChatMode>(
    params.get("mode") === "chatbi" ? "chatbi" : "kbflow",
  );
  const [threadId, setThreadId] = useState<string | null>(params.get("thread"));
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState(false);
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);
  const dock = useChatDockPanel(isMobile, null);
  const [collapseThinking, setCollapseThinking] = useCollapseThinking(false);
  const threadIdRef = useRef<string | null>(threadId);
  threadIdRef.current = threadId;
  const loadSeqRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const paramThread = params.get("thread");
  const paramNew = params.get("new");

  const refreshList = useCallback(async (m: ChatMode) => {
    const res = await onemindThreadsApi.list(m).catch(() => ({ threads: [] }));
    return res.threads;
  }, []);

  const loadThread = useCallback(async (id: string) => {
    // Guard against out-of-order loads: an initial auto-load must not
    // overwrite a thread the user clicked while the first fetch was in flight.
    const seq = ++loadSeqRef.current;
    const full = await onemindThreadsApi.get(id).catch(() => null);
    if (seq !== loadSeqRef.current) return;
    if (!full) return;
    if (getState(id)?.streaming) {
      // Live stream for this thread: show it, do not clobber with stored.
      setThreadId(id);
      setTitle(full.title);
      setPinned(Boolean(full.pinned));
      return;
    }
    const last = [...full.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    // Hydrate the TARGET thread's store slot directly: the hook-bound
    // chat.hydrate would write into the key captured at mount, leaving the
    // newly selected thread empty when switching inside the page.
    storeHydrate(
      id,
      storedToTurns(full.messages),
      last?.conversation_id ?? null,
      last?.session_id ?? null,
    );
    setThreadId(id);
    setTitle(full.title);
    setPinned(Boolean(full.pinned));
  }, []);

  const chat = useOnemindChat(mode, threadId ?? `new:${mode}`, {
    onUser: async (text) => {
      let id = threadIdRef.current;
      if (!id) {
        const created = await onemindThreadsApi
          .create(modeRef.current)
          .catch(() => null);
        if (!created) return;
        id = created.id;
        setThreadId(id);
        threadIdRef.current = id;
        setParams({ mode: modeRef.current, thread: id }, { replace: true });
      }
      await onemindThreadsApi
        .append(id, { role: "user", text })
        .catch(() => null);
      bumpRail();
      return id;
    },
    onComplete: (turn, tid, conv, sess) => {
      const id = tid ?? threadIdRef.current;
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

  // React to mode / selected-thread / new-chat navigation from the expert rail
  // and the top mode switch.
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (paramNew === "1") {
        storeReset(`new:${mode}`);
        setThreadId(null);
        setTitle("");
        return;
      }
      if (paramThread) {
        // Skip reload when the param change was caused by our own send
        // (onUser sets ?thread=<new id>): hydrating mid-stream would wipe
        // the in-flight assistant turn and drop all subsequent deltas.
        // On a fresh mount/deep link the store slot is still empty, so load.
        const loaded = getState(paramThread)?.turns.length;
        if (paramThread !== threadIdRef.current || !loaded) {
          await loadThread(paramThread);
        }
        return;
      }
      const list = await refreshList(mode);
      if (!alive) return;
      if (list[0]) await loadThread(list[0].id);
      else {
        storeReset(`new:${mode}`);
        setThreadId(null);
        setTitle("");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paramThread, paramNew]);

  useEffect(() => {
    connectorsApi
      .listInstances()
      .then(setInstances)
      .catch(() => setInstances([]));
  }, []);

  const kind = mode === "kbflow" ? "onemind-kbflow" : "onemind-chatbi";
  const configured = instances.some(
    (i) => i.kind === kind && i.has_credentials,
  );

  const switchMode = (m: ChatMode) => {
    setMode(m);
    setParams({ mode: m }, { replace: true });
  };
  const newChat = () => {
    chat.reset();
    setThreadId(null);
    setTitle("");
    setParams({ mode, new: "1" }, { replace: true });
  };
  const commitRename = () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || !threadId || name === title) return;
    setTitle(name);
    void onemindThreadsApi.rename(threadId, name);
  };
  const deleteCurrent = () => {
    if (!threadId) return;
    void onemindThreadsApi.remove(threadId).then(async () => {
      const list = await refreshList(mode);
      if (list[0]) {
        setParams({ mode, thread: list[0].id }, { replace: true });
      } else newChat();
    });
  };

  const onOpenDoc = (doc: SourceDoc) => dock.openOnemindDoc(doc);

  return (
    <div className={`${chatStyles.chatPage} ${styles.qaPage}`}>
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
        <PillSegmented
          size="md"
          ariaLabel={t("onemind.qaTitle")}
          value={mode}
          onChange={switchMode}
          options={[
            {
              label: t("onemind.kbflowTitle"),
              value: "kbflow",
              icon: <MessagesSquare size={15} />,
            },
            {
              label: t("onemind.chatbiTitle"),
              value: "chatbi",
              icon: <Database size={15} />,
            },
          ]}
        />
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
              disabled={!threadId}
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
                    disabled: !threadId,
                  },
                  {
                    key: "delete",
                    icon: <Trash2 size={14} />,
                    label: t("onemind.chat.delete"),
                    danger: true,
                    disabled: !threadId,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "delete") deleteCurrent();
                  if (key === "pin" && threadId) {
                    void onemindThreadsApi.get(threadId).then((f) => {
                      const next = !f.pinned;
                      void onemindThreadsApi
                        .patch(threadId, { pinned: next })
                        .then(() => setPinned(next));
                    });
                  }
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
      {!configured ? (
        <Alert
          type="warning"
          showIcon
          message={t("onemind.notConfigured")}
          action={
            <Button size="small" onClick={() => navigate("/connectors")}>
              {t("onemind.setupConnector")}
            </Button>
          }
          style={{ margin: "0 16px 8px" }}
        />
      ) : null}
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
