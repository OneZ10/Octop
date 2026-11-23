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
export function preserveChatOnHistoryNav(
  pathname: string,
  targetPath: string,
): boolean {
  if (targetPath !== "/chat") return false;
  if (!pathname.startsWith("/chat/")) return false;
  const onScopedMenu =
    pathname.startsWith("/chat/write") || pathname.startsWith("/chat/check");
  return !onScopedMenu;
}
