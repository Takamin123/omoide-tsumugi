// 運営の記録の画面（/ops/record）の、画面に頼らない部分（0025）。
// 鍵は sessionStorage にだけ持ち、URL に載せず Authorization で送る。印の範囲の切り分け。
// test/ は tsconfig.worker.json で型を検査するため、src/client は動的 import で読む
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { fetchRecord, headSegments, inputNarrations, loadOpsKey, narrationAnchor, OPS_KEY_STORAGE, saveOpsKey, splitMarked } =
  await load("../../src/client/ops/record");

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
    for (const f of ["record.ts", "RecordPage.tsx"]) {
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
