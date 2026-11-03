// 文字か声で送る。入り口への答えにも、語りへの返事にも使う。
// 文字・声の形が開いている間は、家族の画面に「入力中」を知らせる（下のタブを隠す）。
// 送ったら入力欄を閉じる。入り口への答えはこの中で「送りました」を出し、返事は呼ぶ側（onSent）が閉じて出す。
import { useState } from "react";
import type { VoiceTarget } from "../lib/voice";
import { useComposing } from "../lib/composing";
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
    setMode("choose");
    onSent();
  });
  // 入力欄・録音が開いている間は、家族の画面の下のタブを描かない
  useComposing(mode !== "choose");
  const w = words.home;
  const busy = sender.state === "sending";
  const close = () => {
    setMicError(false);
    if (onCancel) onCancel();
    else setMode("choose");
  };

  return (
    <div className={onCancel ? "stack reply-box" : "stack answer"}>
      {mode === "choose" && (
        <>
          <div className="grid2">
            <button type="button" onClick={() => setMode("voice")}>
              {w.byVoice}
            </button>
            <button type="button" onClick={() => setMode("text")}>
              {w.byText}
            </button>
          </div>
          {onCancel && (
            <button type="button" className="aux" onClick={onCancel}>
              {w.cancel}
            </button>
          )}
        </>
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
          <textarea value={text} maxLength={2000} rows={4} onChange={(e) => setText(e.target.value)} aria-label={w.byText} />
          <div className="grid2">
            <button type="button" onClick={close}>
              {w.cancel}
            </button>
            <button type="submit" className="primary" disabled={busy || !text.trim()}>
              {w.send}
            </button>
          </div>
        </form>
      )}
      {mode === "voice" &&
        (sender.state === "failed" ? (
          <div className="grid2">
            <button
              type="button"
              onClick={() => {
                sender.discard();
                close();
              }}
            >
              {w.cancel}
            </button>
            <button type="button" className="primary" onClick={sender.retry}>
              {w.send}
            </button>
          </div>
        ) : (
          <>
            <VoiceRecorder
              startLabel={w.speak}
              stopLabel={w.stop}
              disabled={busy}
              onBlob={sender.sendVoice}
              onMicError={() => setMicError(true)}
              onStarted={() => setMicError(false)}
            />
            <button type="button" className="aux" onClick={close}>
              {w.cancel}
            </button>
          </>
        ))}
      <div aria-live="polite">
        {/* 返事（onCancel あり）は、閉じた後に呼ぶ側が「送りました」を出す */}
        {!onCancel && sender.state === "sent" && mode === "choose" && <p className="done">{w.sent}</p>}
        {sender.state === "failed" && <p className="sub">{errorText(sender.error)}</p>}
        {micError && <p className="sub">{w.micDenied}</p>}
      </div>
    </div>
  );
}
