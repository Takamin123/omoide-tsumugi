// 語りを送る状態。送れなかったときは録音（または文字）と requestId を手元に残し、同じ操作で送り直せる。
import { useCallback, useEffect, useRef, useState } from "react";
import { audioDurationMs, sendText, sendVoice, type VoiceTarget } from "./voice";

export type SendState = "idle" | "sending" | "sent" | "failed";

type Payload = ({ kind: "voice"; blob: Blob; durationMs: number | null } | { kind: "text"; text: string }) & { requestId: string };

/** 「おくりました」を出しておく時間 */
export const SENT_NOTICE_MS = 4_000;

/** 送れた語り。at は送れたと分かった手元の時刻（「とりなおす」を出す時間を数える。0050） */
export type SentNarration = { id: string; kind: "voice" | "text"; at: number };

/** 送る状態と操作（今日の答えは Home が持ち、ReplyBox とデモの帯で共有する） */
export type Sender = ReturnType<typeof useSender>;

export function useSender(target: VoiceTarget, onSent?: (sent: SentNarration) => void) {
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState<unknown>(null);
  const [last, setLast] = useState<SentNarration | null>(null);
  const pending = useRef<Payload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = useCallback(
    async (payload: Payload) => {
      pending.current = payload;
      clearTimeout(timer.current);
      setState("sending");
      try {
        const narration =
          payload.kind === "voice"
            ? await sendVoice(payload.blob, target, payload.requestId, payload.durationMs)
            : await sendText(payload.text, target, payload.requestId);
        pending.current = null;
        const sent: SentNarration = { id: narration.id, kind: payload.kind, at: Date.now() };
        setLast(sent);
        setState("sent");
        timer.current = setTimeout(() => setState((s) => (s === "sent" ? "idle" : s)), SENT_NOTICE_MS);
        onSent?.(sent);
      } catch (e) {
        setError(e);
        setState("failed");
      }
    },
    [target.photoId, target.entranceId, target.replyToId, onSent],
  );

  return {
    state,
    /** 送れなかったときの例外（文にするのは errorText） */
    error,
    /** 最後に送れた語り（「とりなおす」で消す先。0050） */
    last,
    /**
     * 声を送る。durationMs はマイクで測った長さ。録音済みファイル（省いたとき）はブラウザに読ませて測る。
     * 測る間も「送っている」にして、二度押しで二つ送らないようにする
     */
    sendVoice: (blob: Blob, durationMs?: number | null) => {
      const requestId = crypto.randomUUID();
      if (durationMs !== undefined) return void send({ kind: "voice", blob, durationMs, requestId });
      setState("sending");
      void audioDurationMs(blob).then((ms) => send({ kind: "voice", blob, durationMs: ms, requestId }));
    },
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
