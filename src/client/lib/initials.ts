// 話者の頭文字の丸（0061）。色と字を一か所で決め、語りと入り口が同じものを使う。DOM に頼らない。
// - 色: 家族の中の人の並び（members。サーバーは作った順に返す）の番号で、PALETTE を順に。7 人目からは先頭に戻る
// - 字: 呼ばれ方の最初の一つの文字のかたまり。先頭の空白・記号は飛ばし、英字は大文字に。ほかの変換はしない（「お母さん」は「お」）
// 丸は飾り（aria-hidden）。名前は必ず並べる（色だけで人を区別させない）

/** 淡い地と濃い字の組（どれも 4.5:1 以上。淡い青は「聞く」の丸いボタンと紛れるので使わない） */
export const PALETTE: readonly { bg: string; ink: string }[] = [
  { bg: "#f3e3cf", ink: "#7a4a12" },
  { bg: "#dfe8d6", ink: "#2f4a1c" },
  { bg: "#f5e1e4", ink: "#7d2a3a" },
  { bg: "#e9e3f3", ink: "#4b3577" },
  { bg: "#dcefed", ink: "#1d5550" },
  { bg: "#f4ecc8", ink: "#5c4a0a" },
];

const graphemes = (s: string): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(s), (x) => x.segment);
  }
  return Array.from(s);
};

/** 呼ばれ方の最初の一字。空なら null。先頭の記号・絵文字は飛ばす（「😀ばあば」は「ば」）。全部が記号・絵文字ならその最初の一つ */
export function initialOf(calledAs: string): string | null {
  const all = graphemes(calledAs.trim());
  if (all.length === 0) return null;
  const first = all.find((g) => !/^[\s\p{P}\p{S}]+$/u.test(g)) ?? all[0]!;
  return first.toUpperCase();
}

export type Initial = { char: string; bg: string; ink: string };

/** 人の ID → 丸（字と色）。members の並びの番号で色を決める */
export function initialsFor(members: readonly { id: string; calledAs: string }[]): Map<string, Initial> {
  const map = new Map<string, Initial>();
  members.forEach((m, i) => {
    const char = initialOf(m.calledAs);
    if (char === null) return;
    map.set(m.id, { char, ...PALETTE[i % PALETTE.length]! });
  });
  return map;
}
