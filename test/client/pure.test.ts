import { describe, expect, it } from "vitest";
// test/ は tsconfig.worker.json で型を検査する。そこには src/client が入っていないため、
// 静的に import すると TS6307 になる。動的 import で読み込む（test/node.ts と同じやり方）。
/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (name: string): Promise<any> => import(name);
const {
  emptyTally,
  fitWithin,
  formatClock,
  formatElapsed,
  formatTakenDate,
  parseExifDateTime,
  roundCoord,
  roundLocation,
  tallyOne,
  toHex,
  tokenFromJoinPath,
  validDurationMs,
  voiceLength,
} = await load("../../src/client/lib/pure");

describe("位置の丸め（小数第 2 位）", () => {
  it("小数第 2 位に丸める", () => {
    expect(roundCoord(35.681236)).toBe(35.68);
    expect(roundCoord(139.767125)).toBe(139.77);
    expect(roundCoord(-33.868820)).toBe(-33.87);
  });
  it("丸めた値をもう一度丸めても変わらない（サーバーの確かめと合う）", () => {
    for (const v of [35.685, 0.005, -0.005, 89.999, -179.995, 12.345678]) {
      const r = roundCoord(v);
      expect(Math.round(r * 100) / 100).toBe(r);
    }
  });
  it("-0 は 0 にする", () => {
    expect(Object.is(roundCoord(-0.001), 0)).toBe(true);
  });
  it("片方でも数でなければ位置なし", () => {
    expect(roundLocation(35.1, undefined)).toBeNull();
    expect(roundLocation(Number.NaN, 139)).toBeNull();
    expect(roundLocation(91, 139)).toBeNull();
    expect(roundLocation(35.1234, 139.5678)).toEqual({ latitude: 35.12, longitude: 139.57 });
  });
});

describe("EXIF の日時", () => {
  it("EXIF の形を API の形にする", () => {
    expect(parseExifDateTime("2019:08:14 10:23:05")).toBe("2019-08-14T10:23:05");
  });
  it("読めない・ありえない値は null", () => {
    expect(parseExifDateTime(undefined)).toBeNull();
    expect(parseExifDateTime("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDateTime("2019:02:30 10:00:00")).toBeNull();
    expect(parseExifDateTime("2019:08:14 25:00:00")).toBeNull();
    expect(parseExifDateTime(new Date())).toBeNull();
  });
});

describe("縮小の大きさ", () => {
  it("長い辺を収める", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it("小さい写真は拡大しない", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe("表示の整形", () => {
  it("時計", () => {
    expect(formatClock({ date: "2026-11-02", slot: "morning" })).toBe("11月2日 朝");
    expect(formatClock({ date: "2026-12-31", slot: "night" })).toBe("12月31日 夜");
  });
  it("撮影日", () => {
    expect(formatTakenDate("1985-04-07T09:00:00")).toBe("1985年4月7日");
    expect(formatTakenDate(null)).toBeNull();
  });
  it("経過時間", () => {
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(65_000)).toBe("1:05");
  });
  it("録音の長さ: 測れていない値は null、1 秒未満は 1 秒、60 秒からは分", () => {
    for (const v of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 60 * 60_000 + 1]) {
      expect(validDurationMs(v)).toBeNull();
      expect(voiceLength(v)).toBeNull();
    }
    expect(validDurationMs(1234.5)).toBe(1235);
    expect(voiceLength(300)).toEqual({ minutes: 0, seconds: 1 });
    expect(voiceLength(13_400)).toEqual({ minutes: 0, seconds: 13 });
    expect(voiceLength(59_600)).toEqual({ minutes: 1, seconds: 0 });
    expect(voiceLength(80_000)).toEqual({ minutes: 1, seconds: 20 });
  });
  it("16 進", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });
});

describe("招待リンク", () => {
  it("/join/<token> から合言葉を取り出す", () => {
    const token = "a-_".repeat(15); // 合言葉の形だけを持つ、架空の値
    expect(tokenFromJoinPath(`/join/${token}`)).toBe(token);
    expect(tokenFromJoinPath(`/join/${token}/`)).toBe(token);
  });
  it("形が違えば null", () => {
    expect(tokenFromJoinPath("/join/short")).toBeNull();
    expect(tokenFromJoinPath("/family")).toBeNull();
    expect(tokenFromJoinPath("/join/abc def ghi jkl mno pqr")).toBeNull();
  });
});

describe("写真の登録の数え方", () => {
  it("結果ごとに数える", () => {
    let t = emptyTally(3);
    t = tallyOne(t, "added");
    t = tallyOne(t, "duplicate");
    t = tallyOne(t, "unreadable");
    expect(t).toEqual({ total: 3, done: 3, added: 1, duplicate: 1, unreadable: 1, failed: 0 });
  });
});
