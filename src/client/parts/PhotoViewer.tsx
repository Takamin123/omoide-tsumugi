// 写真の拡大の画面: 写真だけの黒い画面と、下に横いっぱいの「とじる」一つ（0040）。
// 入り口で寄せている写真も、ここでは全体を出す（object-position を使わない）。
// 指で広げる・二度押しで広げる・広げたまま指でずらす。画面全体（ボタンや文字）は広げない。
// 開くときは押した写真の位置から広がり、閉じると元の位置へ縮んで戻る（transform と opacity だけ、0.25 秒）。
// 動きを減らす設定では動かさない。
// 写真の記録（撮影日・場所。0047）は、入り口と同じ形（.photo-facts）で閉じるボタンの上に置く。写真には重ねない（0040 の追記）。
// 今は一枚だけを見せる。むすびで何枚かをめくるときは、photo を並びに替え、stage の横の操作を足す。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Photo } from "../../shared/api";
import { formatPlace, formatTakenDate } from "../lib/pure";
import {
  clampView,
  containBox,
  distance,
  DOUBLE_TAP_MS,
  doubleTapView,
  flipFrom,
  IDENTITY,
  midpoint,
  TAP_SLOP,
  viewTransform,
  zoomAt,
  type Box,
  type View,
} from "../lib/zoom";

/** 開く・閉じる動きの長さ（ミリ秒） */
export const VIEWER_MOTION_MS = 250;

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Props = {
  photo: Photo;
  /** 押した写真の要素。開く・閉じる動きの元の位置。見えなくなっていれば（大きさ 0）、動きは透明度だけにする */
  origin: () => HTMLElement | null;
  /** 閉じる動きを始める（親が立てる） */
  closing: boolean;
  /** 閉じるボタン・Esc で呼ぶ。親は戻る操作の履歴をたたんでから closing を立てる */
  onRequestClose: () => void;
  /** 閉じる動きが終わった */
  onClosed: () => void;
  closeLabel: string;
  /** 祖父母の画面から開いたとき（body に置くので、祖父母の大きさの定数 .elder をここで付ける。0059） */
  elder?: boolean;
  label: string;
};

type Phase = "start" | "open" | "closing";

