import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatSidebarPanel from "./ChatSidebarPanel";
import type { OctopAgent } from "../../../context/AgentContext";

vi.mock("./SessionList", () => ({
  default: () => <div data-testid="session-list" />,
}));

// Capture the agent roster handed to the minimal nav so we can assert the
// write/check rail scope without pulling in its full (react-pdf) import graph.
vi.mock("./MinimalAgentSessionNav", () => ({
  default: (props: { agents: OctopAgent[] }) => (
    <div
      data-testid="minimal-nav"
      data-agents={props.agents.map((a) => a.agent_id).join(",")}
    />
  ),
}));

const agent = (id: string): OctopAgent =>
  ({ agent_id: id, name: id, state: "stopped", kind: "expert" }) as OctopAgent;

const AGENTS = ["qa-chat", "bi-chat", "write", "check", "main"].map(agent);

const baseProps = {
  isMobile: false,
  sidebarWidth: 248,
  agents: AGENTS,
  sessions: [],
  activeThreadId: null,
  sessionsHasMore: false,
  sessionsLoadingMore: false,
  onLoadMoreSessions: () => undefined,
  onFetchAllSessions: () => undefined,
  onSelectSession: () => undefined,
  onAgentSelect: () => undefined,
  onNewChatWithAgent: () => undefined,
  onDeleteSession: () => undefined,
  onRenameSession: () => undefined,
  onPinSession: () => undefined,
  onForkSession: () => undefined,
  onSidebarOpenChange: () => undefined,
  onSidebarResizeStart: () => undefined,
  navEmbedded: true,
};

const roster = () =>
  (screen.getByTestId("minimal-nav").getAttribute("data-agents") ?? "").split(
    ",",
  );

describe("ChatSidebarPanel write/check rail scope", () => {
  it("scopes to the route expert on /chat/write and /chat/check", () => {
    const { unmount } = render(
      <ChatSidebarPanel
        {...baseProps}
        resolvedAgentId="write"
        routeAgentId="write"
      />,
    );
    expect(roster()).toEqual(["write"]);
    unmount();
    render(
      <ChatSidebarPanel
        {...baseProps}
        resolvedAgentId="check"
        routeAgentId="check"
      />,
    );
    expect(roster()).toEqual(["check"]);
  });

  it("lists every expert on the plain history menu even after a write/check chat", () => {
    // resolvedAgentId stays the persisted active agent (check), but the route
    // is plain /chat (routeAgentId null) -> the rail must NOT stay scoped.
    render(
      <ChatSidebarPanel
        {...baseProps}
        resolvedAgentId="check"
        routeAgentId={null}
      />,
    );
    expect(roster()).toEqual(["qa-chat", "bi-chat", "write", "check", "main"]);
  });
});
