// 家族の画面のアルバム: 上に写真の帯（黒い台紙、白い縁、淡い写真コーナー。左右の矢印は写真の両脇に重ねる）、その下に何枚目かの一行、
// 下に写真ごとの語りの縦の欄。
// 帯と語りは連動する（lib/album.ts）。縦に読んで次の写真の語りが上に来たら帯が一度だけ切り替わり、
// 帯をめくるか矢印を押すと語りがその写真の頭まで動く。往復はしない。動きを減らす設定では動かさずに切り替える。
// 出すのは家族の語り・返事・撮影日だけ。語りのある写真がなければ何も出さない（催促や状態の文を出さない）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FeedNarration, Photo } from "../../shared/api";
import { arrows, bandIndex, clampIndex, sectionAtTop, SyncGate } from "../lib/album";
import { formatTakenDate } from "../lib/pure";
import { words } from "../words";
import { Narrations } from "./Narrations";
import { PhotoImage } from "./PhotoImage";

export type AlbumItem = { photo: Photo; narrations: FeedNarration[] };

type Props = {
  items: AlbumItem[];
  nameOf: (memberId: string) => string;
  /** 見ている写真の ID。null や一覧にない ID なら一枚目 */
  currentId: string | null;
  onCurrent: (photoId: string) => void;
  onSent: () => void;
  /** 返事の入力欄が開いている間は、写真の帯をたたむ（打つ欄を広くする） */
  composing: boolean;
  /** 語りの欄の一番下に置くもの（デモの帯） */
  footer?: ReactNode;
};

