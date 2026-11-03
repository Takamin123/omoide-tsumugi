// 写真一枚の語りと返事。今日のタブとアルバムで同じものを使う（祖父母の画面でも。言葉は lib/screen.ts。0043）。
// 語りは明朝で全文、話者の呼ばれ方つき。返事は元の語りの下に左の線で。返事の入力欄は一度に一つ（開いている語りの ID を親が持つ）。
// アルバムでは、入り口への答えの語りに「言葉の糸」（答えた入り口に添えた家族の言葉）を出し、押すと元の語りへ移る（0035）。今日のタブには出さない。
// 声は話者名の行を「ばあばの声（13秒）」にし、[聞く][返事]（祖父母は [きく][へんじ]）を一行に並べる（0045）。
// 文字起こしが pending / failed の声は再生だけ（案内の文は出さない。0008、0028）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Narration, QuotedFrom } from "../../shared/api";
import { voiceLength } from "../lib/pure";
import { useScreen, useSentNotice } from "../lib/screen";
import { SENT_NOTICE_MS } from "../lib/useSender";
import { words } from "../words";
import { PlayVoice } from "./PlayVoice";
import { ReplyBox } from "./ReplyBox";

/** /api/feed の語りは「元の言葉」を持つ。ほかの経路の語りは持たない */
type NarrationWithSource = Narration & { quotedFrom?: QuotedFrom | null };

type Props = {
  narrations: NarrationWithSource[];
  nameOf: (memberId: string) => string;
  /** 返事の入力欄を開いている語りの ID。一度に一つ */
  openReplyId: string | null;
  onOpenReply: (narrationId: string | null) => void;
  onSent: () => void;
  /** 渡したときだけ「言葉の糸」を出す（アルバム）。押すと元の語りの ID を渡す */
  onJump?: (narrationId: string) => void;
};

export function Narrations({ narrations, nameOf, openReplyId, onOpenReply, onSent, onJump }: Props) {
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
  reply: boolean;
  replying: boolean;
  onReplying: (on: boolean) => void;
  onSent: () => void;
  children: ReactNode;
}) {
  /** 返事を送った後、「送りました」を出す。家族の画面はしばらく。祖父母の画面は次に答える・返事するボタンを押すまで（画面に一つだけ。0043） */
  const [sentHere, setSent] = useState(false);
  const notice = useSentNotice();
  const sent = notice ? notice.at === narration.id : sentHere;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const { w } = useScreen();
  const length = voiceLength(narration.durationMs);
  return (
    // data-narration: 言葉の糸から移ってくるときの目印（Album の jumpTo）
    <div className={`narration${reply ? " reply" : ""}`} data-narration={narration.id}>
      {/* 声の語りは、話者名の行を「ばあばの声（13秒）」にする（行を増やさず、聞くと返事を一行に並べるため。0045） */}
      <p className="speaker">{narration.audioUrl ? w.listenNote(speaker || null, length) : speaker}</p>
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
          target={{ photoId: narration.photoId, entranceId: null, replyToId: narration.id }}
          onSent={() => {
            onReplying(false);
            clearTimeout(timer.current);
            if (notice) notice.show(narration.id);
            else {
              setSent(true);
              timer.current = setTimeout(() => setSent(false), SENT_NOTICE_MS);
            }
            onSent();
          }}
          onCancel={() => onReplying(false)}
        />
      ) : (
        <div className="row">
          {narration.audioUrl && <PlayVoice src={narration.audioUrl} label={w.listen} stopLabel={w.stopVoice} />}
          <button
            type="button"
            className="aux"
            onClick={() => {
              notice?.clear();
              onReplying(true);
            }}
          >
            {w.reply}
          </button>
        </div>
      )}
      <div aria-live="polite">{sent && <p className="done">{w.sent}</p>}</div>
      {children}
    </div>
  );
}
