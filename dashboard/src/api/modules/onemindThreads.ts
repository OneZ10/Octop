import { request } from "../request";
import type { ChatMode } from "./onemindChat";

/** Persisted OneMind direct-chat thread metadata (no messages). */
export type OnemindThreadMeta = {
  id: string;
  mode: ChatMode;
  title: string;
  created_at: string;
  last_active: string;
  message_count: number;
  pinned?: boolean;
};

/** A persisted rich message; mirrors the live-stream turn artifacts. */
export type OnemindStoredMessage = {
  id: string;
  role: "user" | "assistant";
  ts: string;
  text?: string;
  thinking?: string;
  tools?: { name?: string; arguments?: string; output?: string }[];
  citations?: unknown[];
  result?: unknown;
  chart?: unknown;
  followups?: string[];
  error?: string;
  conversation_id?: string;
  session_id?: string;
};

export type OnemindThreadFull = OnemindThreadMeta & {
  messages: OnemindStoredMessage[];
};

const JSON_HEADERS = { "Content-Type": "application/json" };

export const onemindThreadsApi = {
  list: (mode?: ChatMode) =>
    request<{ threads: OnemindThreadMeta[] }>(
      `/onemind/threads${mode ? `?mode=${mode}` : ""}`,
    ),
  create: (mode: ChatMode, title?: string) =>
    request<OnemindThreadMeta>("/onemind/threads", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ mode, title }),
    }),
  get: (id: string) => request<OnemindThreadFull>(`/onemind/threads/${id}`),
  append: (id: string, message: Partial<OnemindStoredMessage>) =>
    request<{ ok: boolean; message_count: number; title: string }>(
      `/onemind/threads/${id}/messages`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ message }),
      },
    ),
  rename: (id: string, title: string) =>
    request<OnemindThreadMeta>(`/onemind/threads/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title }),
    }),
  patch: (id: string, body: { title?: string; pinned?: boolean }) =>
    request<OnemindThreadMeta>(`/onemind/threads/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/onemind/threads/${id}`, { method: "DELETE" }),
};
