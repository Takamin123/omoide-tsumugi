// 話者の頭文字の丸（0061）: 色は人の並びで安定、字は呼ばれ方の最初の一字、地と字は 4.5:1 以上
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

const load = (name: string): Promise<any> => import(name);
const { initialOf, initialsFor, PALETTE } = await load("../../src/client/lib/initials");

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("頭文字", () => {
  it("呼ばれ方の最初の一字をそのまま（「お」「ご」を飛ばさない）", () => {
    expect(initialOf("ばあば")).toBe("ば");
    expect(initialOf("お母さん")).toBe("お");
    expect(initialOf("まさとおじさん")).toBe("ま");
  });
  it("先頭の空白・記号は飛ばす。英字は大文字。文字のかたまりを割らない", () => {
    expect(initialOf(" 「ゆい」")).toBe("ゆ");
    expect(initialOf("ken")).toBe("K");
    expect(initialOf("😀ばあば")).toBe("ば");
    // 全部が絵文字なら、その最初の一つ（文字のかたまりを割らない）
    expect(initialOf("👨‍👩‍👧")).toBe("👨‍👩‍👧");
    expect(initialOf("")).toBeNull();
  });
});

describe("色", () => {
  const members = ["ばあば", "じいちゃん", "お母さん", "まさとおじさん", "ゆい", "けん", "ひな"].map((calledAs, i) => ({ id: `m${i}`, calledAs }));
  it("人の並びの番号で順に。6 人までは重ならず、7 人目は先頭に戻る。同じ並びなら同じ色", () => {
    const map = initialsFor(members);
    const colors = members.slice(0, 6).map((m) => map.get(m.id).bg);
    expect(new Set(colors).size).toBe(6);
    expect(map.get("m6").bg).toBe(map.get("m0").bg);
    expect(initialsFor(members).get("m3")).toEqual(map.get("m3"));
  });
  const pairs: [string, string][] = PALETTE.map((p: { bg: string; ink: string }) => [p.ink, p.bg]);
  it.each(pairs)("地と字は 4.5:1 以上（%s / %s）", (ink, bg) => {
    expect(ratio(ink, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("淡い青（聞くの丸いボタンの地）は使わない", () => {
    expect(PALETTE.map((p: { bg: string }) => p.bg)).not.toContain("#e7eef7");
  });
});
