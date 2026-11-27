import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { octopThreadsApi } from "../../../api/modules/octopThreads";
import * as chatStore from "./chatStore";
import { EMPTY_CHAT_SESSION_KEY } from "../constants";
import { pickPreferredSession, toSession, type Session } from "./useSessions";
import { HISTORY_RAIL_STATE } from "../../../layouts/sidebarHistoryNav";

interface UseChatSessionActionsParams {
  resolvedAgentId: string | null | undefined;
  activeThreadId: string | null;
  sessions: Session[];
  isMobile: boolean;
  setActiveAgent: (id: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setSelectedModel: (model: string | null) => void;
  setHasBrowserTool: (value: boolean) => void;
  deleteSession: (id: string, compact: boolean) => Promise<boolean | null>;
  clearMessages: () => void;
  resetNavForAgentSwitch: () => void;
  markInitialNavDone: (agentId: string) => void;
  /**
   * True while the chat surface is on the 历史对话 menu. Navigations that
   * start from its rail then carry the rail flag, so scoped 智能编写 /
   * 智能审核 threads keep the history menu selected instead of flipping to
   * their own menus.
   */
  historyRail: boolean;
}

export function useChatSessionActions({
  resolvedAgentId,
  activeThreadId,
  sessions,
  isMobile,
  setActiveAgent,
  setSidebarOpen,
  setSelectedModel,
  setHasBrowserTool,
  deleteSession,
  clearMessages,
  resetNavForAgentSwitch,
  markInitialNavDone,
  historyRail,
}: UseChatSessionActionsParams) {
  const navigate = useNavigate();
  const navState = historyRail ? HISTORY_RAIL_STATE : null;

  const handleNewChat = useCallback(() => {
    setSelectedModel(null);
    setHasBrowserTool(false);
    const agent = resolvedAgentId;
    if (!agent) return;
    navigate(`/chat/${agent}`);
  }, [navigate, resolvedAgentId, setSelectedModel, setHasBrowserTool]);

  /**
   * New chat with an arbitrary expert. Unlike {@link navigateToAgent} this stays
   * on the empty-chat view instead of jumping to that expert's latest thread.
   */
  const handleNewChatWithAgent = useCallback(
    (agentId: string) => {
      if (!agentId) return;
      setSelectedModel(null);
      setHasBrowserTool(false);
      if (agentId !== resolvedAgentId) {
        resetNavForAgentSwitch();
        setActiveAgent(agentId);
      }
      markInitialNavDone(agentId);
      navigate(`/chat/${agentId}`, { state: navState });
      chatStore.clearMessages(EMPTY_CHAT_SESSION_KEY);
      if (isMobile) setSidebarOpen(false);
    },
    [
      navigate,
      navState,
      resolvedAgentId,
      isMobile,
      setActiveAgent,
      setSidebarOpen,
      setSelectedModel,
      setHasBrowserTool,
      resetNavForAgentSwitch,
      markInitialNavDone,
    ],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      const agent = resolvedAgentId;
      if (!agent) return;
      if (id === activeThreadId) return;
      setSelectedModel(null);
      void octopThreadsApi.rebind(agent, id).catch(() => {});
      navigate(`/chat/${agent}/${id}`, { state: navState });
      if (isMobile) setSidebarOpen(false);
    },
    [
      activeThreadId,
      navigate,
      navState,
      isMobile,
      resolvedAgentId,
      setSidebarOpen,
      setSelectedModel,
    ],
  );

  const navigateToAgent = useCallback(
    (agentId: string) => {
      if (!agentId) return;
      resetNavForAgentSwitch();
      navigate(`/chat/${agentId}`, { replace: true, state: navState });
      setActiveAgent(agentId);
      // We land on the new-chat view, so only that session is stale here.
      // Clearing the thread we are leaving would drop an in-flight turn.
      chatStore.clearMessages(EMPTY_CHAT_SESSION_KEY);
      if (isMobile) setSidebarOpen(false);

      void (async () => {
        try {
          const rows = await octopThreadsApi.list(agentId);
          const preferred = pickPreferredSession(rows.map(toSession));
          if (preferred) {
            markInitialNavDone(agentId);
            void octopThreadsApi.rebind(agentId, preferred.id).catch(() => {});
            navigate(`/chat/${agentId}/${preferred.id}`, {
              replace: true,
              state: navState,
            });
          } else {
            markInitialNavDone(agentId);
          }
        } catch {
          /* initialNav effect picks thread once sessions load */
        }
      })();
    },
    [
      setActiveAgent,
      navigate,
      navState,
      isMobile,
      setSidebarOpen,
      resetNavForAgentSwitch,
      markInitialNavDone,
    ],
  );

  const handleDeleteSession = useCallback(
    async (id: string, compact: boolean) => {
      const deleted = await deleteSession(id, compact);
      if (deleted !== true) return deleted;
      const agent = resolvedAgentId;
      if (id === activeThreadId && agent) {
        const remaining = sessions.filter((s) => s.id !== id);
        const preferred = pickPreferredSession(remaining);
        if (preferred) {
          navigate(`/chat/${agent}/${preferred.id}`, { replace: true });
        } else {
          navigate(`/chat/${agent}`, { replace: true });
          clearMessages();
        }
      }
      return true;
    },
    [
      activeThreadId,
      sessions,
      deleteSession,
      navigate,
      clearMessages,
      resolvedAgentId,
    ],
  );

  return {
    handleNewChat,
    handleNewChatWithAgent,
    handleSelectSession,
    navigateToAgent,
    handleDeleteSession,
  };
}
