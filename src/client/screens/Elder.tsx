// 祖父母の画面（タブレット）: 写真一枚と問いかけ一つ、大きなマイクボタン、話者の切り替え。
// 主な動作はマイクだけ。話者の切り替えは補助として上に小さく置く。
import { useEffect, useState } from "react";
import type { Entrance, FamilyView, Member } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { useSender } from "../lib/useSender";
import { DemoBar, type DemoProps } from "../parts/DemoBar";
import { EntranceView } from "../parts/EntranceView";
import { ErrorLine } from "../parts/ErrorLine";
import { VoiceRecorder } from "../parts/VoiceRecorder";
import { words } from "../words";

type Props = {
  view: FamilyView;
  me: Member;
  onSwitch: (memberId: string | null) => void;
  demo: DemoProps | null;
};

type Load = { state: "loading" } | { state: "ready"; entrance: Entrance | null } | { state: "error"; text: string };

export function Elder({ view, me, onSwitch, demo }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [micError, setMicError] = useState(false);
  const elders = view.members.filter((m) => m.role === "elder");

  useEffect(() => {
    let alive = true;
    api.todayEntrance(me.id).then(
      ({ entrance }) => alive && setLoad({ state: "ready", entrance }),
      (e) => alive && setLoad({ state: "error", text: errorText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [me.id]);

  const entrance = load.state === "ready" ? load.entrance : null;

  return (
    <main className="stack">
      {elders.length > 1 && (
        <div className="speakers" role="group">
          {elders.map((m) => (
            <button key={m.id} type="button" aria-pressed={m.id === me.id} onClick={() => m.id !== me.id && onSwitch(m.id)}>
              {m.calledAs}
            </button>
          ))}
        </div>
      )}

      {load.state === "loading" && <p>{words.loading}</p>}
      {load.state === "error" && <ErrorLine text={load.text} />}
      {/* 入り口がないときは何も出さない。祖父母には写真を足す手段がないので、「写真がない」は行き止まりの文になる（0010） */}
      {entrance && (
        <>
          <EntranceView entrance={entrance} members={view.members} />
          <Answer
            key={entrance.id}
            entrance={entrance}
            me={me}
            micError={micError}
            onMicError={() => setMicError(true)}
            onMicOk={() => setMicError(false)}
            demo={demo}
          />
        </>
      )}
      {!entrance && demo && <DemoBar {...demo} />}

      <button type="button" className="sub" style={{ marginTop: "2rem", alignSelf: "flex-start" }} onClick={() => onSwitch(null)}>
        {words.home.switchUser}
      </button>
    </main>
  );
}

function Answer({
  entrance,
  me,
  micError,
  onMicError,
  onMicOk,
  demo,
}: {
  entrance: Entrance;
  me: Member;
  micError: boolean;
  onMicError: () => void;
  onMicOk: () => void;
  demo: DemoProps | null;
}) {
  const sender = useSender({ speakerMemberId: me.id, photoId: entrance.photo.id, entranceId: entrance.id, replyToId: null });
  const w = words.elder;

  return (
    <>
      <p className="speaker-now">{me.calledAs}</p>
      {sender.state === "failed" ? (
        <button type="button" className="mic" style={{ alignSelf: "center" }} onClick={sender.retry}>
          {w.resend}
        </button>
      ) : (
        <VoiceRecorder
          variant="mic"
          startLabel={w.speak}
          stopLabel={w.stop}
          disabled={sender.state === "sending"}
          onBlob={sender.sendVoice}
          onStarted={onMicOk}
          onMicError={onMicError}
        />
      )}
      <div aria-live="polite" style={{ textAlign: "center" }}>
        {sender.state === "sent" && <p>{w.sent}</p>}
        {sender.state === "failed" && <p>{w.sendFailed}</p>}
        {micError && <p>{w.micDenied}</p>}
      </div>
      {/* 録音済みの音声は、マイクの録音と同じ送る流れ（sender.sendVoice）に渡す */}
      {demo && <DemoBar {...demo} onAudioFile={sender.sendVoice} audioDisabled={sender.state === "sending"} />}
    </>
  );
}
