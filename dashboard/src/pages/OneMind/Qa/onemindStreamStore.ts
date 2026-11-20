import {
  streamOnemindChat,
  type ChatMode,
} from "../../../api/modules/onemindChat";
import type { ChatMessage } from "../../Chat/hooks/sseHelpers";
import type {
  ChatResult,
  Citation,
  EChartOption,
  Turn,
  TurnExtras,
} from "./types";

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

export type PersistFn = (
  turn: Turn,
  threadId: string | null,
  conv: string | null,
  sess: string | null,
) => void;

export type StreamState = {
  key: string;
  mode: ChatMode;
  turns: Turn[];
  streaming: boolean;
  conv: string | null;
  sess: string | null;
  raw: string;
  finished: boolean;
  controller: AbortController | null;
  persist?: PersistFn;
  subs: Set<() => void>;
};

const states = new Map<string, StreamState>();

const ensure = (key: string, mode?: ChatMode): StreamState => {
  let s = states.get(key);
  if (!s) {
    s = {
      key,
      mode: mode ?? "kbflow",
      turns: [],
      streaming: false,
      conv: null,
      sess: null,
      raw: "",
      finished: true,
      controller: null,
      subs: new Set(),
    };
    states.set(key, s);
  }
  if (mode) s.mode = mode;
  return s;
};

const notify = (s: StreamState) => s.subs.forEach((f) => f());

export const getState = (key: string) => states.get(key);

export const subscribe = (key: string, fn: () => void) => {
  const s = ensure(key);
  s.subs.add(fn);
  return () => {
    s.subs.delete(fn);
  };
};

export const setPersist = (key: string, fn: PersistFn) => {
  ensure(key).persist = fn;
};

export const rekey = (oldKey: string, newKey: string) => {
  const s = states.get(oldKey);
  if (!s || states.has(newKey)) return;
  states.delete(oldKey);
  s.key = newKey;
  states.set(newKey, s);
};

export const hydrate = (
  key: string,
  turns: Turn[],
  conv?: string | null,
  sess?: string | null,
) => {
  const s = ensure(key);
  if (s.streaming) return; // never clobber a live stream
  s.turns = turns;
  s.conv = conv ?? null;
  s.sess = sess ?? null;
  s.raw = "";
  s.finished = true;
  notify(s);
};

export const reset = (key: string) => {
  const s = ensure(key);
  s.controller?.abort();
  s.controller = null;
  s.turns = [];
  s.streaming = false;
  s.conv = null;
  s.sess = null;
  s.raw = "";
  s.finished = true;
  notify(s);
};

const finish = (s: StreamState, turnId: string) => {
  if (s.finished) return;
  s.finished = true;
  s.streaming = false;
  s.controller = null;
  s.turns = s.turns.map((t) =>
    t.id === turnId
      ? {
          ...t,
          streaming: false,
          messages: t.messages.map((m) =>
            m.status === "streaming" ? { ...m, status: "done" } : m,
          ),
        }
      : t,
  );
  notify(s);
  const done = s.turns.find((t) => t.id === turnId);
  const tid = s.key.startsWith("new:") ? null : s.key;
  if (done) s.persist?.(done, tid, s.conv, s.sess);
};

export const stop = (key: string) => {
  const s = ensure(key);
  s.controller?.abort();
  const active = s.turns.find((t) => t.streaming);
  if (active) finish(s, active.id);
  else {
    s.streaming = false;
    notify(s);
  }
};

