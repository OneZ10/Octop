import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ChatMode } from "../../../api/modules/onemindChat";
import {
  getState,
  hydrate as storeHydrate,
  reset as storeReset,
  send as storeSend,
  setPersist,
  stop as storeStop,
  subscribe,
} from "./onemindStreamStore";
import type { Turn } from "./types";

/**
 * Subscribe a view to the module-level OneMind stream store so an in-flight
 * stream survives session switches (keeps streaming + persists to history) and
 * resumes rendering when the user returns to that session.
 */
export function useOnemindChat(
  mode: ChatMode,
  key: string,
  opts?: {
    onUser?: (text: string) => Promise<string | void> | string | void;
    onComplete?: (
      turn: Turn,
      threadId: string | null,
      conv: string | null,
      sess: string | null,
    ) => void;
  },
) {
  const [, force] = useReducer((c: number) => c + 1, 0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => subscribe(key, force), [key]);
  useEffect(() => {
    setPersist(
      key,
      (turn, tid, conv, sess) =>
        optsRef.current?.onComplete?.(turn, tid, conv, sess),
    );
  }, [key]);

  const s = getState(key);
  const turns = s?.turns ?? [];
  const streaming = s?.streaming ?? false;

  const send = useCallback(
    (question: string) =>
      storeSend(key, mode, question, {
        onUser: (text) => optsRef.current?.onUser?.(text),
      }),
    [key, mode],
  );
  const stop = useCallback(() => storeStop(key), [key]);
  const reset = useCallback(() => storeReset(key), [key]);
  const hydrate = useCallback(
    (ts: Turn[], conv?: string | null, sess?: string | null) =>
      storeHydrate(key, ts, conv, sess),
    [key],
  );

  return {
    turns,
    streaming,
    send,
    stop,
    reset,
    hydrate,
    getConv: () => getState(key)?.conv ?? null,
    getSess: () => getState(key)?.sess ?? null,
  };
}
