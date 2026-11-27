import { describe, expect, it } from "vitest";
import { preserveChatOnHistoryNav } from "./sidebarHistoryNav";

describe("preserveChatOnHistoryNav", () => {
  it("keeps the URL when clicking 历史对话 inside an open conversation", () => {
    expect(preserveChatOnHistoryNav("/chat/qa-chat/thr-1", "/chat")).toBe(true);
    expect(preserveChatOnHistoryNav("/chat/main/thr-1", "/chat")).toBe(true);
    expect(preserveChatOnHistoryNav("/chat/bi-chat", "/chat")).toBe(true);
  });

  it("navigates to /chat from the scoped 智能编写 / 智能审核 menus", () => {
    expect(preserveChatOnHistoryNav("/chat/write", "/chat")).toBe(false);
    expect(preserveChatOnHistoryNav("/chat/write/thr-1", "/chat")).toBe(false);
    expect(preserveChatOnHistoryNav("/chat/check", "/chat")).toBe(false);
    expect(preserveChatOnHistoryNav("/chat/check/thr-1", "/chat")).toBe(false);
  });

  it("keeps the URL for scoped threads that were opened from history", () => {
    // The history flag marks a 智能编写 / 智能审核 thread reached through the
    // history rail: the 历史对话 menu is already selected, so clicking it again
    // must not drop the open conversation.
    expect(preserveChatOnHistoryNav("/chat/write/thr-1", "/chat", true)).toBe(
      true,
    );
    expect(preserveChatOnHistoryNav("/chat/check/thr-1", "/chat", true)).toBe(
      true,
    );
  });

  it("still navigates to /chat from a bare scoped surface", () => {
    expect(preserveChatOnHistoryNav("/chat/write", "/chat", true)).toBe(false);
    expect(preserveChatOnHistoryNav("/chat/check", "/chat", true)).toBe(false);
  });

  it("does not preserve outside /chat/<agent> paths or for other targets", () => {
    expect(preserveChatOnHistoryNav("/chat", "/chat")).toBe(false);
    expect(preserveChatOnHistoryNav("/experts", "/chat")).toBe(false);
    expect(preserveChatOnHistoryNav("/chat/write", "/experts")).toBe(false);
  });
});
