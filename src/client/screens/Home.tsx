// 家族の画面（スマホ）: 自分の今日の入り口を一番上に開いて出し、その下に届いた語り。
// 祖父母が開いても読める大きさにする。家族の言葉は明朝。声は長さの入った「声で聞く」のボタンで流す。
// 文字起こしが pending / failed の声は再生だけ（案内の文は出さない）。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Entrance, FamilyView, Member, Narration, Photo } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatTakenDate, voiceLength } from "../lib/pure";
import { SENT_NOTICE_MS } from "../lib/useSender";
import { navigate } from "../lib/route";
import { EntranceView } from "../parts/EntranceView";
import { ErrorLine } from "../parts/ErrorLine";
import { PhotoImage } from "../parts/PhotoImage";
import { PlayVoice } from "../parts/PlayVoice";
import { ReplyBox } from "../parts/ReplyBox";
import { words } from "../words";

type Props = { view: FamilyView; me: Member; onSwitchUser: () => void };
type FeedItem = { photo: Photo; narrations: Narration[] };

export function Home({ view, me, onSwitchUser }: Props) {
  const [entrance, setEntrance] = useState<Entrance | null | undefined>(undefined);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    try {
      setFeed((await api.getFeed()).items);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    api.todayEntrance(me.id).then(
      (r) => setEntrance(r.entrance),
      (e) => {
        setEntrance(null);
        setError(errorText(e));
      },
    );
    void loadFeed();
  }, [me.id, loadFeed]);

  const nameOf = (id: string) => view.members.find((m) => m.id === id)?.calledAs ?? "";
  const w = words.home;

  return (
    <main className="stack home">
      <nav className="top">
        <button type="button" onClick={() => navigate("/photos")}>
          {w.menuPhotos}
        </button>
        <button type="button" onClick={() => navigate("/family")}>
          {w.menuFamily}
        </button>
        <button type="button" onClick={onSwitchUser}>
          {w.switchUser}
        </button>
      </nav>

      {entrance === undefined && <p>{words.loading}</p>}
      {entrance && (
        <section className="stack">
          <EntranceView entrance={entrance} members={view.members} variant="family" />
          <ReplyBox
            target={{ speakerMemberId: me.id, photoId: entrance.photo.id, entranceId: entrance.id, replyToId: null }}
            onSent={() => void loadFeed()}
          />
        </section>
      )}

      <ErrorLine text={error} />

      {feed?.map((item) => (
        <FeedPhoto key={item.photo.id} item={item} me={me} nameOf={nameOf} onSent={() => void loadFeed()} />
      ))}
    </main>
  );
}

function FeedPhoto({
  item,
  me,
  nameOf,
  onSent,
}: {
  item: FeedItem;
  me: Member;
  nameOf: (id: string) => string;
  onSent: () => void;
}) {
  const ids = new Set(item.narrations.map((n) => n.id));
  // 返事は、返した先の語りの下に並べる。先が一覧にないものは上の段に出す
  const roots = item.narrations.filter((n) => !n.replyToId || !ids.has(n.replyToId));
  const repliesTo = (id: string) => item.narrations.filter((n) => n.replyToId === id);
  const taken = formatTakenDate(item.photo.takenAt);

  const renderNarration = (n: Narration, depth: number) => (
    <NarrationView key={n.id} narration={n} speaker={nameOf(n.speakerMemberId)} me={me} reply={depth > 0} onSent={onSent}>
      {repliesTo(n.id).map((r) => renderNarration(r, depth + 1))}
    </NarrationView>
  );

  return (
    <article className="mount feed-photo">
      <PhotoImage photo={item.photo} />
      {taken && <p className="who">{taken}</p>}
      {roots.map((n) => renderNarration(n, 0))}
    </article>
  );
}

function NarrationView({
  narration,
  speaker,
  me,
  reply,
  onSent,
  children,
}: {
  narration: Narration;
  speaker: string;
  me: Member;
  reply: boolean;
  onSent: () => void;
  children: ReactNode;
}) {
  const [replying, setReplying] = useState(false);
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
            setReplying(false);
            setSent(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setSent(false), SENT_NOTICE_MS);
            onSent();
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="row">
          {narration.audioUrl && (
            <PlayVoice src={narration.audioUrl} label={w.listen(voiceLength(narration.durationMs))} stopLabel={w.stopVoice} />
          )}
          <button type="button" className="aux" onClick={() => setReplying(true)}>
            {w.reply}
          </button>
        </div>
      )}
      <div aria-live="polite">{sent && <p className="done">{w.sent}</p>}</div>
      {children}
    </div>
  );
}
