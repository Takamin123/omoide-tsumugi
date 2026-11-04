// 家族の画面（スマホ）と祖父母の画面（スマホとタブレット）: 下のタブ「今日」「アルバム」。開いたときは常に「今日」（最後に見たタブを端末に覚えない）。
// 祖父母の画面も同じ形で、違うのは言葉と大きさだけ（variant。lib/screen.ts、styles.css の .home-shell.elder。0043）。
// 今日: 上にメニュー（祖父母の画面では呼ばれ方だけ）、自分の今日の入り口、その下に入り口の写真の語りと返事。答える前は「声で」「文字で」を欄の外のタブのすぐ上の段に置く（0034）。
// アルバム: 語りのある写真の帯と、写真ごとの語りの縦の欄（parts/Album.tsx）。上にメニューは置かない。
// 文字や声で答えている間は、下のタブを描かない（lib/composing.ts）。
// 声を送った直後は「送りました」の下に「とりなおす」（画面に一つだけ。lib/retake.ts。0050）。前の声は録り直した声が送れたときに消すので、
// 取り直しの間も今日の入り口は「答えた」のまま（段は流れのまま。録音中に欄が作り直されない）。
// 祖父母が開いても読める大きさにする。家族の言葉は明朝。声は「聞く」のボタンで流し、誰の声かと長さは注「ばあばの声（13秒）」に出す（0045）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entrance, FamilyView, Member } from "../../shared/api";
import { api, ApiError } from "../lib/api";
import { keepOrder } from "../lib/album";
import { ComposingContext, ComposingSet } from "../lib/composing";
import { errorText } from "../lib/errors";
import { answerPlace } from "../lib/pure";
import { RetakeContext, useRetakeSlot } from "../lib/retake";
import { ScreenContext, SentNoticeContext, type ScreenVariant } from "../lib/screen";
import { SENT_NOTICE_MS, useSender, type SentNarration } from "../lib/useSender";
import { navigate } from "../lib/route";
import { Album, type AlbumItem } from "../parts/Album";
import { DemoBar, type DemoProps } from "../parts/DemoBar";
import { EntranceView } from "../parts/EntranceView";
import { ErrorLine } from "../parts/ErrorLine";
import { Narrations } from "../parts/Narrations";
import { ReplyBox } from "../parts/ReplyBox";
import { TabBar, type HomeTab } from "../parts/TabBar";
import { words } from "../words";

type Props = { view: FamilyView; me: Member; demo: DemoProps | null; variant?: ScreenVariant };

/** 入り口がまだないときの、送る先の空の形（送ることはない） */
const NO_TARGET = { photoId: "", entranceId: null, replyToId: null };

export function Home({ view, me, demo, variant = "family" }: Props) {
  const elder = variant === "elder";
  const [tab, setTab] = useState<HomeTab>("today");
  const [entrance, setEntrance] = useState<Entrance | null | undefined>(undefined);
  const [feed, setFeed] = useState<AlbumItem[] | null>(null);
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

  const loadFeed = useCallback(async (): Promise<AlbumItem[] | null> => {
    try {
      const { items } = await api.getFeed();
      setFeed(items);
      setFeedError(null);
      return items;
    } catch (e) {
      setFeedError(e);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setEntranceError(null);
    setFeedError(null);
    setEntrance(undefined);
    api.todayEntrance().then(
      (r) => alive && setEntrance(r.entrance),
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

  const nameOf = (id: string) => view.members.find((m) => m.id === id)?.calledAs ?? "";
  const w = words.screen[variant];

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
    // もう答えたか（この端末の人の、今日の入り口への語りがある）。答えた後は段に置かず、問いかけの下に戻す
    const answered =
      answeredHere ||
      (!!entrance && !!todays?.narrations.some((n) => n.entranceId === entrance.id && n.speakerMemberId === me.id));
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
          {/* 入り口がないときは何も出さない（催促の文を出さない。祖父母には写真を足す手段がなく、行き止まりの文になる。0010） */}
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
          <TabBar tab={tab} onChange={changeTab} composing={composing} />
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
