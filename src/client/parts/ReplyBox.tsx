// 文字か声で送る。入り口への答えにも、語りへの返事にも使う。家族の画面と祖父母の画面で同じ部品（言葉と大きさだけが違う。0043）。
// 主役の「声で話す」「話す」は青で塗り、「文字で書く」「書く」は青い枠（人間、2026-11-05。0059）。
// 家族の画面: 「声で話す」「文字で書く」。「声で話す」を押すとその場で録り始め、「終わる」で送る。文字なら欄と「送る」。
// 祖父母の画面: 「話す」「書く」。同じく「話す」でその場で録り始め、「終わる」で送る（0008）。
// 選んだ後にもう一度「話す」を押させない（二度押さないと録り始めないのは分かりにくい。人間、2026-11-04）。
// マイクの許可を待っている間（押した後、録り始める前）は、録るボタンの場所を押せない形にして「マイクを準備しています」を出す（両画面。0008 の追記）。
// 文字・声の形が開いている間は、画面に「入力中」を知らせる（下のタブを隠す）。
// 段が替わる（押したボタンが消える）ときは、操作の位置を次の段の主なボタンへ移す（読み上げが新しい段を読む。消えたボタンで位置を失わない）。
// 送ったら入力欄を閉じる。「送りました」は呼ぶ側が出す（今日の答えは Home、返事は Narrations）。
// 今日の答えの「録り直す」（0050）は、この欄の先頭（「送りました」のすぐ下）に出し、押したらこの欄でそのまま録り始める（段を作り直さない）。
// 返事の「録り直す」は Narrations が出し、押したら返事の欄を autoStart で開く。
// 前の声は、録り直した声が送れたときに消す（lib/retake.ts）。送らずに終えたら（やめた・短すぎて捨てた・マイクが使えない・欄が閉じた）取り直しを終え、前の声は残す。
import { useEffect, useRef, useState } from "react";
import type { VoiceTarget } from "../lib/voice";
import { useComposing } from "../lib/composing";
import { errorText } from "../lib/errors";
import { isAndroidLineInApp } from "../lib/pure";
import { useScreen, useSentNotice } from "../lib/screen";
import { useRetake } from "../lib/retake";
import { useSender, type Sender, type SentNarration } from "../lib/useSender";
import { MicIcon } from "./MicIcon";
import { Retake } from "./Retake";
import { RecordingTime, useRecorder } from "./VoiceRecorder";

type Props = {
  target: VoiceTarget;
  /** 送る状態を呼ぶ側が持つとき（今日の答え。デモの帯の録音済みファイルと共有する）。送った後の知らせは、その sender の onSent が受ける */
  sender?: Sender;
  /** 自分で送る状態を持つとき、送った後に呼ぶ */
  onSent?: (sent: SentNarration) => void;
  onCancel?: () => void;
  /** 文字の欄・録音を開いた・閉じたを知らせる（今日の入り口の段が、自分の入力の間は残るため。0034） */
  onComposing?: (on: boolean) => void;
  /** 祖父母の画面の今日の答えで、ボタンのすぐ上に出す今の話者の呼ばれ方（0008） */
  who?: string;
  /** 今日の答えの「録り直す」（0050）を出す場所（"answer"）。押したらこの欄で録り始める */
  retakeAt?: string;
  /** 開いたらすぐ録り始める（返事の「録り直す」を押した後。0050） */
  autoStart?: boolean;
};

