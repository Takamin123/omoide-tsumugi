// 写真一枚の語りと返事。家族の画面の今日のタブとアルバムで同じものを使う。
// 語りは明朝で全文、話者の呼ばれ方つき。返事は元の語りの下に左の線で。返事の入力欄は一度に一つ（開いている語りの ID を親が持つ）。
// アルバムでは、入り口への答えの語りに「言葉の糸」（答えた入り口に添えた家族の言葉）を出し、押すと元の語りへ移る（0035）。今日のタブには出さない。
// 声は「声で聞く（13秒）」のボタン。文字起こしが pending / failed の声は再生だけ（案内の文は出さない。0008、0028）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Member, Narration, QuotedFrom } from "../../shared/api";
import { voiceLength } from "../lib/pure";
import { SENT_NOTICE_MS } from "../lib/useSender";
import { words } from "../words";
import { PlayVoice } from "./PlayVoice";
import { ReplyBox } from "./ReplyBox";

/** /api/feed の語りは「元の言葉」を持つ。ほかの経路の語りは持たない */
type NarrationWithSource = Narration & { quotedFrom?: QuotedFrom | null };

type Props = {
  narrations: NarrationWithSource[];
  me: Member;
  nameOf: (memberId: string) => string;
  /** 返事の入力欄を開いている語りの ID。一度に一つ */
  openReplyId: string | null;
  onOpenReply: (narrationId: string | null) => void;
  onSent: () => void;
  /** 渡したときだけ「言葉の糸」を出す（アルバム）。押すと元の語りの ID を渡す */
  onJump?: (narrationId: string) => void;
};

export function Narrations({ narrations, me, nameOf, openReplyId, onOpenReply, onSent, onJump }: Props) {
  const ids = new Set(narrations.map((n) => n.id));
  // 返事は、返した先の語りの下に並べる。先が一覧にないものは上の段に出す
  const roots = narrations.filter((n) => !n.replyToId || !ids.has(n.replyToId));
  const repliesTo = (id: string) => narrations.filter((n) => n.replyToId === id);

  const render = (n: NarrationWithSource, depth: number): ReactNode => (
    <NarrationView
      key={n.id}
      narration={n}
      speaker={nameOf(n.speakerMemberId)}
      thread={
        onJump && n.quotedFrom
          ? { label: words.home.thread(nameOf(n.quotedFrom.speakerMemberId), n.quotedFrom.text), to: n.quotedFrom.narrationId }
          : null
      }
      onJump={onJump}
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
  thread,
  onJump,
  me,
  reply,
  replying,
  onReplying,
  onSent,
  children,
}: {
  narration: Narration;
  speaker: string;
  thread: { label: string; to: string } | null;
  onJump?: (narrationId: string) => void;
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
    // data-narration: 言葉の糸から移ってくるときの目印（Album の jumpTo）
    <div className={`narration${reply ? " reply" : ""}`} data-narration={narration.id}>
      <p className="speaker">{speaker}</p>
      {narration.text && <p className="told">{narration.text}</p>}
      {thread && onJump && (
        // 本文（明朝）と見分けるため補助の文字の体。押せることは上向きの印と下線でも示す
        <button type="button" className="thread" onClick={() => onJump(thread.to)}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          <span>{thread.label}</span>
        </button>
      )}
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
