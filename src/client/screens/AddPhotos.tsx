// /photos: 写真を家族に共有する（棚へのまとめ登録。どの写真ともつながらない）。一枚ずつ順に、EXIF → SHA-256 → 縮小 → 送る（lib/upload.ts）
// 下に、自分が共有した写真の数の見出しと小さい写真の一覧（新しい順）。送り終えたら読み直す。0 枚なら出さない（0053）
// 一覧の写真を押すと選び、一覧の下にその写真を大きめに（押すと拡大の画面 0040）、付いている語り（聞くだけ）、「言葉を添える」の欄を出す（0054）。
// 添えた言葉は、どの入り口にも返事にもつながらない普通の語り（entranceId・replyToId とも null）。送れたら語りを読み直し、一覧の印を替える。
// 一覧の印: 誰かの言葉が付いた写真に吹き出しの小さな印（読み上げは「n枚目（言葉あり）」）。言葉の有無は /api/feed（語りのある写真の一覧）で決める
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedNarration, Member, Photo } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { emptyTally, tallyOne, type UploadTally } from "../lib/pure";
import { RetakeContext, useRetakeSlot } from "../lib/retake";
import { InitialsContext } from "../lib/screen";
import { initialsFor } from "../lib/initials";
import { navigate } from "../lib/route";
import { SENT_NOTICE_MS, type SentNarration } from "../lib/useSender";
import { shelfOutcome, uploadOne } from "../lib/upload";
import { ErrorLine } from "../parts/ErrorLine";
import { Narrations } from "../parts/Narrations";
import { ReplyBox } from "../parts/ReplyBox";
import { ZoomablePhoto } from "../parts/ZoomablePhoto";
import { words } from "../words";

export function AddPhotos({ me, members = [] }: { me: Member; members?: readonly Member[] }) {
  const [tally, setTally] = useState<UploadTally | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = words.photos;
  const mine = useMyPhotos(me.id);
  const told = useToldPhotos();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 読み直した一覧にない写真は選んでいないことにする
  const selected = mine.photos.find((p) => p.id === selectedId) ?? null;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.calledAs ?? "";
  /** 話者の頭文字の丸（0061） */
  const initials = useMemo(() => initialsFor(members), [members]);

  async function onPick(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    let t = emptyTally(files.length);
    setTally(t);
    try {
      for (const file of files) {
        t = tallyOne(t, shelfOutcome(await uploadOne(file, undefined)));
        setTally(t);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      // 送り終えたら（途中で失敗しても）、共有した写真の数と一覧を読み直す
      mine.reload();
    }
  }

  return (
    <InitialsContext.Provider value={initials}>
    <main className="stack">
      <nav className="top">
        <button type="button" onClick={() => navigate("/")} disabled={busy}>
          {words.home.menuHome}
        </button>
      </nav>
      <h1>{w.title}</h1>
      <label className={`button primary${busy ? " disabled" : ""}`} aria-disabled={busy}>
        {w.pick}
        <input
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void onPick(files);
          }}
        />
      </label>
      {tally && (
        <div className="stack" aria-live="polite">
          <p>{w.progress(tally.done, tally.total)}</p>
          <progress max={tally.total} value={tally.done} style={{ width: "100%", height: "1.5rem" }} />
          {!busy && (
            <>
              {tally.added > 0 && (
                <>
                  <p className="sub">{w.added(tally.added)}</p>
                  <p className="sub">{w.delivery}</p>
                </>
              )}
              {tally.duplicate > 0 && <p className="sub">{w.duplicate(tally.duplicate)}</p>}
              {tally.unreadable > 0 && <p className="sub">{w.unreadable(tally.unreadable)}</p>}
              {tally.failed > 0 && <p className="sub">{w.failed(tally.failed)}</p>}
            </>
          )}
        </div>
      )}
      <ErrorLine text={error} />
      <SharedPhotos photos={mine.photos} told={told.byPhoto} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      {selected && (
        <AddWords
          key={selected.id}
          photo={selected}
          narrations={told.byPhoto.get(selected.id) ?? []}
          nameOf={nameOf}
          onSent={told.reload}
        />
      )}
    </main>
    </InitialsContext.Provider>
  );
}

/**
 * 自分が共有した写真（GET /api/photos を持ち主で絞る）。新しい順（サーバーは登録の古い順で返す）。
 * 読めなかったら前の一覧のまま（文を出さない）。後から届いた古い読み込みは捨てる
 */
function useMyPhotos(memberId: string) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    api
      .listPhotos(memberId)
      .then((r) => {
        if (n === seq.current) setPhotos(newestFirst(r.photos));
      })
      .catch(() => {});
  }, [memberId]);
  useEffect(() => {
    reload();
    return () => {
      seq.current++;
    };
  }, [reload]);
  return { photos, reload };
}

/** 登録の古い順の一覧を、新しい順に */
export const newestFirst = (photos: readonly Photo[]): Photo[] => [...photos].reverse();

/**
 * 語りのある写真の語り（GET /api/feed。家族の誰かの言葉が付いた写真だけが並ぶ）。写真の ID → 語り。
 * 読めなかったら前のまま（文を出さない）。後から届いた古い読み込みは捨てる
 */