export function PhotoViewer({ photo, origin, closing, onRequestClose, onClosed, closeLabel, label, elder = false }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** 写真の、拡大していないときの位置と大きさ（stage の中） */
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState<View>(IDENTITY);
  const [phase, setPhase] = useState<Phase>("start");
  /** 指で動かしている間は transition を付けない（指に付いてくる） */
  const [gesturing, setGesturing] = useState(false);
  const animate = !reducedMotion();

  const measure = useCallback((): { box: Box; offset: { left: number; top: number } } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    const b = containBox({ width: photo.width, height: photo.height }, { left: 0, top: 0, width: r.width, height: r.height });
    return { box: b, offset: { left: r.left, top: r.top } };
  }, [photo.width, photo.height]);

  /** 押した写真の位置に重ねる transform（画面上の位置で比べる） */
  const fromOrigin = useCallback(
    (m: { box: Box; offset: { left: number; top: number } }): View | null => {
      const r = origin()?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return null;
      const to = { ...m.box, left: m.box.left + m.offset.left, top: m.box.top + m.offset.top };
      return flipFrom({ left: r.left, top: r.top, width: r.width, height: r.height }, to);
    },
    [origin],
  );

  // 開く: 押した写真の位置に重ねて描き、次の描画で大きい姿へ動かす
  useLayoutEffect(() => {
    const m = measure();
    if (!m) return;
    setBox(m.box);
    if (!animate) {
      setPhase("open");
      return;
    }
    const from = fromOrigin(m);
    setView(from ?? IDENTITY);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setView(IDENTITY);
        setPhase("open");
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  // 閉じる: 元の位置へ縮めて、動きが終わったら知らせる
  useEffect(() => {
    if (!closing) return;
    setGesturing(false);
    setPhase("closing");
    if (!animate) {
      onClosed();
      return;
    }
    const m = measure();
    const from = m ? fromOrigin(m) : null;
    setView(from ?? IDENTITY);
    const t = setTimeout(onClosed, VIEWER_MOTION_MS);
    return () => clearTimeout(t);
  }, [closing]);

  // 向きを変えた・大きさが変わったら、写真の枠を測り直す（拡大は戻す）
  useEffect(() => {
    const on = () => {
      const m = measure();
      if (m) {
        setBox(m.box);
        setView(IDENTITY);
      }
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [measure]);

  // 開いている間は後ろのページを動かさない。閉じるボタンにフォーカスを置く。Esc でも閉じる
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRequestClose();
      // フォーカスを拡大の画面の外へ出さない（押せるのは閉じるボタンだけ）
      if (e.key === "Tab") {
        e.preventDefault();
        closeRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onRequestClose]);

  // ---- 指の操作 ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; start: { x: number; y: number }; view: View }
    | { kind: "pinch"; dist: number; mid: { x: number; y: number }; view: View }
    | null
  >(null);
  const tap = useRef<{ at: number; x: number; y: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  /** 写真の中心からの位置 */
  const rel = (p: { x: number; y: number }) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || !box) return { x: 0, y: 0 };
    return { x: p.x - (stage.left + box.left + box.width / 2), y: p.y - (stage.top + box.top + box.height / 2) };
  };
  const clamp = (v: View) => {
    const stage = stageRef.current;
    if (!stage || !box) return v;
    return clampView(v, box, { width: stage.clientWidth, height: stage.clientHeight });
  };

  const begin = () => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      gesture.current = { kind: "pinch", dist: distance(pts[0]!, pts[1]!), mid: midpoint(pts[0]!, pts[1]!), view: viewRef.current };
    } else if (pts.length === 1) {
      gesture.current = { kind: "pan", start: pts[0]!, view: viewRef.current };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "open") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap.current = pointers.current.size === 1 ? { at: e.timeStamp, x: e.clientX, y: e.clientY, moved: false } : null;
    setGesturing(true);
    begin();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap.current && distance(tap.current, { x: e.clientX, y: e.clientY }) > TAP_SLOP) tap.current.moved = true;
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.kind === "pinch" && pts.length >= 2) {
      const mid = midpoint(pts[0]!, pts[1]!);
      const scale = g.view.scale * (distance(pts[0]!, pts[1]!) / g.dist);
      const zoomed = zoomAt(g.view, scale, rel(g.mid));
      // 倍率は 1〜4 に収める（clampView）
      setView(clamp({ ...zoomed, x: zoomed.x + mid.x - g.mid.x, y: zoomed.y + mid.y - g.mid.y }));
    } else if (g.kind === "pan" && g.view.scale > 1.01) {
      setView(clamp({ ...g.view, x: g.view.x + e.clientX - g.start.x, y: g.view.y + e.clientY - g.start.y }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const t = tap.current;
    if (pointers.current.size === 0) {
      setGesturing(false);
      gesture.current = null;
      // 指を離したら、収まる所へ滑らせる（広げすぎ・縮めすぎを戻す）
      const settled = clamp(viewRef.current.scale < 1 ? IDENTITY : viewRef.current);
      if (t && !t.moved && e.timeStamp - t.at < DOUBLE_TAP_MS) {
        const prev = lastTap.current;
        if (prev && e.timeStamp - prev.at < DOUBLE_TAP_MS && distance(prev, t) < TAP_SLOP * 3) {
          lastTap.current = null;
          tap.current = null;
          setView(clamp(doubleTapView(viewRef.current, rel(t))));
          return;
        }
        lastTap.current = { at: e.timeStamp, x: t.x, y: t.y };
      }
      setView(settled);
    } else {
      begin();
    }
    tap.current = null;
  };

  const shown = phase === "open";
  const style = box
    ? {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        transform: viewTransform(view),
        // 最初の描画（押した写真の位置に重ねる）は動かさない。そこから大きい姿へ動かす
        transition: animate && !gesturing && phase !== "start" ? `transform ${VIEWER_MOTION_MS}ms ease` : "none",
      }
    : { visibility: "hidden" as const };
  // 写真の記録。なければ行を出さない（「なし」は出さない。0047）
  const taken = formatTakenDate(photo.takenAt);
  const place = formatPlace(photo.place);
  const fade = { opacity: shown ? 1 : 0, transition: animate ? `opacity ${VIEWER_MOTION_MS}ms ease` : "none" };

  return (
    <div className={elder ? "viewer elder" : "viewer"} role="dialog" aria-modal="true" aria-label={label}>
      <div className="viewer-backdrop" style={fade} aria-hidden="true" />
      <div
        ref={stageRef}
        className="viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img className="viewer-photo" src={photo.imageUrl} width={photo.width} height={photo.height} alt="" draggable={false} style={style} />
      </div>
      <div className="viewer-foot" style={fade}>
        {(taken || place) && (
          <p className="photo-facts viewer-facts">
            {taken && <span>{taken}</span>}
            {place && <span>{place}</span>}
          </p>
        )}
        <button ref={closeRef} type="button" className="primary viewer-close" onClick={onRequestClose} disabled={phase === "closing"}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
