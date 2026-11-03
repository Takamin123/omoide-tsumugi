// 写真一枚の語りと返事。家族の画面の今日のタブとアルバムで同じものを使う。
// 語りは明朝で全文、話者の呼ばれ方つき。返事は元の語りの下に左の線で。返事の入力欄は一度に一つ（開いている語りの ID を親が持つ）。
// 声は「声で聞く（13秒）」のボタン。文字起こしが pending / failed の声は再生だけ（案内の文は出さない。0008、0028）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Member, Narration } from "../../shared/api";
import { voiceLength } from "../lib/pure";
import { SENT_NOTICE_MS } from "../lib/useSender";
import { words } from "../words";
import { PlayVoice } from "./PlayVoice";
import { ReplyBox } from "./ReplyBox";

type Props = {
  narrations: Narration[];
  me: Member;
  nameOf: (memberId: string) => string;
  /** 返事の入力欄を開いている語りの ID。一度に一つ */
  openReplyId: string | null;
  onOpenReply: (narrationId: string | null) => void;
  onSent: () => void;
};

export function Narrations({ narrations, me, nameOf, openReplyId, onOpenReply, onSent }: Props) {
  const ids = new Set(narrations.map((n) => n.id));
  // 返事は、返した先の語りの下に並べる。先が一覧にないものは上の段に出す
  const roots = narrations.filter((n) => !n.replyToId || !ids.has(n.replyToId));
  const repliesTo = (id: string) => narrations.filter((n) => n.replyToId === id);

  const render = (n: Narration, depth: number): ReactNode => (
    <NarrationView
      key={n.id}
      narration={n}
      speaker={nameOf(n.speakerMemberId)}
      me={me}
      reply={depth > 0}
      replying={openReplyId === n.id}
      onReplying={(on) => onOpenReply(on ? n.id : null)}
      onSent={onSent}
    >
      {repliesTo(n.id).map((r) => render(r, depth + 1))}
    </NarrationView>
  );
  return <>{roots.map((n) => render(n, 0))}</>;
}

function NarrationView({
  narration,
  speaker,
  me,
  reply,
  replying,
  onReplying,
  onSent,
  children,
}: {
  narration: Narration;
  speaker: string;
  me: Member;
  reply: boolean;
  replying: boolean;
  onReplying: (on: boolean) => void;
  onSent: () => void;
  children: ReactNode;
}) {
  /** 返事を送った後、しばらく「送りました」を出す */
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const w = words.home;
  return (
    <div className={`narration${reply ? " reply" : ""}`}>
      <p className="speaker">{speaker}</p>
      {narration.text && <p className="told">{narration.text}</p>}
      {replying ? (
        <ReplyBox
          target={{ speakerMemberId: me.id, photoId: narration.photoId, entranceId: null, replyToId: narration.id }}
          onSent={() => {
            onReplying(false);
            setSent(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setSent(false), SENT_NOTICE_MS);
            onSent();
          }}
          onCancel={() => onReplying(false)}
        />
      ) : (
        <div className="row">
          {narration.audioUrl && (
            <PlayVoice src={narration.audioUrl} label={w.listen(voiceLength(narration.durationMs))} stopLabel={w.stopVoice} />
          )}
          <button type="button" className="aux" onClick={() => onReplying(true)}>
            {w.reply}
          </button>
        </div>
      )}
      <div aria-live="polite">{sent && <p className="done">{w.sent}</p>}</div>
      {children}
    </div>
  );
}