function useToldPhotos() {
  const [byPhoto, setByPhoto] = useState<ReadonlyMap<string, FeedNarration[]>>(new Map());
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    api
      .getFeed()
      .then((r) => {
        if (n === seq.current) setByPhoto(toldByPhoto(r.items));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    reload();
    return () => {
      seq.current++;
    };
  }, [reload]);
  return { byPhoto, reload };
}

/** feed の並びから、写真の ID → 語り（語りが一つもない写真は入れない） */
export const toldByPhoto = (items: readonly { photo: Photo; narrations: FeedNarration[] }[]): Map<string, FeedNarration[]> =>
  new Map(items.filter((it) => it.narrations.length > 0).map((it) => [it.photo.id, it.narrations]));

type SharedProps = {
  photos: readonly Photo[];
  /** 語りのある写真（写真の ID → 語り）。印を付ける */
  told?: ReadonlyMap<string, unknown>;
  selectedId?: string | null;
  onSelect?: (photoId: string) => void;
};

/**
 * 共有した写真の見出し（数）と小さい写真の一覧。0 枚なら何も出さない（0053）。
 * 押すとその写真を選ぶ（0054）。言葉の付いた写真に小さな印、選んだ写真に太い枠（aria-current）
 */
export function SharedPhotos({ photos, told, selectedId = null, onSelect }: SharedProps) {
  if (photos.length === 0) return null;
  return (
    <section className="stack">
      <h2>{words.photos.shared(photos.length)}</h2>
      <div className="shared-photos">
        {photos.map((p, i) => {
          const hasWords = told?.has(p.id) ?? false;
          return (
            <div key={p.id} className="shared-photo">
              <button
                type="button"
                className="shared-pick"
                aria-label={words.photos.sharedOne(i + 1, hasWords)}
                aria-current={p.id === selectedId ? "true" : undefined}
                onClick={() => onSelect?.(p.id)}
              >
                <img className="photo" src={p.imageUrl} alt="" loading="lazy" decoding="async" />
                {hasWords && <WordsMark />}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 言葉のある写真の印（吹き出し）。白い丸の上に線で描く（写真の色に紛れず、色だけに頼らない）。読み上げは名前の「（言葉あり）」 */
function WordsMark() {
  return (
    <span className="words-mark" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16v11H10l-5 4v-4H4z" />
      </svg>
    </span>
  );
}

/**
 * 選んだ写真に言葉を添える（0054）。大きめの写真（押すと拡大）→ 付いている語り（聞くだけ。返事はアルバムで）→ 見出しと答えの欄。
 * 答えの欄は今日の答え・返事と同じ部品（声で話す・文字で書く・録り直す）。送る先はこの写真だけ（入り口にも語りにもつながない）
 */
export function AddWords({
  photo,
  narrations,
  nameOf,
  onSent,
}: {
  photo: Photo;
  narrations: FeedNarration[];
  nameOf: (memberId: string) => string;
  onSent: () => void;
}) {
  const retake = useRetakeSlot();
  const target = useMemo(() => ({ photoId: photo.id, entranceId: null, replyToId: null }), [photo.id]);
  const [sentNotice, setSentNotice] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const ref = useRef<HTMLElement>(null);
  // 選んだら、写真が見えるところまで送る（動きを減らす設定ではその場で）
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);
  const { offer } = retake;
  const onAdded = useCallback(
    (sent: SentNarration) => {
      clearTimeout(timer.current);
      // 録り直した声なら、前の語りを消し終えてから読み直す（先に読むと消す前の一覧が後から届きうる）
      const replaced = offer(photo.id, sent);
      // 文字は「送りました」をしばらく。声は「録り直す」と一緒に残す（0050）
      if (sent.kind === "text") {
        setSentNotice(true);
        timer.current = setTimeout(() => setSentNotice(false), SENT_NOTICE_MS);
      } else setSentNotice(false);
      void replaced.then(onSent);
    },
    [offer, photo.id, onSent],
  );
  /** もう一度話し始めた・書き始めたら、前の「送りました」を消す */
  const onComposing = useCallback((on: boolean) => on && setSentNotice(false), []);
  const slot = retake.slot?.at === photo.id ? retake.slot : null;
  const showNotice = !slot?.retaking && (sentNotice || !!slot);
  return (
    <RetakeContext.Provider value={retake}>
      <section ref={ref} className="stack add-words">
        <ZoomablePhoto photo={photo} variant="family" />
        {narrations.length > 0 && (
          <div className="stack">
            <Narrations
              narrations={narrations}
              nameOf={nameOf}
              openReplyId={null}
              onOpenReply={() => {}}
              onSent={onSent}
              canReply={false}
            />
          </div>
        )}
        <h3>{words.photos.addWords}</h3>
        <div aria-live="polite">{showNotice && <p className="done">{words.home.sent}</p>}</div>
        <ReplyBox
          target={target}
          onSent={onAdded}
          onComposing={onComposing}
          retakeAt={photo.id}
        />
      </section>
    </RetakeContext.Provider>
  );
}
