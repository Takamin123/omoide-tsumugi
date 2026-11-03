// 家族の画面（スマホ）: 下のタブ「今日」「アルバム」。開いたときは常に「今日」（最後に見たタブを端末に覚えない）。
// 今日: 上にメニュー、自分の今日の入り口、その下に入り口の写真の語りと返事。答える前は「声で」「文字で」を欄の外のタブのすぐ上の段に置く（0034）。
// アルバム: 語りのある写真の帯と、写真ごとの語りの縦の欄（parts/Album.tsx）。上にメニューは置かない。
// 文字や声で答えている間は、下のタブを描かない（lib/composing.ts）。
// 祖父母が開いても読める大きさにする。家族の言葉は明朝。声は長さの入った「声で聞く」のボタンで流す。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entrance, FamilyView, Member } from "../../shared/api";
import { api } from "../lib/api";
import { keepOrder } from "../lib/album";
import { ComposingContext, ComposingSet } from "../lib/composing";
import { errorText } from "../lib/errors";
import { answerPlace } from "../lib/pure";
import { SENT_NOTICE_MS } from "../lib/useSender";
import { navigate } from "../lib/route";
import { Album, type AlbumItem } from "../parts/Album";
import { DemoBar, type DemoProps } from "../parts/DemoBar";
import { EntranceView } from "../parts/EntranceView";
import { ErrorLine } from "../parts/ErrorLine";
import { Narrations } from "../parts/Narrations";
import { ReplyBox } from "../parts/ReplyBox";
import { TabBar, type HomeTab } from "../parts/TabBar";
import { words } from "../words";

type Props = { view: FamilyView; me: Member; demo: DemoProps | null };

export function Home({ view, me, demo }: Props) {
  const [tab, setTab] = useState<HomeTab>("today");
  const [entrance, setEntrance] = useState<Entrance | null | undefined>(undefined);
  const [feed, setFeed] = useState<AlbumItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const composingSet = useMemo(() => new ComposingSet(setComposing), []);
  /** アルバムを開いたときの並び（写真の ID）。開いている間に読み直しても並び替えない */
  const [albumOrder, setAlbumOrder] = useState<string[] | null>(null);
  /** アルバムで見ている写真。タブを行き来しても同じ写真に戻る */
  const [albumCurrent, setAlbumCurrent] = useState<string | null>(null);
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  /** 下の段の文字の欄・録音が開いているか（ほかの入力欄と分ける） */
  const [dockComposing, setDockComposing] = useState(false);
  /** 今日の入り口に、この画面で答えを送った（一覧の読み直しを待たずに段を閉じる） */
  const [answeredHere, setAnsweredHere] = useState(false);
  /** 段を閉じた後、問いかけの下に「送りました」を出しておく */
  const [sentNotice, setSentNotice] = useState(false);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(sentTimer.current), []);

  const loadFeed = useCallback(async (): Promise<AlbumItem[] | null> => {
    try {
      const { items } = await api.getFeed();
      setFeed(items);
      return items;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  }, []);

  useEffect(() => {
    api.todayEntrance().then(
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
  const demoBar = demo && (
    <div className="foot">
      <DemoBar {...demo} />
    </div>
  );

  const changeTab = (t: HomeTab) => {
    setOpenReplyId(null);
    // アルバムは開いたときに /api/feed を読み直し、その順に並べる（ほかの家族の新しい語りを上に出す）。
    // 届くまでは手元の一覧の順で出す
    if (t === "album") {
      setAlbumOrder(feed ? feed.map((it) => it.photo.id) : null);
      void loadFeed().then((items) => items && setAlbumOrder(items.map((it) => it.photo.id)));
    }
    setTab(t);
  };

  // アルバムを開いたときに一覧がまだ届いていなければ、届いたときの順を開いたときの並びにする
  useEffect(() => {
    if (tab === "album" && feed && !albumOrder) setAlbumOrder(feed.map((it) => it.photo.id));
  }, [tab, feed, albumOrder]);

  const onAnswered = useCallback(() => {
    setAnsweredHere(true);
    setDockComposing(false);
    setSentNotice(true);
    clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSentNotice(false), SENT_NOTICE_MS);
    void loadFeed();
  }, [loadFeed]);

  let body;
  let dock = null;
  if (tab === "today") {
    const todays = entrance && feed?.find((it) => it.photo.id === entrance.photo.id);
    // もう答えたか（この端末の人の、今日の入り口への語りがある）。答えた後は段に置かず、問いかけの下に戻す
    const answered =
      answeredHere || (!!entrance && !!todays?.narrations.some((n) => n.entranceId === entrance.id && n.speakerMemberId === me.id));
    // ほかの入力欄（語りへの返事。ボタンを選ぶ前も含む）が開いている間は段を描かない。段の中で書いている間は段を残す（書きかけを消さない）
    const place = answerPlace(!!entrance, answered, !dockComposing && (composing || openReplyId !== null));
    const answerTarget = entrance ? { photoId: entrance.photo.id, entranceId: entrance.id, replyToId: null } : null;
    if (place === "dock" && answerTarget) {
      dock = (
        <div className="home-dock">
          <ReplyBox target={answerTarget} onSent={onAnswered} onComposing={setDockComposing} />
        </div>
      );
    }
    body = (
      <div className="home-scroll">
        <main className="stack home">
          <nav className="top" aria-label={w.menuLabel}>
            <button type="button" onClick={() => navigate("/photos")}>
              {w.menuPhotos}
            </button>
            <button type="button" onClick={() => navigate("/family")}>
              {w.menuFamily}
            </button>
          </nav>

          {entrance === undefined && <p>{words.loading}</p>}
          {entrance && (
            <section className="stack">
              <EntranceView entrance={entrance} members={view.members} variant="family" />
              <div aria-live="polite">
                {sentNotice && <p className="done">{w.sent}</p>}
              </div>
              {/* 答えた後は流れの中。もう一度答えたときの「送りました」は ReplyBox が出す */}
              {place === "flow" && answerTarget && <ReplyBox target={answerTarget} onSent={() => void loadFeed()} />}
            </section>
          )}

          <ErrorLine text={error} />

          {todays && (
            <section className="today-narrations">
              <Narrations
                narrations={todays.narrations}
                nameOf={nameOf}
                openReplyId={openReplyId}
                onOpenReply={setOpenReplyId}
                onSent={() => void loadFeed()}
              />
            </section>
          )}
        </main>
        {demoBar}
      </div>
    );
  } else {
    const items = feed ? (albumOrder ? keepOrder(albumOrder, feed, (it) => it.photo.id) : feed) : [];
    body = (
      <div className="home-album">
        {error && (
          <div className="album-error">
            <ErrorLine text={error} />
          </div>
        )}
        <Album
          items={items}
          nameOf={nameOf}
          currentId={albumCurrent}
          onCurrent={setAlbumCurrent}
          onSent={() => void loadFeed()}
          composing={composing}
          footer={demoBar}
        />
      </div>
    );
  }

  return (
    <ComposingContext.Provider value={composingSet}>
      <div className="home-shell">
        {body}
        {dock}
        <TabBar tab={tab} onChange={changeTab} composing={composing} />
      </div>
    </ComposingContext.Provider>
  );
}
