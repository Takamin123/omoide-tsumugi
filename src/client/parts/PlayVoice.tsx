// 録音を流すボタン。押すと流れ、もう一度押すと止まる。自動では流さない。
// 同時に流れるのは一つだけ（別のボタンを押すと、前のものは止まる）。マイクで録っている間は流さない（setRecordingNow）。
import { useEffect, useRef, useState } from "react";

type Player = { stop: () => void };
let current: Player | null = null;

/** マイクで録っている間は流さない（流した声が録音に入るため） */
let recordingNow = false;

/** マイクで録り始めるときに true、止めたときに false。true にすると流れている声も止める */
export function setRecordingNow(on: boolean) {
  recordingNow = on;
  if (on) current?.stop();
}

type Props = {
  src: string;
  /** 止まっているときの文字 */
  label: string;
  /** 流れているときの文字 */
  stopLabel: string;
  /** 家族の声は再生の印、読み上げはスピーカーの印 */
  icon?: "play" | "speaker";
};

export function PlayVoice({ src, label, stopLabel, icon = "play" }: Props) {
  const [playing, setPlaying] = useState(false);
  const mine = useRef<Player | null>(null);

  // 画面を離れたら止める
  useEffect(
    () => () => {
      if (mine.current && current === mine.current) mine.current.stop();
    },
    [],
  );

  function play() {
    if (recordingNow) return;
    current?.stop();
    const audio = new Audio(src);
    const player: Player = {
      stop: () => {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        if (current === player) current = null;
        if (mine.current === player) {
          mine.current = null;
          setPlaying(false);
        }
      },
    };
    audio.onended = player.stop;
    audio.onerror = player.stop;
    current = player;
    mine.current = player;
    setPlaying(true);
    // 流せなかったときは、何も言わずに止まった形に戻す
    audio.play().catch(player.stop);
  }

  return (
    <button
      type="button"
      className="aux listen"
      aria-pressed={playing}
      onClick={() => (playing ? mine.current?.stop() : play())}
    >
      {playing ? (
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : icon === "speaker" ? (
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path d="M16 9a4 4 0 0 1 0 6" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
      {playing ? stopLabel : label}
    </button>
  );
}
