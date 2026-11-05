// 家族の画面（スマホ）と祖父母の画面（スマホとタブレット）: 下のタブ「今日」「アルバム」「返事」。開いたときは常に「今日」（最後に見たタブを端末に覚えない）。
// 祖父母の画面も同じ形で、違うのは言葉と大きさだけ（variant。lib/screen.ts、styles.css の .home-shell.elder。0043）。
// 今日: 上にメニュー（祖父母の画面では呼ばれ方だけ）、自分の今日の入り口、その下に入り口の写真の語りと返事。答える前は「声で」「文字で」を欄の外のタブのすぐ上の段に置く（0034）。
// アルバム: 語りのある写真の帯と、写真ごとの語りの縦の欄（parts/Album.tsx）。上にメニューは置かない。
// 返事: この人に届いたもの（自分の語りへの返事と、自分が入れた写真への語り）を写真ごとに（parts/Replies.tsx、lib/replies.ts。0058）。
// タブのバッジはまだ見ていない数。開いた時点で見たことにし（サーバーにも知らせる）、開いている間に届いたものは次に開くまでバッジに残す。
// 文字や声で答えている間は、下のタブを描かない（lib/composing.ts）。
// 声を送った直後は「送りました」の下に「とりなおす」（画面に一つだけ。lib/retake.ts。0050）。前の声は録り直した声が送れたときに消すので、
// 取り直しの間も今日の入り口は「答えた」のまま（段は流れのまま。録音中に欄が作り直されない）。
// 裏から前に戻ったときは、日付が替わったか裏に 10 分以上いたら、入り口と一覧を静かに読み直す（lib/useResumeRefresh.ts。0051）。
// 一覧に文字起こしを待つ声の語りがある間は、一覧だけを静かに読み直す（lib/transcriptFollow.ts。0052）。一覧の読み込みは feed 一つにまとめる。
// 家族の言葉はゴシックで、紙の色の箱に入れる（0059）。声は「聞く」のボタンで流し、誰の声かと長さは注「ばあばの声（13秒）」に出す（0045）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entrance, FamilyView, FeedItem, FeedResult, Member } from "../../shared/api";
import { api, ApiError } from "../lib/api";
import { keepOrder } from "../lib/album";
import { keepOrderNewFirst, latestIncomingAt, mergeSeenAt, replyGroups, unseenCount } from "../lib/replies";
import { ComposingContext, ComposingSet } from "../lib/composing";
import { errorText } from "../lib/errors";
import { answerPlace } from "../lib/pure";
import { RetakeContext, useRetakeSlot } from "../lib/retake";
import { ScreenContext, SentNoticeContext, type ScreenVariant } from "../lib/screen";
import { SENT_NOTICE_MS, useSender, type SentNarration } from "../lib/useSender";
import { navigate } from "../lib/route";
import { homeBusy, refreshQuietly, useResumeRefresh } from "../lib/useResumeRefresh";
import { feedReader, keepsOpenReply, useTranscriptFollow } from "../lib/transcriptFollow";
import { Album } from "../parts/Album";
import { DemoBar, type DemoProps } from "../parts/DemoBar";
import { EntranceView } from "../parts/EntranceView";
import { ErrorLine } from "../parts/ErrorLine";
import { Narrations } from "../parts/Narrations";
import { Replies } from "../parts/Replies";
import { ReplyBox } from "../parts/ReplyBox";
import { TabBar, type HomeTab } from "../parts/TabBar";
import { words } from "../words";

type Props = { view: FamilyView; me: Member; demo: DemoProps | null; variant?: ScreenVariant };

/** 入り口がまだないときの、送る先の空の形（送ることはない） */
const NO_TARGET = { photoId: "", entranceId: null, replyToId: null };

