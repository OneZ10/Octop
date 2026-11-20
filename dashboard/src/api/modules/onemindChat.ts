import { getApiUrl } from "../config";
import { getAuthToken } from "../request";

export type ChatMode = "kbflow" | "chatbi";

export interface ChatStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface ChatRequestBody {
  question: string;
  conversation_id?: string;
  session_id?: string;
}

/**
 * Stream a direct-connect OneMind chat turn from the Octop SSE proxy.
 * Credentials stay server-side; the browser only carries the Octop JWT.
 */
export async function streamOnemindChat(
  mode: ChatMode,
  body: ChatRequestBody,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(getApiUrl(`/onemind/chat/${mode}/stream`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok || !resp.body) {
    onEvent({ type: "error", message: `HTTP ${resp.status}` });
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          onEvent(JSON.parse(payload) as ChatStreamEvent);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}