/** 語りの節の頭が、欄の上からこの距離に入ったら「上に来た」とみなす（欄の高さの 1/4、最大 96px） */
const topZone = (paneHeight: number) => Math.min(paneHeight * 0.25, 96);

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Album({ items, nameOf, currentId, onCurrent, onSent, composing, footer }: Props) {
  const count = items.length;
  const found = items.findIndex((it) => it.photo.id === currentId);
  const index = found < 0 ? 0 : found;
  /** スクロールの手当ての中で使う今の番号（state の更新を待たない） */
  const indexRef = useRef(index);
  indexRef.current = index;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const bandRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLElement>(null);
  const gate = useMemo(() => new SyncGate(), []);
  useEffect(() => () => gate.dispose(), [gate]);
  // 返事の入力欄を閉じて帯が戻ると欄の高さが変わり、ブラウザが位置を詰めることがある。その動きで写真を替えない
  useEffect(() => {
    if (!composing) gate.moving("text");
  }, [composing, gate]);
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  /** 最後の写真の語りが欄の上まで届くための下の余白 */
  const [tail, setTail] = useState(0);

  const w = words.home;
  const sections = () => Array.from(textRef.current?.querySelectorAll<HTMLElement>("[data-photo]") ?? []);

  const moveBand = (i: number, animate: boolean) => {
    const band = bandRef.current;
    if (!band) return;
    gate.moving("band");
    band.scrollTo({ left: i * band.clientWidth, behavior: animate && !reducedMotion() ? "smooth" : "auto" });
  };
  const moveText = (i: number, animate: boolean) => {
    const text = textRef.current;
    const sec = sections()[i];
    if (!text || !sec) return;
    gate.moving("text");
    text.scrollTo({ top: sec.offsetTop, behavior: animate && !reducedMotion() ? "smooth" : "auto" });
  };
  const select = (i: number) => {
    const it = itemsRef.current[i];
    if (!it || i === indexRef.current) return;
    indexRef.current = i;
    onCurrent(it.photo.id);
  };
  const go = (i: number) => {
    const to = clampIndex(i, itemsRef.current.length);
    select(to);
    moveBand(to, true);
    moveText(to, true);
  };

  /**
   * 言葉の糸: 元の語りの位置へ縦に移り、そこにフォーカスを置く（0035）。ID で探す。
   * 元の語りは今は必ず同じ写真にある（0023）が、別の写真にあれば帯もその写真へ動かす
   */
  const jumpTo = (narrationId: string) => {
    const text = textRef.current;
    const target = text?.querySelector<HTMLElement>(`[data-narration="${CSS.escape(narrationId)}"]`);
    if (!text || !target) return;
    const sec = target.closest<HTMLElement>("[data-photo]");
    const i = sec ? sections().indexOf(sec) : -1;
    if (i >= 0 && i !== indexRef.current) {
      select(i);
      moveBand(i, true);
    }
    gate.moving("text");
    // 上に少し余白を残す（話者名が欄の縁に付かないように）
    text.scrollTo({ top: Math.max(0, target.offsetTop - 16), behavior: reducedMotion() ? "auto" : "smooth" });
    // 移ってきたときだけフォーカスを置けるようにする（ふだん語りを触ってもフォーカスの枠を出さない）。離れたら外す
    target.tabIndex = -1;
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    target.focus({ preventScroll: true });
  };

  // 開いたとき（タブを戻ったときも）と並びが変わったとき（開いた直後に読み直した一覧が届いた）、
  // 見ていた写真の位置に動かさずに合わせる。返事の送信後の読み直しでは並びは変わらない
  const orderKey = items.map((it) => it.photo.id).join(" ");
  useLayoutEffect(() => {
    moveBand(indexRef.current, false);
    moveText(indexRef.current, false);
  }, [orderKey]);

  // 帯の幅が変わったら（向きを変えた、帯をたたんで戻した）、今の写真に合わせ直す。下の余白も測り直す
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const text = textRef.current;
      const last = lastRef.current;
      setTail(text && last ? Math.max(0, text.clientHeight - last.offsetHeight) : 0);
    };
    const ro = new ResizeObserver(() => {
      moveBand(indexRef.current, false);
      measure();
    });
    for (const el of [bandRef.current, textRef.current, lastRef.current]) if (el) ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [count, composing]);

  if (count === 0) {
    return footer ? <div className="album-text album-empty">{footer}</div> : null;
  }

  const can = arrows(index, count);

  return (
    <div className="album">
      <section className="album-band" aria-label={w.albumBandLabel} hidden={composing}>
        {/* 矢印は写真の両脇の台紙の上に重ねる（矢印だけの行を置かず、語りの欄に縦を残す。0034） */}
        <div className="album-stage">
          <div
            ref={bandRef}
            className="album-strip"
            onScroll={(e) => {
              if (!gate.scrolled("band")) return;
              const band = e.currentTarget;
              const i = bandIndex(band.scrollLeft, band.clientWidth, itemsRef.current.length);
              if (i !== indexRef.current) {
                select(i);
                moveText(i, true);
              }
            }}
            onTouchStart={() => gate.touched("band")}
            onTouchEnd={() => gate.released()}
            onTouchCancel={() => gate.released()}
            onWheel={() => gate.touched("band")}
          >
            {items.map((it, i) => (
              <div key={it.photo.id} className="album-slide" aria-hidden={i !== index}>
                <div className="album-print">
                  <div className="album-corners">
                    <PhotoImage photo={it.photo} />
                    <span className="corner tl" aria-hidden="true" />
                    <span className="corner tr" aria-hidden="true" />
                    <span className="corner bl" aria-hidden="true" />
                    <span className="corner br" aria-hidden="true" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="album-arrow prev" aria-label={w.albumPrev} disabled={!can.prev} onClick={() => go(index - 1)}>
            <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button type="button" className="album-arrow next" aria-label={w.albumNext} disabled={!can.next} onClick={() => go(index + 1)}>
            <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <p className="album-count" aria-live="polite">
          {w.albumPositionParts(index + 1, count).map((part, k) => (
            <span key={k}>
              {k > 0 && " "}
              {part}
            </span>
          ))}
        </p>
      </section>
      <div
        ref={textRef}
        className="album-text"
        onScroll={(e) => {
          // 入力中（帯をたたんでいる間）は、欄の高さが変わって動いても帯を切り替えない
          if (!gate.scrolled("text") || composing) return;
          const text = e.currentTarget;
          const offsets = sections().map((s) => s.offsetTop);
          const i = sectionAtTop(offsets, text.scrollTop, topZone(text.clientHeight));
          if (i !== indexRef.current) {
            select(i);
            moveBand(i, true);
          }
        }}
        onTouchStart={() => gate.touched("text")}
        onWheel={() => gate.touched("text")}
      >
        {items.map((it, i) => {
          const taken = formatTakenDate(it.photo.takenAt);
          return (
            // 撮影日がなければ線だけ（「撮影日なし」は出さない）。区切りは読み上げの名前「4枚のうち 2枚」で伝える
            <section
              key={it.photo.id}
              data-photo={it.photo.id}
              className="album-section"
              aria-label={w.albumPosition(i + 1, count)}
              ref={i === count - 1 ? lastRef : undefined}
            >
              <p className="album-date">
                {taken && <span>{taken}</span>}
                <span className="album-rule" aria-hidden="true" />
              </p>
              <Narrations
                narrations={it.narrations}
                nameOf={nameOf}
                openReplyId={openReplyId}
                onOpenReply={setOpenReplyId}
                onSent={onSent}
                onJump={jumpTo}
              />
            </section>
          );
        })}
        <div className="album-tail" style={{ minHeight: tail }}>
          {footer}
        </div>
      </div>
    </div>
  );
}
