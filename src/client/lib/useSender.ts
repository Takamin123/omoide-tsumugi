// 語りを送る状態。送れなかったときは録音（または文字）と requestId を手元に残し、同じ操作で送り直せる。
import { useCallback, useEffect, useRef, useState } from "react";
import { sendText, sendVoice, type VoiceTarget } from "./voice";

export type SendState = "idle" | "sending" | "sent" | "failed";

type Payload = ({ kind: "voice"; blob: Blob } | { kind: "text"; text: string }) & { requestId: string };

/** 「おくりました」を出しておく時間 */
export const SENT_NOTICE_MS = 4_000;

export function useSender(target: VoiceTarget, onSent?: () => void) {
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState<unknown>(null);
  const pending = useRef<Payload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = useCallback(
    async (payload: Payload) => {
      pending.current = payload;
      clearTimeout(timer.current);
      setState("sending");
      try {
        if (payload.kind === "voice") await sendVoice(payload.blob, target, payload.requestId);
        else await sendText(payload.text, target, payload.requestId);
        pending.current = null;
        setState("sent");
        timer.current = setTimeout(() => setState((s) => (s === "sent" ? "idle" : s)), SENT_NOTICE_MS);
        onSent?.();
      } catch (e) {
        setError(e);
        setState("failed");
      }
    },
    [target.speakerMemberId, target.photoId, target.entranceId, target.replyToId, onSent],
  );

  return {
    state,
    /** 送れなかったときの例外（文にするのは errorText） */
    error,
    sendVoice: (blob: Blob) => void send({ kind: "voice", blob, requestId: crypto.randomUUID() }),
    sendText: (text: string) => void send({ kind: "text", text, requestId: crypto.randomUUID() }),
    pendingText: () => (pending.current?.kind === "text" ? pending.current.text : null),
    retry: () => {
      if (pending.current) void send(pending.current);
    },
    /** 送り直さずにやめる */
    discard: () => {
      pending.current = null;
      setState("idle");
    },
  };
}
