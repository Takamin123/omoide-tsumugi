// 運営の記録の画面（/ops/record）の、画面に頼らない部分（0025）。
// 鍵は sessionStorage にだけ持ち、URL に載せず Authorization で送る。印の範囲の切り分け。
// test/ は tsconfig.worker.json で型を検査するため、src/client は動的 import で読む
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const {
  entranceDates,
  entrancesOn,
  fetchRecord,
  headSegments,
  inputNarrations,
  jstDateTime,
  jstTime,
  loadOpsKey,
  monthDay,
  narrationAnchor,
  OPS_KEY_STORAGE,
  parseRoute,
  photoEvents,
  photoUsage,
  pickDate,
  pickPhoto,
  repliesTo,
  routeSearch,
  saveOpsKey,
  seconds,
  shortId,
  splitMarked,
  takenDate,
} = await load("../../src/client/ops/record");

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("鍵の持ち方", () => {
  it("入れた鍵を読み、消せる。空は持たない", () => {
    const s = memoryStore();
    expect(loadOpsKey(s)).toBeNull();
    saveOpsKey("k-1", s);
    expect(s.m.get(OPS_KEY_STORAGE)).toBe("k-1");
    expect(loadOpsKey(s)).toBe("k-1");
    saveOpsKey(null, s);
    expect(loadOpsKey(s)).toBeNull();
  });

  it("保存先が投げても落ちない", () => {
    const bad = {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("x");
      },
      removeItem: () => {
        throw new Error("x");
      },
    };
    expect(loadOpsKey(bad)).toBeNull();
    expect(() => saveOpsKey("k", bad)).not.toThrow();
  });

  it("ops/ のソースは localStorage を使わず、鍵を URL に載せない", () => {
    for (const f of fs.readdirSync(path.join(repoRoot, "src/client/ops")) as string[]) {
      const src = fs.readFileSync(path.join(repoRoot, "src/client/ops", f), "utf8") as string;
      expect(src, f).not.toMatch(/\blocalStorage\s*[.[]/);
      expect(src, f).not.toMatch(/[?&](key|token)=/);
    }
  });
});