export const send = (
  key: string,
  mode: ChatMode,
  question: string,
  hooks?: { onUser?: (text: string) => Promise<string | void> | string | void },
) => {
  const q = question.trim();
  const s = ensure(key, mode);
  if (!q || s.streaming) return;
  void (async () => {
    // Create the persisted thread first (if new) so the stream is keyed by it.
    let activeKey = key;
    const created = await hooks?.onUser?.(q);
    if (typeof created === "string" && created && key.startsWith("new:")) {
      rekey(key, created);
      activeKey = created;
    }
    const st = ensure(activeKey, mode);
    const turnId = uid("turn");
    const answerId = uid("ans");
    st.raw = "";
    st.finished = false;
    const user: ChatMessage = {
      id: uid("u"),
      role: "user",
      content: q,
      timestamp: Date.now(),
    };
    const answer: ChatMessage = {
      id: answerId,
      role: "assistant",
      content: "",
      status: "streaming",
      timestamp: Date.now(),
    };
    st.turns = [
      ...st.turns,
      { id: turnId, user, messages: [answer], extras: {}, streaming: true },
    ];
    st.streaming = true;
    notify(st);
    const controller = new AbortController();
    st.controller = controller;
    const toolIds = new Map<string, string>();

    const patchTurn = (id: string, fn: (t: Turn) => Turn) => {
      st.turns = st.turns.map((t) => (t.id === id ? fn(t) : t));
      notify(st);
    };
    const setAnswer = (fn: (m: ChatMessage) => ChatMessage) =>
      patchTurn(turnId, (t) => ({
        ...t,
        messages: t.messages.map((m) => (m.id === answerId ? fn(m) : m)),
      }));
    const setExtras = (fn: (e: TurnExtras) => TurnExtras) =>
      patchTurn(turnId, (t) => ({ ...t, extras: fn(t.extras) }));
    const upsertTool = (
      callId: string,
      fn: (m: ChatMessage) => ChatMessage,
      create: () => ChatMessage,
    ) =>
      patchTurn(turnId, (t) => {
        const mid = toolIds.get(callId);
        if (mid && t.messages.some((m) => m.id === mid)) {
          return {
            ...t,
            messages: t.messages.map((m) => (m.id === mid ? fn(m) : m)),
          };
        }
        const nm = create();
        toolIds.set(callId, nm.id);
        const msgs = [...t.messages];
        const ai = msgs.findIndex((m) => m.id === answerId);
        msgs.splice(ai < 0 ? msgs.length : ai, 0, nm);
        return { ...t, messages: msgs };
      });

    await streamOnemindChat(
      mode,
      {
        question: q,
        conversation_id: st.conv ?? undefined,
        session_id: st.sess ?? undefined,
      },
      (evt) => {
        const type = evt.type;
        if (type === "delta") {
          const text = String(evt.text ?? "");
          if (mode === "chatbi") {
            st.raw += text;
            const raw = st.raw;
            const close = raw.indexOf("</think>");
            let think = "";
            let answerText = raw;
            if (close >= 0) {
              think = raw.slice(0, close).replace(/^<think>/, "");
              answerText = raw.slice(close + "</think>".length);
            } else if (raw.startsWith("<think>")) {
              think = raw.slice("<think>".length);
              answerText = "";
            }
            setAnswer((m) => ({
              ...m,
              content: answerText,
              contentBlocks: think
                ? [
                    { type: "thinking", content: think },
                    { type: "text", content: answerText },
                  ]
                : [{ type: "text", content: answerText }],
            }));
          } else {
            setAnswer((m) => ({ ...m, content: (m.content ?? "") + text }));
          }
        } else if (type === "progress") {
          const step = String(evt.step ?? "");
          const phase = String(evt.phase ?? "");
          const label = String(evt.label ?? "");
          const content = String(evt.content ?? "");
          if (step === "tool") {
            const callId = `${String(evt.tool ?? label)}-${turnId}`;
            upsertTool(
              callId,
              (m) => ({
                ...m,
                status: phase === "done" ? "done" : "streaming",
                toolData: {
                  ...m.toolData,
                  output: phase === "done" ? content : m.toolData?.output,
                },
              }),
              () => ({
                id: uid("tool"),
                role: "tool",
                content: "",
                status: "streaming",
                timestamp: Date.now(),
                toolData: {
                  name: String(evt.tool ?? ""),
                  displayName: label,
                  callId,
                },
              }),
            );
          } else {
            setAnswer((m) => {
              const blocks = m.contentBlocks ?? [];
              const tb = blocks.find((b) => b.type === "thinking");
              const line = `${label}${content ? ": " + content : ""}\n`;
              const think = (tb?.content ?? "") + line;
              const text =
                blocks.find((b) => b.type === "text")?.content ??
                m.content ??
                "";
              return {
                ...m,
                contentBlocks: [
                  { type: "thinking", content: think },
                  { type: "text", content: text },
                ],
              };
            });
          }
        } else if (type === "tool_start") {
          const callId = String(evt.callId ?? "");
          upsertTool(
            callId,
            (m) => m,
            () => ({
              id: uid("tool"),
              role: "tool",
              content: "",
              status: "streaming",
              timestamp: Date.now(),
              toolData: { name: String(evt.name ?? ""), callId },
            }),
          );
        } else if (type === "tool_args") {
          const callId = String(evt.callId ?? "");
          upsertTool(
            callId,
            (m) => ({
              ...m,
              toolData: {
                ...m.toolData,
                arguments: String(evt.arguments ?? ""),
              },
            }),
            () => ({
              id: uid("tool"),
              role: "tool",
              content: "",
              status: "streaming",
              timestamp: Date.now(),
              toolData: {
                name: "",
                callId,
                arguments: String(evt.arguments ?? ""),
              },
            }),
          );
        } else if (type === "tool_end") {
          const callId = String(evt.callId ?? "");
          upsertTool(
            callId,
            (m) => ({
              ...m,
              status: "done",
              toolData: { ...m.toolData, output: String(evt.output ?? "") },
            }),
            () => ({
              id: uid("tool"),
              role: "tool",
              content: "",
              status: "done",
              timestamp: Date.now(),
              toolData: {
                name: "",
                callId,
                output: String(evt.output ?? ""),
              },
            }),
          );
        } else if (type === "citations") {
          setExtras((e) => ({
            ...e,
            citations: (evt.chunks ?? []) as Citation[],
          }));
        } else if (type === "result") {
          setExtras((e) => ({
            ...e,
            result: {
              sql: (evt.sql ?? []) as string[],
              last_sql: evt.last_sql as string | undefined,
              df: (evt.df ?? []) as Record<string, unknown>[],
              row_count: evt.row_count as number | undefined,
              result_total_rows: evt.result_total_rows as number | undefined,
              result_truncated: evt.result_truncated as boolean | undefined,
            } as ChatResult,
          }));
        } else if (type === "chart") {
          setExtras((e) => ({
            ...e,
            chart: (evt.option ?? []) as EChartOption[],
          }));
        } else if (type === "followups") {
          setExtras((e) => ({
            ...e,
            followups: (evt.questions ?? []) as string[],
          }));
        } else if (type === "done") {
          if (evt.conversation_id) st.conv = String(evt.conversation_id);
          if (evt.session_id) st.sess = String(evt.session_id);
          finish(st, turnId);
        } else if (type === "error") {
          setAnswer((m) => ({
            ...m,
            status: "error",
            content:
              (m.content ?? "") +
              `\n\n${String(evt.message ?? evt.error ?? "error")}`,
          }));
          finish(st, turnId);
        }
      },
      controller.signal,
    ).catch(() => undefined);
    finish(st, turnId);
  })();
};
