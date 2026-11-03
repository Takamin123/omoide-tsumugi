// 文字か声で送る。入り口への答えにも、語りへの返事にも使う。家族の画面と祖父母の画面で同じ部品（言葉と大きさだけが違う。0043）。
// 家族の画面: 「声で話す」「文字で書く」を選び、声なら「話す」→「終わる」、文字なら欄と「送る」。
// 祖父母の画面: 「はなす」「かく」。「はなす」を押すとその場で録り始め、「おわる」で送る（二度押しのまま。0008）。
// 文字・声の形が開いている間は、画面に「入力中」を知らせる（下のタブを隠す）。
// 送ったら入力欄を閉じる。「送りました」は呼ぶ側が出す（今日の答えは Home、返事は Narrations）。
import { useEffect, useState } from "react";
import type { VoiceTarget } from "../lib/voice";
import { useComposing } from "../lib/composing";
import { errorText } from "../lib/errors";
import { useScreen, useSentNotice } from "../lib/screen";
import { useSender, type Sender } from "../lib/useSender";
import { RecordingTime, useRecorder } from "./VoiceRecorder";

type Props = {
  target: VoiceTarget;
  /** 送る状態を呼ぶ側が持つとき（今日の答え。デモの帯の録音済みファイルと共有する）。送った後の知らせは、その sender の onSent が受ける */
  sender?: Sender;
  /** 自分で送る状態を持つとき、送った後に呼ぶ */
  onSent?: () => void;
  onCancel?: () => void;
  /** 文字の欄・録音を開いた・閉じたを知らせる（今日の入り口の段が、自分の入力の間は残るため。0034） */
  onComposing?: (on: boolean) => void;
  /** 祖父母の画面の今日の答えで、ボタンのすぐ上に出す今の話者の呼ばれ方（0008） */
  who?: string;
};

export function ReplyBox({ target, sender: external, onSent, onCancel, onComposing, who }: Props) {
  const { elder, w } = useScreen();
  const notice = useSentNotice();
  const [mode, setMode] = useState<"choose" | "text" | "voice">("choose");
  const [text, setText] = useState("");
  const [micError, setMicError] = useState(false);
  const own = useSender(target, onSent);
  const sender = external ?? own;
  const rec = useRecorder({
    onBlob: sender.sendVoice,
    onStarted: () => setMicError(false),
    onMicError: () => setMicError(true),
  });
  // 送ったら欄を閉じる
  useEffect(() => {
    if (sender.state === "sent") {
      setText("");
      setMode("choose");
    }
  }, [sender.state]);
  const busy = sender.state === "sending";
  const failed = sender.state === "failed";
  // 入力欄・録音が開いている間（祖父母の画面では、録っている間と、送れなかった声を持っている間）は、下のタブを描かない
  const open = mode !== "choose" || rec.recording || (elder && failed);
  useComposing(open);
  useEffect(() => {
    onComposing?.(open);
    return () => onComposing?.(false);
  }, [open, onComposing]);

  const close = () => {
    setMicError(false);
    rec.cancel();
    // 送れなかったものを持ったまま閉じない（後で「送る」を押して、閉じた欄の中身が送られないように）
    if (failed) sender.discard();
    if (onCancel) onCancel();
    else setMode("choose");
  };
  const failure = failed && <p role="alert" className={elder ? undefined : "sub"}>{w.sendFailed ?? errorText(sender.error)}</p>;
  const mic = micError && <p role="alert" className={elder ? undefined : "sub"}>{w.micDenied}</p>;
  const cancelAux = onCancel && (
    <button type="button" className="aux" onClick={close}>
      {w.cancel}
    </button>
  );

  const textForm = (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        // 送れなかった文と同じなら、同じ requestId で送り直す（二重にしない）
        if (failed && sender.pendingText() === t) sender.retry();
        else sender.sendText(t);
      }}
    >
      <textarea value={text} maxLength={2000} rows={4} onChange={(e) => setText(e.target.value)} aria-label={w.textLabel} />
      {/* 祖父母の画面は、声のときと同じく文を先に、ボタンを後に（文が「おくる」を指す） */}
      {elder && failure}
      <div className="grid2">
        <button type="button" onClick={close}>
          {w.cancel}
        </button>
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          {w.send}
        </button>
      </div>
      {!elder && failure}
    </form>
  );

  let body;
  if (mode === "text") {
    body = textForm;
  } else if (elder) {
    // 祖父母の画面: 選ぶ段の「はなす」で録り始める。録っている間は「おわる」だけ
    if (rec.recording) {
      body = (
        <>
          {rec.elapsed !== null && <RecordingTime elapsed={rec.elapsed} />}
          <button type="button" className="primary stop" aria-pressed="true" onClick={rec.toggle}>
            <StopIcon />
            {w.stop}
          </button>
        </>
      );
    } else if (failed) {
      body = (
        <>
          {failure}
          <div className="grid2">
            <button type="button" onClick={close}>
              {w.cancel}
            </button>
            <button type="button" className="primary" onClick={sender.retry}>
              {w.send}
            </button>
          </div>
        </>
      );
    } else {
      body = (
        <>
          {mic}
          <div className="grid2 answer-choice">
            <button
              type="button"
              aria-pressed="false"
              disabled={busy}
              onClick={() => {
                notice?.clear();
                rec.toggle();
              }}
            >
              <MicIcon />
              {w.byVoice}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                notice?.clear();
                setMode("text");
              }}
            >
              <PenIcon />
              {w.byText}
            </button>
          </div>
          {cancelAux}
        </>
      );
    }
  } else if (mode === "voice") {
    body = failed ? (
      <>
        <div className="grid2">
          <button type="button" onClick={close}>
            {w.cancel}
          </button>
          <button type="button" className="primary" onClick={sender.retry}>
            {w.send}
          </button>
        </div>
        {failure}
      </>
    ) : (
      <>
        <div className="stack">
          {rec.elapsed !== null && <RecordingTime elapsed={rec.elapsed} />}
          <button
            type="button"
            className={rec.recording ? "primary stop" : "primary"}
            onClick={rec.toggle}
            disabled={busy && !rec.recording}
            aria-pressed={rec.recording}
          >
            {rec.recording ? w.stop : w.speak}
          </button>
        </div>
        <button type="button" className="aux" onClick={close}>
          {w.cancel}
        </button>
        {mic}
      </>
    );
  } else {
    body = (
      <>
        <div className="grid2 phrase-break">
          <button type="button" onClick={() => setMode("voice")}>
            {w.byVoice}
          </button>
          <button type="button" onClick={() => setMode("text")}>
            {w.byText}
          </button>
        </div>
        {cancelAux}
        {failure}
      </>
    );
  }

  return (
    <div className={onCancel ? "stack reply-box" : "stack answer"}>
      {who && <p className="who answer-who">{who}</p>}
      {body}
    </div>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