describe("fetchRecord", () => {
  const respond = (status: number, body: unknown = {}) => {
    const calls: { url: string; init: any }[] = [];
    const f = (async (url: string, init?: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it("鍵は Authorization で送り、cookie は送らない。家族の ID は符号化する", async () => {
    const { f, calls } = respond(200, { family: { id: "a/b" } });
    const r = await fetchRecord("a/b", "k-1", f);
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe("/api/ops/families/a%2Fb/record");
    expect(calls[0]!.url).not.toContain("k-1");
    expect(calls[0]!.init?.headers).toEqual({ Authorization: "Bearer k-1" });
    expect(calls[0]!.init?.credentials).toBe("omit");
  });

  it.each([
    [401, "unauthorized"],
    [404, "not_found"],
    [500, "failed"],
  ] as const)("%i は %s", async (status, reason) => {
    expect(await fetchRecord("x", "k", respond(status).f)).toEqual({ ok: false, reason });
  });

  it("つながらなければ failed", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await fetchRecord("x", "k", f)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("splitMarked: 印の範囲で切り分ける", () => {
  it("範囲の外と内を順に並べる", () => {
    expect(splitMarked("あいうえお", [{ start: 1, end: 2 }, { start: 3, end: 5 }])).toEqual({
      segments: [
        { text: "あ", uncertain: false },
        { text: "い", uncertain: true },
        { text: "う", uncertain: false },
        { text: "えお", uncertain: true },
      ],
      broken: false,
    });
  });
  it("印がなければ全体を一つ。null は壊れている印", () => {
    expect(splitMarked("あい", [])).toEqual({ segments: [{ text: "あい", uncertain: false }], broken: false });
    expect(splitMarked("あい", null)).toEqual({ segments: [{ text: "あい", uncertain: false }], broken: true });
  });
  it.each([
    [[{ start: 1, end: 3 }, { start: 2, end: 4 }]],
    [[{ start: 0, end: 9 }]],
    [[{ start: 2, end: 2 }]],
    [[{ start: 3, end: 4 }, { start: 0, end: 1 }]],
    [[{ start: 0.5, end: 1 }]],
  ])("壊れた範囲（%j）は全体を印なしで返す", (spans) => {
    expect(splitMarked("あいうえ", spans)).toEqual({ segments: [{ text: "あいうえ", uncertain: false }], broken: true });
  });
});

describe("材料にした語り", () => {
  const narration = (over: Record<string, unknown>) => ({
    id: "n-1",
    photoId: "p-1",
    speakerMemberId: "m-1",
    entranceId: null,
    kind: "voice",
    hasAudio: true,
    forDate: "2026-11-02",
    createdAt: 1,
    transcriptStatus: "done",
    transcript: "えー 海へ 行きました",
    cleaned: null,
    ...over,
  });

  it("ID を同じ記録の語りと結ぶ。一覧にない ID は narration が null。引用元に印", () => {
    const a = narration({ id: "a" });
    const b = narration({ id: "b" });
    expect(inputNarrations(["b", "x", "a"], [a, b], "a")).toEqual([
      { id: "b", narration: b, isQuote: false },
      { id: "x", narration: null, isQuote: false },
      { id: "a", narration: a, isQuote: true },
    ]);
    expect(inputNarrations(null, [a], null)).toEqual([]);
  });

  it("頭だけ切るときは、印の区切りを保ち、字はコードポイントで数える", () => {
    const segs = [
      { text: "あい", uncertain: false },
      { text: "うえ", uncertain: true },
      { text: "お", uncertain: false },
    ];
    expect(headSegments(segs, 3)).toEqual({
      segments: [
        { text: "あい", uncertain: false },
        { text: "う", uncertain: true },
      ],
      truncated: true,
    });
    expect(headSegments(segs, 4)).toEqual({ segments: segs.slice(0, 2), truncated: true });
    expect(headSegments(segs, 5)).toEqual({ segments: segs, truncated: false });
    expect(headSegments([{ text: "𠮷野家", uncertain: false }], 1)).toEqual({
      segments: [{ text: "𠮷", uncertain: false }],
      truncated: true,
    });
  });

  it("語りの欄のアンカー", () => {
    expect(narrationAnchor("abc")).toBe("narration-abc");
  });
});

describe("外のフォント", () => {
  it("ops/ のソースと index.html は、外のフォントやスタイルを読み込まない", () => {
    const files = [
      ...(fs.readdirSync(path.join(repoRoot, "src/client/ops")) as string[]).map((f) => path.join("src/client/ops", f)),
      "index.html",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(repoRoot, f), "utf8") as string;
      expect(src, f).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
      expect(src, f).not.toMatch(/@import\b/);
      expect(src, f).not.toMatch(/@font-face\b/);
      expect(src, f).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
      expect(src, f).not.toMatch(/<link\b[^>]*rel=["']?stylesheet/);
    }
  });
});

describe("見る軸と URL", () => {
  it("日付・写真・軸を、ほかの値を壊さずに読む（空の値は null、知らない view は日付と人で見る）", () => {
    expect(parseRoute("")).toEqual({ family: "", view: "date", date: null, photo: null });
    expect(parseRoute("?family=f1&date=&photo=")).toEqual({ family: "f1", view: "date", date: null, photo: null });
    expect(parseRoute("?family=f1&view=PHOTO").view).toBe("date");
    // 見ていない軸の選択も残す（日付と人で見るに戻ったとき、選んでいた写真を忘れない）
    expect(routeSearch({ family: "f1", view: "date", date: "2026-11-04", photo: "p1" })).toBe("?family=f1&date=2026-11-04&photo=p1");
  });
  it("view を省くと日付と人で見る。写真で見るときは view=photo", () => {
    expect(parseRoute("?family=f1")).toEqual({ family: "f1", view: "date", date: null, photo: null });
    expect(parseRoute("?family=f1&view=photo&photo=p1&date=2026-11-05")).toEqual({
      family: "f1",
      view: "photo",
      date: "2026-11-05",
      photo: "p1",
    });
    expect(parseRoute("?view=other").view).toBe("date");
  });
  it("作った URL を読み直すと同じ所に戻る。鍵は載らない", () => {
    for (const r of [
      { family: "f/1", view: "date", date: "2026-11-05", photo: null },
      { family: "f1", view: "photo", date: null, photo: "p 1" },
    ]) {
      const q = routeSearch(r);
      expect(parseRoute(q)).toEqual(r);
      expect(q).not.toMatch(/key|token/);
    }
    expect(routeSearch({ family: "f1", view: "date", date: null, photo: null })).toBe("?family=f1");
  });
});

const entrance = (over: Record<string, unknown>) => ({
  id: "e",
  forDate: "2026-11-04",
  memberId: "m1",
  kind: "claude",
  photoId: "p1",
  shownAt: null,
  createdAt: 10,
  told: { quote: null },
  guessed: {},
  ...over,
});
const nar = (over: Record<string, unknown>) => ({
  id: "n",
  photoId: "p1",
  speakerMemberId: "m1",
  entranceId: null,
  kind: "text",
  hasAudio: false,
  durationMs: null,
  forDate: "2026-11-04",
  createdAt: 20,
  transcriptStatus: "done",
  transcript: "x",
  cleaned: null,
  ...over,
});

describe("日付と人で見る", () => {
  const members = [{ id: "m2" }, { id: "m1" }];
  const entrances = [
    entrance({ id: "a", forDate: "2026-11-05", memberId: "m1" }),
    entrance({ id: "b", forDate: "2026-11-04", memberId: "m1" }),
    entrance({ id: "c", forDate: "2026-11-05", memberId: "m2" }),
  ];
  it("日付は古い順で重ならない。求めた日付がなければいちばん新しい日", () => {
    const dates = entranceDates(entrances);
    expect(dates).toEqual(["2026-11-04", "2026-11-05"]);
    expect(pickDate(dates, "2026-11-04")).toBe("2026-11-04");
    expect(pickDate(dates, "2020-01-01")).toBe("2026-11-05");
    expect(pickDate(dates, null)).toBe("2026-11-05");
    expect(pickDate([], null)).toBeNull();
  });
  it("その日の入り口を家族の並び順で", () => {
    expect(entrancesOn({ entrances, members }, "2026-11-05").map((e: { id: string }) => e.id)).toEqual(["c", "a"]);
  });
  it("返ってきた語りは、その入り口の entranceId を持つものだけ（古い順）", () => {
    const ns = [nar({ id: "x", entranceId: "a", createdAt: 30 }), nar({ id: "y", entranceId: "b" }), nar({ id: "z", entranceId: "a", createdAt: 5 })];
    expect(repliesTo(ns, "a").map((n: { id: string }) => n.id)).toEqual(["z", "x"]);
  });
});

describe("写真で見る", () => {
  const photos = [{ id: "p0" }, { id: "p1" }, { id: "p2" }];
  const record = {
    photos,
    entrances: [entrance({ id: "e1", photoId: "p1", forDate: "2026-11-05", createdAt: 1 }), entrance({ id: "e0", photoId: "p1", createdAt: 50 })],
    narrations: [
      nar({ id: "n1", photoId: "p1", forDate: "2026-11-04", createdAt: 50 }),
      nar({ id: "n2", photoId: "p1", forDate: "2026-11-04", createdAt: 60 }),
      nar({ id: "n3", photoId: "p2" }),
    ],
  };
  it("写真ごとの入り口と語りの数", () => {
    const u = photoUsage(record);
    expect(u.get("p0")).toEqual({ entrances: 0, narrations: 0 });
    expect(u.get("p1")).toEqual({ entrances: 2, narrations: 2 });
    expect(u.get("p2")).toEqual({ entrances: 0, narrations: 1 });
  });
  it("求めた写真がなければ、使われた最初の写真", () => {
    const u = photoUsage(record);
    expect(pickPhoto(photos, u, "p2")).toBe("p2");
    expect(pickPhoto(photos, u, "nope")).toBe("p1");
    expect(pickPhoto([], u, null)).toBeNull();
  });
  it("どの写真も使われていなければ、最初の写真。ほかの写真の入り口・語りは数えない", () => {
    const rec = { photos, entrances: [entrance({ photoId: "other" })], narrations: [nar({ photoId: "other" })] };
    const u = photoUsage(rec);
    expect([...u.keys()]).toEqual(["p0", "p1", "p2"]);
    expect(pickPhoto(photos, u, null)).toBe("p0");
    expect(photoEvents(rec, "p0")).toEqual([]);
  });
  it("たどったことは日付、時刻の順。同じ時刻なら入り口が先", () => {
    const evs = photoEvents(record, "p1");
    expect(evs.map((e: { type: string; entrance?: { id: string }; narration?: { id: string } }) => e.entrance?.id ?? e.narration?.id)).toEqual([
      "e0",
      "n1",
      "n2",
      "e1",
    ]);
  });
});

describe("書き方", () => {
  it("日付と時刻は日本時間", () => {
    expect(monthDay("2026-11-05")).toBe("11/5");
    const ms = Date.UTC(2026, 10, 4, 0, 2); // 日本時間 11/4 9:02
    expect(jstTime(ms)).toBe("9:02");
    expect(jstDateTime(ms)).toBe("11/4 9:02");
    expect(jstDateTime(Date.UTC(2026, 10, 4, 15, 30))).toBe("11/5 0:30");
    expect(jstDateTime(Date.UTC(2026, 11, 31, 15, 5))).toBe("1/1 0:05");
    expect(monthDay("11/5")).toBe("11/5");
  });
  it("声の長さは小数一桁で丸める", () => {
    expect(seconds(0)).toBe("0.0 秒");
    expect(seconds(12849)).toBe("12.8 秒");
    expect(seconds(12850)).toBe("12.9 秒");
    expect(shortId("short-id")).toBe("short-id");
  });
  it("撮影日、声の長さ、短い ID", () => {
    expect(takenDate("1987-08-16T10:00:00")).toBe("1987年8月16日");
    expect(takenDate("1987:08:16 10:00:00")).toBe("1987年8月16日");
    expect(takenDate("むかし")).toBe("むかし");
    expect(seconds(12800)).toBe("12.8 秒");
    expect(shortId("b91383a1-70dd-49f5-a52e-90e1c970766c")).toBe("b913…766c");
  });
});
