// 写真の拡大の画面の計算。DOM に頼らない（test/client/ から Node で確かめる）。
// 写真の姿は { scale, x, y }（transform: translate(x, y) scale(scale)。原点は写真の中心）で持つ。

export type Box = { left: number; top: number; width: number; height: number };
export type View = { scale: number; x: number; y: number };

export const IDENTITY: View = { scale: 1, x: 0, y: 0 };
/** 拡大の上限と、二度押しで広げる倍率 */
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
/** 二度押しとみなす間（ミリ秒）と、指の動きの許し（px） */
export const DOUBLE_TAP_MS = 300;
export const TAP_SLOP = 10;

/** 写真の縦横比を保って、枠の中に全体が入る大きさと位置（object-fit: contain と同じ） */
export function containBox(natural: { width: number; height: number }, frame: Box): Box {
  const r = Math.min(frame.width / natural.width, frame.height / natural.height);
  const width = natural.width * r;
  const height = natural.height * r;
  return { left: frame.left + (frame.width - width) / 2, top: frame.top + (frame.height - height) / 2, width, height };
}

/**
 * 開く・閉じる動き（FLIP）: 大きい姿（to）を、押した写真の位置（from）に重ねて見せる transform。
 * 縦横比が違っても歪めないよう、倍率は一つ（幅と高さの小さい方）にする
 */
export function flipFrom(from: Box, to: Box): View {
  const scale = Math.min(from.width / to.width, from.height / to.height);
  const x = from.left + from.width / 2 - (to.left + to.width / 2);
  const y = from.top + from.height / 2 - (to.top + to.height / 2);
  return { scale, x, y };
}

/** 拡大した写真が枠の外にずれすぎないよう、ずらしを抑える（拡大していないときは真ん中） */
export function clampView(v: View, img: { width: number; height: number }, frame: { width: number; height: number }): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, v.scale));
  const maxX = Math.max(0, (img.width * scale - frame.width) / 2);
  const maxY = Math.max(0, (img.height * scale - frame.height) / 2);
  return { scale, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
}

/**
 * ある点（写真の中心からの位置 px）を動かさずに倍率を変える。指で広げる・二度押しに使う
 */
export function zoomAt(v: View, nextScale: number, point: { x: number; y: number }): View {
  const k = nextScale / v.scale;
  return { scale: nextScale, x: point.x - (point.x - v.x) * k, y: point.y - (point.y - v.y) * k };
}

/** 二度押しの切り替え: 広げていなければ押した所を中心に広げ、広げていれば元に戻す */
export function doubleTapView(v: View, point: { x: number; y: number }): View {
  return v.scale > 1.01 ? IDENTITY : zoomAt(v, DOUBLE_TAP_SCALE, point);
}

export const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const viewTransform = (v: View) => `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
