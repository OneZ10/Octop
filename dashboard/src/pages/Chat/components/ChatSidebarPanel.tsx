import { useCallback, useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import cx from "classnames";
import SessionList from "./SessionList";
import MinimalAgentSessionNav from "./MinimalAgentSessionNav";
import { onemindThreadsApi } from "../../../api/modules/onemindThreads";
import { sortSessions, type Session } from "../hooks/useSessions";
import type { OctopAgent } from "../../../context/AgentContext";
import RailEdgeControl from "../../../components/RailEdgeControl";
import { EXPAND_CHAT_RAIL_EVENT } from "../chatRailEvents";
import {
  isMacPlatform,
  railShortcutAria,
  railShortcutLabel,
} from "../../../utils/railShortcuts";
import styles from "../index.module.less";

interface ChatSidebarPanelProps {
  isMobile: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  isSidebarResizing?: boolean;
  sidebarElRef?: RefObject<HTMLDivElement>;
  agents: OctopAgent[];
  /** Owned experts that cannot chat yet 鈥?see ``SessionList.unreadyExperts``. */
  unreadyExperts?: number;
  sessions: Session[];
  activeThreadId: string | null;
  resolvedAgentId: string | null | undefined;
  /**
   * Agent id taken from the URL path (/chat/<agentId>), before falling back to
   * the persisted active agent. The write/check rail scope must follow the
   * route, not the stale active agent, so the plain 历史对话 (/chat) menu lists
   * every expert even right after leaving a write/check chat.
   */
  routeAgentId?: string | null;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
  onLoadMoreSessions: () => void;
  onFetchAllSessions: () => void;
  onSelectSession: (sessionId: string, agentId: string) => void;
  onAgentSelect: (agentId: string) => void;
  /** Start a fresh chat from an expert row (classic + minimal). */
  onNewChatWithAgent: (agentId: string) => void;
  onDeleteSession: (
    id: string,
    compact: boolean,
  ) => void | Promise<boolean | null | void>;
  onRenameSession: (id: string, name: string) => void;
  onPinSession: (id: string, pinned: boolean) => void;
  onForkSession: (id: string, agentId?: string | null) => void;
  forkDisabled?: boolean;
  forkDisabledHint?: string;
  onSidebarOpenChange: (open: boolean) => void;
  onSidebarResizeStart: (e: React.PointerEvent) => void;
  /** Mounted in MainLayout left rail (between app nav and content). */
  layoutRail?: boolean;
  /**
   * Minimal layout: render SessionList only inside the nav "records" pane
   * (no second rail chrome / mobile overlay).
   */
  navEmbedded?: boolean;
}

export default function ChatSidebarPanel({
  isMobile,
  sidebarOpen,
  sidebarWidth,
  isSidebarResizing = false,
  sidebarElRef,
  agents,
  unreadyExperts,
  sessions,
  activeThreadId,
  resolvedAgentId,
  routeAgentId = null,
  sessionsHasMore,
  sessionsLoadingMore,
  onLoadMoreSessions,
  onFetchAllSessions,
  onSelectSession,
  onAgentSelect,
  onNewChatWithAgent,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  onForkSession,
  forkDisabled,
  forkDisabledHint,
  onSidebarOpenChange,
  onSidebarResizeStart,
  layoutRail = false,
  navEmbedded = false,
}: ChatSidebarPanelProps) {
  const { t } = useTranslation();

  const handleRailToggle = useCallback(() => {
    if (sidebarOpen) {
      onSidebarOpenChange(false);
      return;
    }
    // MainLayout may also expand the nav when both rails were collapsed.
    window.dispatchEvent(new Event(EXPAND_CHAT_RAIL_EVENT));
    onSidebarOpenChange(true);
  }, [onSidebarOpenChange, sidebarOpen]);

  const historyLabel = t(
    sidebarOpen ? "chat.collapseHistorySidebar" : "chat.expandHistorySidebar",
    sidebarOpen ? "鏀惰捣瀵硅瘽鍘嗗彶" : "灞曞紑瀵硅瘽鍘嗗彶",
  );
  const historyHint = `${historyLabel} (${railShortcutLabel(
    "toggle-history",
    isMacPlatform(),
  )})`;

  // One unified expert menu: OneMind qa/bi first, then write/check, then rest.
  const unifiedHistoryAgents = [...agents].sort((a, b) => {
    const prio = ["qa-chat", "bi-chat", "write", "check"];
    const ia = prio.indexOf(a.agent_id);
    const ib = prio.indexOf(b.agent_id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // C10: the write/check menus scope the rail to their own expert only. Scope
  // by the URL agent (routeAgentId), not the persisted active agent, so the
  // plain 历史对话 (/chat) menu still lists every expert after a write/check
  // chat instead of collapsing to the last-active one.
  const scopedHistoryAgents =
    routeAgentId === "write" || routeAgentId === "check"
      ? unifiedHistoryAgents.filter((a) => a.agent_id === routeAgentId)
      : unifiedHistoryAgents;
  const [onemindRefresh, setOnemindRefresh] = useState(0);
  useEffect(() => {
    const bump = () => setOnemindRefresh((k) => k + 1);
    window.addEventListener("onemind-threads-changed", bump);
    return () => window.removeEventListener("onemind-threads-changed", bump);
  }, []);
  const previewLoader = useCallback(async (agentId: string, limit: number) => {
    const mode =
      agentId === "qa-chat"
        ? "kbflow"
        : agentId === "bi-chat"
        ? "chatbi"
        : null;
    if (!mode) return null;
    const res = await onemindThreadsApi
      .list(mode)
      .catch(() => ({ threads: [] }));
    const sessions: Session[] = res.threads.map((t) => ({
      id: t.id,
      name: t.title,
      threadId: t.id,
      updatedAt: t.last_active,
      channelType: "onemind",
      pinned: t.pinned,
      owned: true,
    }));
    const sorted = sortSessions(sessions);
    return { sessions: sorted.slice(0, limit), hasMore: sorted.length > limit };
  }, []);

  const sessionList = navEmbedded ? (
    <MinimalAgentSessionNav
      preserveOrder
      allowStoppedPreview
      agents={scopedHistoryAgents}
      previewLoader={previewLoader}
      refreshKey={onemindRefresh}
      activeId={activeThreadId}
      activeAgentId={resolvedAgentId ?? null}
      activeSessions={sessions}
      onSelect={onSelectSession}
      onAgentSelect={onAgentSelect}
      onNewChat={onNewChatWithAgent}
      onDeleteActive={onDeleteSession}
      onRenameActive={onRenameSession}
      onPinActive={onPinSession}
      onFork={onForkSession}
      activeForkDisabled={forkDisabled}
      activeForkDisabledHint={forkDisabledHint}
    />
  ) : (
    <SessionList
      agents={agents}
      unreadyExperts={unreadyExperts}
      sessions={sessions}
      activeId={activeThreadId}
      activeAgentId={resolvedAgentId ?? null}
      hasMore={sessionsHasMore}
      loadingMore={sessionsLoadingMore}
      onLoadMore={onLoadMoreSessions}
      onFetchAllSessions={onFetchAllSessions}
      onSelect={onSelectSession}
      onAgentSelect={onAgentSelect}
      onNewChat={onNewChatWithAgent}
      onDelete={onDeleteSession}
      onRename={onRenameSession}
      onPin={onPinSession}
      onFork={onForkSession}
      activeForkDisabled={forkDisabled}
      activeForkDisabledHint={forkDisabledHint}
    />
  );

  if (navEmbedded) {
    return (
      <div className={styles.sidebarNavEmbedded} data-testid="chat-nav-records">
        {sessionList}
      </div>
    );
  }

  return (
    <div
      className={cx(
        styles.sidebarWrapper,
        layoutRail && styles.sidebarWrapperLayoutRail,
        !isMobile && !sidebarOpen && styles.sidebarWrapperCollapsed,
      )}
    >
      {isMobile && sidebarOpen && (
        <div
          className={styles.overlay}
          onClick={() => onSidebarOpenChange(false)}
        />
      )}

      <div
        ref={sidebarElRef}
        className={cx(
          styles.sidebar,
          sidebarOpen && styles.sidebarOpen,
          isSidebarResizing && styles.sidebarResizing,
        )}
        style={
          !isMobile && sidebarOpen
            ? { width: sidebarWidth, minWidth: sidebarWidth }
            : undefined
        }
      >
        {sessionList}
      </div>

      {!isMobile && sidebarOpen && (
        <RailEdgeControl
          expanded
          onToggle={handleRailToggle}
          side="end"
          showLine
          placement="center"
          className={styles.chatRailEdgeOpen}
          label={historyLabel}
          hint={historyHint}
          shortcut={railShortcutAria("toggle-history")}
          onResizeStart={onSidebarResizeStart}
          resizeLabel={t("chat.resizeSidebar", "璋冩暣渚ф爮瀹藉害")}
        />
      )}
    </div>
  );
}
