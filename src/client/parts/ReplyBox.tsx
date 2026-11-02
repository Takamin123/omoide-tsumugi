// 文字か声で送る。入り口への答えにも、語りへの返事にも使う
import { useState } from "react";
import type { VoiceTarget } from "../lib/voice";
import { errorText } from "../lib/errors";
import { useSender } from "../lib/useSender";
import { words } from "../words";
import { VoiceRecorder } from "./VoiceRecorder";

type Props = { target: VoiceTarget; onSent: () => void; onCancel?: () => void };

export function ReplyBox({ target, onSent, onCancel }: Props) {
  const [mode, setMode] = useState<"choose" | "text" | "voice">("choose");
  const [text, setText] = useState("");
  const [micError, setMicError] = useState(false);
  const sender = useSender(target, () => {
    setText("");
    onSent();
  });
  const w = words.home;
  const busy = sender.state === "sending";

  return (
    <div className="stack">
      {mode === "choose" && (
        <div className="row">
          <button type="button" onClick={() => setMode("text")}>
            {w.byText}
          </button>
          <button type="button" onClick={() => setMode("voice")}>
            {w.byVoice}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              {w.cancel}
            </button>
          )}
        </div>
      )}
      {mode === "text" && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            // 送れなかった文と同じなら、同じ requestId で送り直す（二重にしない）
            if (sender.state === "failed" && sender.pendingText() === t) sender.retry();
            else sender.sendText(t);
          }}
        >
          <textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} aria-label={w.byText} />
          <div className="row">
            <button type="submit" className="primary" disabled={busy || !text.trim()}>
              {w.send}
            </button>
            <button type="button" onClick={() => (onCancel ? onCancel() : setMode("choose"))}>
              {w.cancel}
            </button>
          </div>
        </form>
      )}
      {mode === "voice" &&
        (sender.state === "failed" ? (
          <>
            <button type="button" className="primary" onClick={sender.retry}>
              {words.elder.resend}
            </button>
            <button
              type="button"
              onClick={() => {
                sender.discard();
                if (onCancel) onCancel();
                else setMode("choose");
              }}
            >
              {w.cancel}
            </button>
          </>
        ) : (
          <>
            <VoiceRecorder
              variant="primary"
              startLabel={words.elder.speak}
              stopLabel={words.elder.stop}
              disabled={busy}
              onBlob={sender.sendVoice}
              onMicError={() => setMicError(true)}
              onStarted={() => setMicError(false)}
            />
            <button type="button" onClick={() => (onCancel ? onCancel() : setMode("choose"))}>
              {w.cancel}
            </button>
          </>
        ))}
      <div aria-live="polite">
        {sender.state === "sent" && <p className="sub">{words.elder.sent}</p>}
        {sender.state === "failed" && <p className="sub">{errorText(sender.error)}</p>}
        {micError && <p className="sub">{words.elder.micDenied}</p>}
      </div>
    </div>
  );
}
