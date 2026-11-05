// 写真一枚の語りと返事。今日のタブとアルバムで同じものを使う（祖父母の画面でも。言葉は lib/screen.ts。0043）。
// 語りは全文、話者の呼ばれ方つきで、家族の言葉の箱（紙の色の地。0059）に入れる。返事は元の語りの下に一段下げて。返事の入力欄は一度に一つ（開いている語りの ID を親が持つ）。
// アルバムでは、入り口への答えの語りに「言葉の糸」（答えた入り口に添えた家族の言葉）を出し、押すと元の語りへ移る（0035）。今日のタブには出さない。
// 声は話者名の行を「ばあばの声（13秒）」にし、[聞く][返事]（祖父母は [聞く][返事]）を一行に並べる（0045）。
// 文字起こしが pending / failed の声は再生だけ（案内の文は出さない。0008、0028）。
// 声で返事を送った直後は、「送りました」の下に「録り直す」（0050）。押したら返事の欄を開いてすぐ録り始める。
// 前の返事は、録り直した声が送れたときに消し（lib/retake.ts）、消し終えてから一覧を読み直す。
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Narration, QuotedFrom } from "../../shared/api";
import { voiceLength } from "../lib/pure";
import { useRetake } from "../lib/retake";
import { useScreen, useSentNotice } from "../lib/screen";
import { SENT_NOTICE_MS } from "../lib/useSender";
import { words } from "../words";
import { PlayVoice } from "./PlayVoice";
import { ReplyBox } from "./ReplyBox";
import { Retake } from "./Retake";
import { SpeakerMark } from "./SpeakerMark";

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
  /** 返事のタブで、開いた時点でまだ見ていなかった語りの ID。淡い青の箱と札「新しい」で示す（0061） */
  fresh?: ReadonlySet<string>;
  /** 偽なら「返事」と返事の「録り直す」を出さない（聞くだけ。写真を家族に共有する画面で言葉を添えるとき。0054） */
  canReply?: boolean;
};

export function Narrations({ narrations, nameOf, openReplyId, onOpenReply, onSent, onJump, fresh, canReply = true }: Props) {
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
      fresh={fresh?.has(n.id) ?? false}
      canReply={canReply}
      replying={canReply && openReplyId === n.id}
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
  fresh,
  canReply,
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
  fresh: boolean;
  canReply: boolean;
  replying: boolean;
  onReplying: (on: boolean) => void;
  onSent: () => void;
  children: ReactNode;
}) {
  /** 返事を送った後、「送りました」を出す。家族の画面はしばらく。祖父母の画面は次に答える・返事するボタンを押すまで（画面に一つだけ。0043） */
  const [sentHere, setSent] = useState(false);
  const notice = useSentNotice();
  const retake = useRetake();
  const slot = retake?.slot?.at === narration.id ? retake.slot : null;
  // 家族の画面: 声の返事の「送りました」は、「録り直す」と一緒に残す（4 秒で消さない。0050）。録り直している間は出さない
  const sent = !slot?.retaking && (notice ? notice.at === narration.id : sentHere || !!slot);
  /** 「録り直す」を押した後に開く返事の欄は、すぐ録り始める */
  const [autoStart, setAutoStart] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const { w, elder } = useScreen();
  const length = voiceLength(narration.durationMs);
  return (
    // data-narration: 言葉の糸から移ってくるときの目印（Album の jumpTo）
    <div className={`narration${reply ? " reply" : ""}${fresh ? " fresh" : ""}`} data-narration={narration.id}>
      {/* 家族の言葉の箱（紙の色の地）。話者名・本文・言葉の糸・聞く／返事をまとめる（0059） */}
      <div className="paper">
        {/* 声の語りは、話者名の行を「ばあばの声（13秒）」にする（行を増やさず、聞くと返事を一行に並べるため。0045） */}
        {/* 名前の左に頭文字の丸（飾り）、新しく届いたものには札「新しい」（0061） */}
        <p className="speaker">
          <SpeakerMark memberId={narration.speakerMemberId} />
          {narration.audioUrl ? w.listenNote(speaker || null, length) : speaker}
          {fresh && <span className="fresh-tag">{words.home.fresh}</span>}
        </p>
        {narration.text && <p className="told">{narration.text}</p>}
        {thread && onJump && (
          // 本文と見分けるため補助の文字の体。押せることは上向きの印と下線でも示す
          <button type="button" className="thread" onClick={() => onJump(thread.to)}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            <span>{thread.label}</span>
          </button>
        )}
        {!replying && (canReply || narration.audioUrl) && (
          <div className="row">
            {narration.audioUrl && <PlayVoice src={narration.audioUrl} label={w.listen} stopLabel={w.stopVoice} name={w.listenName(speaker || null)} />}
            {canReply && (
              <button
                type="button"
                className="aux"
                onClick={() => {
                  notice?.clear();
                  retake?.clear();
                  onReplying(true);
                }}
              >
                {/* 家族の画面だけ返事の印（祖父母の画面は幅 360px・文字 150% で [聞く][返事] を一行に保つため付けない。0045） */}
                {!elder && <ReplyIcon />}
                {w.reply}
              </button>
            )}
          </div>
        )}
      </div>
      {replying && (
        <ReplyBox
          target={{ photoId: narration.photoId, entranceId: null, replyToId: narration.id }}
          autoStart={autoStart}
          onSent={(s) => {
            onReplying(false);
            setAutoStart(false);
            clearTimeout(timer.current);
            // 録り直した声なら、前の返事を消し終えてから一覧を読み直す（先に読むと消す前の一覧が後から届きうる）
            const replaced = retake?.offer(narration.id, s);
            if (notice) notice.show(narration.id);
            else if (s.kind === "text") {
              setSent(true);
              timer.current = setTimeout(() => setSent(false), SENT_NOTICE_MS);
            } else setSent(false);
            // retake があれば offer はいつも Promise を返す（消すものがなければすぐ解決する）
            if (replaced) void replaced.then(onSent);
            else onSent();
          }}
          onCancel={() => {
            setAutoStart(false);
            onReplying(false);
          }}
        />
      )}
      <div aria-live="polite">{sent && <p className="done">{w.sent}</p>}</div>
      {canReply && !replying && (
        <Retake
          at={narration.id}
          onRetake={() => {
            setAutoStart(true);
            onReplying(true);
          }}
        />
      )}
      {children}
    </div>
  );
}

function ReplyIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 8L4 13l6 5M4 13h10a6 6 0 0 1 6 6" />
    </svg>
  );
}