export function ReplyBox({ target, sender: external, onSent, onCancel, onComposing, who, retakeAt, autoStart }: Props) {
  const { elder, w } = useScreen();
  const notice = useSentNotice();
  const retakeSlot = useRetake();
  const [mode, setMode] = useState<"choose" | "text" | "voice">(autoStart && !elder ? "voice" : "choose");
  const [text, setText] = useState("");
  const [micError, setMicError] = useState(false);
  const own = useSender(target, onSent);
  const sender = external ?? own;
  /** この欄の取り直しの場所（今日の答えは "answer"、返事は返した先の語り）。送らずに終えたら取り直しを終える（前の声は残る） */
  const at = retakeAt ?? target.replyToId;
  const endRetake = () => {
    if (at) retakeSlot?.end(at);
  };
  const endRef = useRef(endRetake);
  endRef.current = endRetake;
  const rec = useRecorder({
    onBlob: sender.sendVoice,
    onStarted: () => setMicError(false),
    onMicError: () => {
      setMicError(true);
      endRetake();
    },
    onDiscarded: endRetake,
  });
  // 録り直しの途中で欄が閉じた（タブを替えた、ほかの返事を開いた）ら、取り直しを終える。
  // StrictMode の作り直し（片付け → すぐ組み立て直し）では終えない（片付けの後、組み立て直されていなければ閉じた）
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) endRef.current();
      });
    };
  }, []);
  // 返事の「録り直す」: 開いたらすぐ録り始める（家族の画面は声の段で開く）
  useEffect(() => {
    if (autoStart) rec.toggle();
    // 開いたときだけ（StrictMode の二度目は、一度目の待ちを useRecorder が捨てるので録音は一つ）
  }, []);
  /** 次の操作（話す・書く）を押したら、「送りました」と「録り直す」を消す */
  const clearNotices = () => {
    notice?.clear();
    retakeSlot?.clear();
  };
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
  const open = mode !== "choose" || rec.recording || rec.starting || (elder && failed);
  useComposing(open);
  useEffect(() => {
    onComposing?.(open);
    return () => onComposing?.(false);
  }, [open, onComposing]);

  // 段が替わったら、操作の位置を次の段の主なボタンへ移す。移すのは、位置が失われた（押したボタンが消えた）か、この欄の中にあるときだけ（ほかの場所を触っている人から奪わない）
  const boxRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  // 送っている間も段に数える（押したボタンが送る間に押せなくなって位置が落ち、送り終えても段が替わらず戻らないのを防ぐ。祖父母の画面の「終わる」→ 送れた）
  const step = rec.starting ? "starting" : rec.recording ? "recording" : `${mode}${failed ? "-failed" : busy ? "-busy" : ""}`;
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    if (focusFollows(document.activeElement, document.body, boxRef.current)) primaryRef.current?.focus();
  }, [step]);

  const close = () => {
    setMicError(false);
    rec.cancel();
    endRetake();
    // 送れなかったものを持ったまま閉じない（後で「送る」を押して、閉じた欄の中身が送られないように）
    if (failed) sender.discard();
    if (onCancel) onCancel();
    else setMode("choose");
  };
  const failure = failed && <p role="alert" className={elder ? undefined : "sub"}>{w.sendFailed ?? errorText(sender.error)}</p>;
  const mic = micError && <p role="alert" className={elder ? undefined : "sub"}>{isAndroidLineInApp(navigator.userAgent) ? w.micInLine : w.micDenied}</p>;
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
      {/* 祖父母の画面は、声のときと同じく文を先に、ボタンを後に（文が「送る」を指す） */}
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
  } else if (rec.starting) {
    // マイクの許可を待っている間。押せない（aria-disabled でフォーカスは残す。押しても useRecorder が無視する）。
    // 祖父母の画面も「終わる」と同じ一つのボタンに替え、「書く」は出さない（待つ間に文字の欄へ移ると、録音が見えないまま始まりうる）。
    // 「やめる」は両画面・今日の答えでも出す（許可の表示が決着しないまま残るブラウザで、抜け出す道をなくさない）
    body = (
      <>
        <button ref={primaryRef} type="button" className="primary mic-waiting phrase-break" aria-disabled="true">
          {w.micWaiting}
        </button>
        <button type="button" className="aux" onClick={close}>
          {w.cancel}
        </button>
      </>
    );
  } else if (elder) {
    // 祖父母の画面: 選ぶ段の「話す」で録り始める。録っている間は「終わる」だけ
    if (rec.recording) {
      body = (
        <>
          {rec.elapsed !== null && <RecordingTime elapsed={rec.elapsed} />}
          <button ref={primaryRef} type="button" className="primary stop" aria-pressed="true" onClick={rec.toggle}>
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
            <button ref={primaryRef} type="button" className="primary" onClick={sender.retry}>
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
              ref={primaryRef}
              type="button"
              className="choice-fill"
              aria-pressed="false"
              disabled={busy}
              onClick={() => {
                clearNotices();
                rec.toggle();
              }}
            >
              <MicIcon />
              {w.byVoice}
            </button>
            <button
              type="button"
              className="choice-line"
              disabled={busy}
              onClick={() => {
                clearNotices();
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
          <button ref={primaryRef} type="button" className="primary" onClick={sender.retry}>
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
            ref={primaryRef}
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
          <button
            ref={primaryRef}
            type="button"
            className="choice-fill"
            disabled={busy}
            onClick={() => {
              clearNotices();
              setMicError(false);
              setMode("voice");
              // 送れなかった声があるときは録り始めず、今までどおり「送る」で送り直す段に移る（録音が見えないまま始まらないように）
              if (!failed) rec.toggle();
            }}
          >
            <MicIcon />
            {w.byVoice}
          </button>
          <button
            type="button"
            className="choice-line"
            onClick={() => {
              clearNotices();
              setMode("text");
            }}
          >
            <PenIcon />
            {w.byText}
          </button>
        </div>
        {cancelAux}
        {failure}
      </>
    );
  }

  return (
    <div ref={boxRef} className={onCancel ? "stack reply-box" : "stack answer"}>
      {retakeAt && mode === "choose" && !rec.recording && !rec.starting && (
        <Retake
          at={retakeAt}
          onRetake={() => {
            setMicError(false);
            if (!elder) setMode("voice");
            rec.toggle();
          }}
        />
      )}
      {who && <p className="who answer-who">{who}</p>}
      {body}
    </div>
  );
}

/** 段が替わったときに操作の位置を移してよいか。位置が失われた（body か、なし）か、この欄の中にあるときだけ */
export function focusFollows(active: Element | null, body: Element, box: Element | null): boolean {
  if (!box) return false;
  return active === null || active === body || box.contains(active);
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
