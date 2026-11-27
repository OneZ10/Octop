/**
 * Decide whether clicking the 历史对话 menu (target ``/chat``) should keep the
 * current chat URL instead of navigating.
 *
 * While inside an open conversation (``/chat/<agent>/<thread>``) we preserve the
 * URL so the Chat surface is not remounted into a blank welcome screen. But the
 * 智能编写 / 智能审核 menus (``/chat/write``, ``/chat/check``) are scoped surfaces,
 * not an open conversation — clicking 历史对话 there must navigate to the unified
 * ``/chat`` history view.
 */
/** Location-state shape carrying the 历史对话 rail entry flag. */
export interface HistoryRailLocationState {
  historyRail?: boolean;
}

/** Navigation state that marks a chat route as entered from the 历史对话 rail. */
export const HISTORY_RAIL_STATE: HistoryRailLocationState = {
  historyRail: true,
};

/** True when the current history rail entry is a 历史对话 entry (not a scoped menu). */
export function isHistoryRailEntry(state: unknown): boolean {
  return Boolean((state as HistoryRailLocationState | null)?.historyRail);
}

export function preserveChatOnHistoryNav(
  pathname: string,
  targetPath: string,
  historyRail = false,
): boolean {
  if (targetPath !== "/chat") return false;
  if (!pathname.startsWith("/chat/")) return false;
  // A scoped thread opened from the 历史对话 rail is already on the history
  // menu; clicking it again must keep the open conversation.
  if (historyRail && pathname.split("/").length >= 4) return true;
  const onScopedMenu =
    pathname.startsWith("/chat/write") || pathname.startsWith("/chat/check");
  return !onScopedMenu;
}
