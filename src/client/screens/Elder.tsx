// 祖父母の画面（スマホとタブレット）: 写真一枚と問いかけ一つ、横いっぱいの「はなす」。
// 主な動作は「はなす」だけ。下の帯に留め、写真と問いかけを動かして見ても押せる。
// 話す人はリンクで決まる。切り替えの道は置かない（意図せず押して見知らぬ画面に行かないように。0036、0037）
import { useCallback, useEffect, useState } from "react";
import type { Entrance, FamilyView, Member } from "../../shared/api";
import { api, ApiError } from "../lib/api";
import { useSender } from "../lib/useSender";
import { DemoBar, type DemoProps } from "../parts/DemoBar";
import { EntranceView } from "../parts/EntranceView";
import { RecordingTime, useRecorder } from "../parts/VoiceRecorder";
import { words } from "../words";

type Props = {
  view: FamilyView;
  me: Member;
  demo: DemoProps | null;
};

type Load =
  | { state: "loading" }
  | { state: "ready"; entrance: Entrance | null }
  | { state: "error"; unauthorized: boolean };

export function Elder({ view, me, demo }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const w = words.elder;

  useEffect(() => {
    let alive = true;
    setLoad({ state: "loading" });
    api.todayEntrance().then(
      ({ entrance }) => alive && setLoad({ state: "ready", entrance }),
      (e) => alive && setLoad({ state: "error", unauthorized: e instanceof ApiError && e.kind === "unauthorized" }),
    );
    return () => {
      alive = false;
    };
  }, [me.id, attempt]);

  const entrance = load.state === "ready" ? load.entrance : null;

  return (
    <main className="elder">
      <header className="elder-head">
        <p className="elder-name">{me.calledAs}</p>
      </header>

      {load.state === "loading" && <p>{words.loading}</p>}
      {load.state === "error" &&
        (load.unauthorized ? (
          <p role="alert">{w.errors.unauthorized}</p>
        ) : (
          <div className="stack" role="alert">
            <p>{w.errors.loadFailed}</p>
            <button type="button" className="primary" onClick={() => setAttempt((n) => n + 1)}>
              {w.again}
            </button>
          </div>
        ))}
      {/* 入り口がないときは何も出さない。祖父母には写真を足す手段がないので、「写真がない」は行き止まりの文になる（0010） */}
      {entrance && (
        <>
          <EntranceView entrance={entrance} members={view.members} variant="elder" />
          <Answer key={entrance.id} entrance={entrance} me={me} demo={demo} />
        </>
      )}
      {!entrance && demo && <DemoBar {...demo} />}
    </main>
  );
}

function Answer({ entrance, me, demo }: { entrance: Entrance; me: Member; demo: DemoProps | null }) {
  /** 送った後、次に「はなす」を押すまで「おくりました」を出しておく（数秒で消すと、目を離していると見逃す） */
  const [done, setDone] = useState(false);
  const [micError, setMicError] = useState(false);
  const onSent = useCallback(() => setDone(true), []);
  const sender = useSender({ photoId: entrance.photo.id, entranceId: entrance.id, replyToId: null }, onSent);
  const rec = useRecorder({
    onBlob: sender.sendVoice,
    onStarted: () => setMicError(false),
    onMicError: () => setMicError(true),
  });
  const w = words.elder;

  let body;
  if (rec.recording) {
    body = (
      <>
        {rec.elapsed !== null && <RecordingTime elapsed={rec.elapsed} />}
        <button type="button" className="primary stop" aria-pressed="true" onClick={rec.toggle}>
          <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          {w.stop}
        </button>
      </>
    );
  } else if (sender.state === "failed") {
    body = (
      <>
        <p role="alert">{w.errors.sendFailed}</p>
        <div className="grid2">
          <button type="button" onClick={sender.discard}>
            {w.cancel}
          </button>
          <button type="button" className="primary" onClick={sender.retry}>
            {w.resend}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {done && (
          <p className="done" role="status">
            <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
            {w.sent}
          </p>
        )}
        {micError && <p role="alert">{w.errors.micDenied}</p>}
        <button
          type="button"
          className="primary"
          aria-pressed="false"
          disabled={sender.state === "sending"}
          onClick={() => {
            setDone(false);
            rec.toggle();
          }}
        >
          <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v4" />
          </svg>
          {w.speak}
        </button>
      </>
    );
  }

  return (
    <>
      <div className="elder-action">
        {/* 今の話者を、主な動作のすぐそばに常に見せる（0008） */}
        <p className="who">{me.calledAs}</p>
        {body}
      </div>
      {/* 録音済みの音声は、マイクの録音と同じ送る流れ（sender.sendVoice）に渡す */}
      {demo && <DemoBar {...demo} onAudioFile={sender.sendVoice} audioDisabled={sender.state === "sending"} />}
    </>
  );
}
