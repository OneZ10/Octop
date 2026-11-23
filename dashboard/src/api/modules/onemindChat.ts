import { getApiUrl } from "../config";
import { getAuthToken, request } from "../request";

export type ChatMode = "kbflow" | "chatbi";

/** MinerU-converted preview of a cited kbflow document (server-resolved). */
export interface OnemindDocPreview {
  doc_id: string;
  file_name: string;
  /** Absolute presigned URL; no Authorization header needed, expires ~1h. */
  file_url: string;
  /** Converted extension including the dot, e.g. ".pdf". */
  preview_file_extension: string;
  md_content?: string | null;
  /** Image file name -> absolute presigned URL (citation markdown images). */
  images?: Record<string, string>;
}

/** Resolve a citation doc_id to its converted original-file preview. */
export function getOnemindDocPreview(docId: string) {
  return request<OnemindDocPreview>(
    `/onemind/chat/kbflow/doc-preview/${encodeURIComponent(docId)}`,
  );
}

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