export function Home({ view, me, demo, variant = "family" }: Props) {
  const elder = variant === "elder";
  const [tab, setTab] = useState<HomeTab>("today");
  const tabNow = useRef<HomeTab>(tab);
  tabNow.current = tab;
  const [entrance, setEntrance] = useState<Entrance | null | undefined>(undefined);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  /** 読み込めなかったときの例外。家族の画面は文に、祖父母の画面は祖父母の文と「もういちど」にする */
  const [entranceError, setEntranceError] = useState<unknown>(null);
  const [feedError, setFeedError] = useState<unknown>(null);
  /** 祖父母の画面の「もういちど」で読み直す */
  const [attempt, setAttempt] = useState(0);
  const [composing, setComposing] = useState(false);
  const composingSet = useMemo(() => new ComposingSet(setComposing), []);
  /** アルバムを開いたときの並び（写真の ID）。開いている間に読み直しても並び替えない */
  const [albumOrder, setAlbumOrder] = useState<string[] | null>(null);
  /** アルバムで見ている写真。タブを行き来しても同じ写真に戻る */
  const [albumCurrent, setAlbumCurrent] = useState<string | null>(null);
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  /** 返事のタブを最後に開いた時刻（サーバーの記録。null はまだ開いていない。0058） */
  const [serverSeenAt, setServerSeenAt] = useState<number | null>(null);
  /**
   * この画面で返事のタブを開いた時点の見た時刻（そのとき手元にあった届いたものの一番新しい時刻）。
   * サーバーの記録が届くまでの間もバッジを消しておく。開いている間に届いたものはこれより新しいので、次に開くまでバッジに残る
   */
  const [localSeenAt, setLocalSeenAt] = useState<number | null>(null);
  /** 返事のタブを開いたときの並び（写真の ID）。開いている間に読み直しても並び替えない */
  const [repliesOrder, setRepliesOrder] = useState<string[] | null>(null);
  /** 下の段の文字の欄・録音が開いているか（ほかの入力欄と分ける） */
  const [dockComposing, setDockComposing] = useState(false);
  /** 今日の入り口に、この画面で答えを送った（一覧の読み直しを待たずに段を閉じる） */
  const [answeredHere, setAnsweredHere] = useState(false);
  /** 段を閉じた後、問いかけの下に「送りました」を出しておく */
  const [sentNotice, setSentNotice] = useState(false);
  /** 祖父母の画面で残している「おくりました」の場所（今日の答えは "answer"、返事は語りの ID）。残るのは一つだけ（0043） */
  const [noticeAt, setNoticeAt] = useState<string | null>(null);
  const notice = useMemo(() => ({ at: noticeAt, show: setNoticeAt, clear: () => setNoticeAt(null) }), [noticeAt]);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(sentTimer.current), []);
  const retake = useRetakeSlot();
  /** 最後に入り口を読めた時刻（前に戻ったときの読み直しの判断に使う。0051） */
  const loadedAt = useRef<number | null>(null);
  /** 読み込みの回。開いたとき・「もういちど」で進め、前の回の静かな読み直しの結果を捨てる */
  const loadRound = useRef(0);
  /** 今出している入り口（静かな読み直しで替わったかを比べる。undefined は読み込み中） */
  const shown = useRef<Entrance | null | undefined>(undefined);
  shown.current = entrance;
  /** 話している・書いている途中か（届いた時点でも確かめる。読み直しの最中に話し始めたら、その回の結果を捨てる） */
  const busyNow = useRef(false);

  /** 一覧の読み込み（古い結果で新しい結果を上書きしない・読み込み中に乗る。0052） */
  const [feedRead] = useState(() => feedReader(() => api.getFeed()));
  /** 届いた一覧を当てる（返事のタブを開いた時刻も一緒に） */
  const takeFeed = useCallback((value: FeedResult) => {
    setFeed(value.items);
    setServerSeenAt(value.repliesSeenAt ?? null);
    setFeedError(null);
  }, []);
  const loadFeed = useCallback(async (): Promise<FeedItem[] | null> => {
    try {
      const { value, n } = await feedRead.read();
      if (!feedRead.accept(n)) return null;
      takeFeed(value);
      return value.items;
    } catch (e) {
      setFeedError(e);
      return null;
    }
  }, [feedRead, takeFeed]);

  useEffect(() => {
    let alive = true;
    loadRound.current += 1;
    setEntranceError(null);
    setFeedError(null);
    setEntrance(undefined);
    const startedAt = Date.now();
    api.todayEntrance().then(
      (r) => {
        if (!alive) return;
        setEntrance(r.entrance);
        loadedAt.current = startedAt;
      },
      (e) => {
        if (!alive) return;
        setEntrance(null);
        setEntranceError(e);
      },
    );
    void loadFeed();
    return () => {
      alive = false;
    };
  }, [me.id, loadFeed, attempt]);

  const { clear: clearRetake } = retake;
  /**
   * 前に戻ったときの静かな読み直し（0051）。「読み込み中」に戻さず、今の写真を出したまま届いたものに差し替える。
   * 読めなかったものは黙って前のものを残す。入り口が替わったら、前の入り口に結びついた知らせと「とりなおす」を消す
   */
  const refreshing = useRef(false);
  const refresh = useCallback(() => {
    if (refreshing.current || shown.current === undefined) return;
    refreshing.current = true;
    const round = loadRound.current;
    const startedAt = Date.now();
    const current = () => round === loadRound.current && !busyNow.current;
    void refreshQuietly(
      { entrance: () => api.todayEntrance(), feed: () => feedRead.read() },
      {
        entrance: ({ entrance: next }) => {
          if (!current()) return;
          if ((next?.id ?? null) !== (shown.current?.id ?? null)) {
            setAnsweredHere(false);
            clearTimeout(sentTimer.current);
            setSentNotice(false);
            setNoticeAt((at) => (at === "answer" ? null : at));
            clearRetake();
          }
          setEntrance(next);
          setEntranceError(null);
          loadedAt.current = startedAt;
        },
        feed: ({ value, n }) => {
          if (!current()) return;
          if (!feedRead.accept(n)) return;
          takeFeed(value);
        },
      },
    ).finally(() => {
      refreshing.current = false;
    });
  }, [clearRetake, feedRead, takeFeed]);

  // 文字起こしを待つ声の語りがある間の静かな読み直し（0052）。読めなかったら黙って前を残す。
  // 話している・書いている途中でも止めない（語りは ID で描くので、欄・録音・取り直しは一覧の差し替えで壊れない）。
  // ただし返事の欄を開いている語りが消えた一覧は当てない（欄が消えないように）
  const openReplyNow = useRef<string | null>(null);
  openReplyNow.current = openReplyId;
  const followRead = useCallback(
    () =>
      feedRead.shared().then(({ value, n }) => {
        if (!keepsOpenReply(value.items, openReplyNow.current) || !feedRead.accept(n)) return;
        takeFeed(value);
      }),
    [feedRead, takeFeed],
  );
  useTranscriptFollow(feed, followRead);

  const nameOf = (id: string) => view.members.find((m) => m.id === id)?.calledAs ?? "";
  const w = words.screen[variant];

  /** 返事のタブを開いた: 並びを決め、見たことにする（手元のバッジはすぐ消す。サーバーへの知らせは失敗しても黙る。0058） */
  const openReplies = (items: FeedItem[]) => {
    setRepliesOrder(replyGroups(items, me.id).map((g) => g.item.photo.id));
    const latest = latestIncomingAt(items, me.id);
    if (latest !== null) setLocalSeenAt((at) => Math.max(at ?? 0, latest));
  };

  const changeTab = (t: HomeTab) => {
    setOpenReplyId(null);
    if (t === "replies") {
      if (feed) openReplies(feed);
      else setRepliesOrder(null);
      // 見たことをサーバーに知らせてから読み直す（読み直しで届いたものはサーバーでも見たことになっている）。知らせが失敗しても読み直す。
      // 届いたときに、まだ返事のタブにいれば、届いた一覧を開いた時点のものにする
      void api
        .markRepliesSeen()
        .catch(() => {})
        .then(() => loadFeed())
        .then((items) => items && tabNow.current === "replies" && openReplies(items));
    }
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
  // 返事のタブも同じ（開いたときに一覧がまだなければ、届いたときを開いた時点にする）
  useEffect(() => {
    if (tab === "replies" && feed && !repliesOrder) openReplies(feed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openReplies は me.id だけに依る
  }, [tab, feed, repliesOrder]);

  /** 届いたもの・まだ見ていない数（返事のタブ。0058） */
  const unseen = useMemo(
    () => (feed ? unseenCount(feed, me.id, mergeSeenAt(serverSeenAt, localSeenAt)) : 0),
    [feed, me.id, serverSeenAt, localSeenAt],
  );

  const { offer: offerRetake } = retake;
  const onAnswered = useCallback(
    (sent: SentNarration) => {
      setAnsweredHere(true);
      setDockComposing(false);
      clearTimeout(sentTimer.current);
      // 録り直した声なら前の答えを消す。消し終えてから一覧を読み直す（先に読むと、消す前の一覧が後から届きうる）
      const replaced = offerRetake("answer", sent);
      // 祖父母の画面は、次に答え始めるか返事を始めるまで残す（数秒で消すと、目を離していると見逃す。0028、0043）
      if (elder) setNoticeAt("answer");
      // 家族の画面の声は「取り直す」と一緒に残す（4 秒で消さない。0050）。文字は 4 秒
      else if (sent.kind === "text") {
        setSentNotice(true);
        sentTimer.current = setTimeout(() => setSentNotice(false), SENT_NOTICE_MS);
      } else setSentNotice(false);
      void replaced.then(() => loadFeed());
    },
    [loadFeed, elder, offerRetake],
  );
  /** 流れの中でもう一度答え始めたら、前の「送りました」を消す */
  const onFlowComposing = useCallback((on: boolean) => on && setSentNotice(false), []);

  // 今日の入り口への答えの送る状態。段と流れの答え、デモの帯の録音済みファイルが同じものを使う（マイクと同じ送る流れ。0008）
  const answerTarget = useMemo(
    () => (entrance ? { photoId: entrance.photo.id, entranceId: entrance.id, replyToId: null } : null),
    [entrance],
  );
  const answer = useSender(answerTarget ?? NO_TARGET, onAnswered);
  // 録音済みファイルの入口は祖父母の画面の帯だけ（0008）。入り口がなければ送る先がないので出さない
  // 話している・書いている途中は読み直さない（途中のものを壊さない。0051）
  busyNow.current = homeBusy({
    composing,
    dockComposing,
    openReplyId,
    retaking: !!retake.slot?.retaking,
    sending: answer.state === "sending" || answer.state === "failed",
  });
  useResumeRefresh({ busy: busyNow.current, loadedAt: () => loadedAt.current, refresh });
  const demoAudio = elder && answerTarget ? answer.sendVoice : undefined;
  const demoBar = demo && (
    <div className="foot">
      <DemoBar {...demo} onAudioFile={demoAudio} audioDisabled={answer.state === "sending"} />
    </div>
  );
  const retry = () => setAttempt((n) => n + 1);
  const errorView = (e: unknown) => (e ? <LoadError error={e} elder={elder} onRetry={retry} /> : null);
  // 祖父母の画面: 入り口が開けていて一覧だけ読めなかったときは、今日のタブには出さない（開いている写真のそばに「ひらけませんでした」は食い違う）。アルバムで出す
  const todayError = errorView(elder ? entranceError : (entranceError ?? feedError));
  const albumError = errorView(elder ? feedError : (entranceError ?? feedError));
  const answerSlot = retake.slot?.at === "answer" ? retake.slot : null;
  // 録り直している間は「送りました」を出さない（やめたら、ボタンと一緒に戻る）
  const showAnswerNotice = !answerSlot?.retaking && (elder ? noticeAt === "answer" : sentNotice || !!answerSlot);
  // 祖父母の画面: 段が閉じた後の「おくりました」と次のボタンが欄の下の方（画面の外）にあれば、見える所まで動かす（残す知らせを見逃さない。0043）
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!elder || noticeAt !== "answer") return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    noticeRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [elder, noticeAt]);

  let body;
  let dock = null;
  if (tab === "today") {
    const todays = entrance && feed?.find((it) => it.photo.id === entrance.photo.id);
    // もう答えたか（この端末の人の、今日の入り口への語りがある）。答えた後は段に置かず、問いかけの下に戻す。
    // 段で答えている間は、一覧の読み直しで「答えた」に替えない（別の端末から答えた語りが届いても、書きかけ・録音中の段を消さない。0052）
    const answered =
      answeredHere ||
      (!dockComposing &&
        !!entrance &&
        !!todays?.narrations.some((n) => n.entranceId === entrance.id && n.speakerMemberId === me.id));
    // ほかの入力欄（語りへの返事。ボタンを選ぶ前も含む）が開いている間は段を描かない。段の中で書いている間は段を残す（書きかけを消さない）
    const place = answerPlace(!!entrance, answered, !dockComposing && (composing || openReplyId !== null));
    // 祖父母の画面では、今の話者の呼ばれ方を答えのボタンのすぐそばにも出す（0008）
    const who = elder ? me.calledAs : undefined;
    if (place === "dock" && answerTarget) {
      dock = (
        <div className="home-dock">
          <ReplyBox target={answerTarget} sender={answer} who={who} onComposing={setDockComposing} />
        </div>
      );
    }
    body = (
      <div className="home-scroll">
        <main className="stack home">
          {elder ? (
            // 祖父母の画面にメニューは置かない（家族のことは触れない。0036）。今の話者の呼ばれ方だけ
            <header className="elder-head">
              <p className="elder-name">{me.calledAs}</p>
            </header>
          ) : (
            <nav className="top" aria-label={words.home.menuLabel}>
              <button type="button" onClick={() => navigate("/photos")}>
                {words.home.menuPhotos}
              </button>
              <button type="button" onClick={() => navigate("/family")}>
                {words.home.menuFamily}
              </button>
            </nav>
          )}

          {entrance === undefined && <p>{words.loading}</p>}
          {/* 入り口がない（家族の写真がまだ一枚もない）ときは一行だけ。家族には入れ方を、祖父母には待てばよいことを言う（0010 の追記） */}
          {entrance === null && !entranceError && <p className={elder ? undefined : "sub"}>{w.noEntrance}</p>}
          {entrance && (
            <section className="stack">
              <EntranceView entrance={entrance} members={view.members} variant={variant} />
              <div aria-live="polite" ref={noticeRef}>
                {showAnswerNotice && <p className="done">{w.sent}</p>}
              </div>
              {place === "flow" && answerTarget && (
                <ReplyBox target={answerTarget} sender={answer} who={who} onComposing={onFlowComposing} retakeAt="answer" />
              )}
            </section>
          )}

          {todayError}

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
  } else if (tab === "replies") {
    const groups = feed ? replyGroups(feed, me.id) : [];
    body = (
      <>
        {feedError && <div className="album-error">{errorView(feedError)}</div>}
        <Replies
          groups={repliesOrder ? keepOrderNewFirst(repliesOrder, groups, (g) => g.item.photo.id) : groups}
          nameOf={nameOf}
          openReplyId={openReplyId}
          onOpenReply={setOpenReplyId}
          onSent={() => void loadFeed()}
          loading={!feed}
          footer={demoBar}
        />
      </>
    );
  } else {
    const items = feed ? (albumOrder ? keepOrder(albumOrder, feed, (it) => it.photo.id) : feed) : [];
    body = (
      <div className="home-album">
        {albumError && <div className="album-error">{albumError}</div>}
        <Album
          items={items}
          nameOf={nameOf}
          currentId={albumCurrent}
          onCurrent={setAlbumCurrent}
          onSent={() => void loadFeed()}
          onPhotosChanged={() => void loadFeed()}
          composing={composing}
          footer={demoBar}
        />
      </div>
    );
  }

  return (
    <ScreenContext.Provider value={variant}>
      <SentNoticeContext.Provider value={elder ? notice : null}>
      <RetakeContext.Provider value={retake}>
      <ComposingContext.Provider value={composingSet}>
        <div className={elder ? "home-shell elder" : "home-shell"}>
          {body}
          {dock}
          <TabBar tab={tab} onChange={changeTab} composing={composing} unseen={unseen} />
        </div>
      </ComposingContext.Provider>
      </RetakeContext.Provider>
      </SentNoticeContext.Provider>
    </ScreenContext.Provider>
  );
}

/**
 * 読み込めなかったとき。家族の画面は種類ごとの文。祖父母の画面は、祖父母にできること（押す・家族に知らせる）を言う（0028）
 */
function LoadError({ error, elder, onRetry }: { error: unknown; elder: boolean; onRetry: () => void }) {
  if (!elder) return <ErrorLine text={errorText(error)} />;
  const e = words.elder.errors;
  if (error instanceof ApiError && error.kind === "unauthorized") return <p role="alert">{e.unauthorized}</p>;
  return (
    <div className="stack" role="alert">
      <p>{e.loadFailed}</p>
      <button type="button" className="primary" onClick={onRetry}>
        {words.elder.again}
      </button>
    </div>
  );
}
