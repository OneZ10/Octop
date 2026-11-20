import type { ChatMessage } from "../../Chat/hooks/sseHelpers";
import type { OnemindStoredMessage } from "../../../api/modules/onemindThreads";
import type { ChatResult, Citation, EChartOption, Turn } from "./types";

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

/** Rebuild live turns from persisted messages so history renders identically. */
export function storedToTurns(messages: OnemindStoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: ChatMessage | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      pendingUser = {
        id: m.id || uid("u"),
        role: "user",
        content: m.text ?? "",
        timestamp: Date.parse(m.ts) || Date.now(),
      };
      continue;
    }
    const user =
      pendingUser ??
      ({
        id: uid("u"),
        role: "user",
        content: "",
        timestamp: Date.now(),
      } as ChatMessage);
    pendingUser = null;
    const blocks: { type: "text" | "thinking"; content: string }[] = [];
    if (m.thinking) blocks.push({ type: "thinking", content: m.thinking });
    blocks.push({ type: "text", content: m.text ?? "" });
    const answer: ChatMessage = {
      id: m.id || uid("ans"),
      role: "assistant",
      content: m.text ?? "",
      contentBlocks: blocks,
      status: m.error ? "error" : "done",
      timestamp: Date.parse(m.ts) || Date.now(),
    };
    const toolMsgs: ChatMessage[] = (m.tools ?? []).map((t, i) => ({
      id: uid("tool"),
      role: "tool",
      content: "",
      status: "done",
      timestamp: Date.now(),
      toolData: {
        name: t.name ?? "",
        callId: `${m.id}-tool-${i}`,
        arguments: t.arguments,
        output: t.output,
      },
    }));
    turns.push({
      id: uid("turn"),
      user,
      messages: [...toolMsgs, answer],
      extras: {
        citations: (m.citations ?? []) as Citation[],
        result: (m.result ?? undefined) as ChatResult | undefined,
        chart: (m.chart ?? undefined) as EChartOption[] | undefined,
        followups: m.followups ?? [],
      },
      streaming: false,
    });
  }
  return turns;
}

/** Serialize a finished turn's assistant side for persistence. */
export function turnToStored(turn: Turn): Partial<OnemindStoredMessage> {
  const answer = turn.messages.find((m) => m.role === "assistant");
  const thinking = answer?.contentBlocks?.find((b) => b.type === "thinking")
    ?.content;
  const tools = turn.messages
    .filter((m) => m.role === "tool")
    .map((m) => ({
      name: m.toolData?.name,
      arguments: m.toolData?.arguments,
      output: m.toolData?.output,
    }));
  return {
    role: "assistant",
    text: answer?.content ?? "",
    thinking: thinking || undefined,
    tools: tools.length ? tools : undefined,
    citations: turn.extras.citations,
    result: turn.extras.result,
    chart: turn.extras.chart,
    followups: turn.extras.followups,
    error: answer?.status === "error" ? answer.content : undefined,
  };
}
