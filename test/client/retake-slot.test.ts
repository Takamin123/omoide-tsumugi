// useRetakeSlot の状態の流れ（0050 の追記、2026-11-04）を振る舞いで確かめる。
// DOM がないので、react を「描き直せる」最小の偽物に差し替える（hook の順番で状態・ref・effect を覚える）。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Effect = { deps: unknown[] | undefined; cleanup: (() => void) | void };
const fake = vi.hoisted(() => ({
  slots: [] as unknown[],
  effects: [] as { deps: unknown[] | undefined; cleanup: (() => void) | void }[],
  pending: [] as (() => void)[],
  i: 0,
  e: 0,
}));
vi.mock("react", () => ({
  createContext: () => ({}),
  useContext: () => null,
  useState: (init: unknown) => {
    const i = fake.i++;
    if (!(i in fake.slots)) fake.slots[i] = init;
    return [fake.slots[i], (v: unknown) => (fake.slots[i] = typeof v === "function" ? (v as (s: unknown) => unknown)(fake.slots[i]) : v)];
  },
  useRef: (init: unknown) => {
    const i = fake.i++;
    if (!(i in fake.slots)) fake.slots[i] = { current: init };
    return fake.slots[i];
  },
  useCallback: (fn: unknown) => {
    const i = fake.i++;
    if (!(i in fake.slots)) fake.slots[i] = fn;
    return fake.slots[i];
  },
  useMemo: (fn: () => unknown) => {
    fake.i++;
    return fn();
  },
  useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
    const e = fake.e++;
    const prev = fake.effects[e] as Effect | undefined;
    const changed = !prev || !deps || !prev.deps || deps.some((d, k) => !Object.is(d, prev.deps![k]));
    if (!changed) return;
    fake.pending.push(() => {
      if (prev?.cleanup) prev.cleanup();
      fake.effects[e] = { deps, cleanup: fn() };
    });
  },
}));

const load = (name: string): Promise<any> => import(name);
const { useRetakeSlot } = await load("../../src/client/lib/retake");
const { RETAKE_SHOW_MS } = await load("../../src/shared/api");

/** 一度描く（hook を呼び、effect を流す）。返すのはその描画の Retake */
function render(): any {
  fake.i = 0;
  fake.e = 0;
  const r = useRetakeSlot();
  const run = fake.pending.splice(0);
  for (const f of run) f();
  return r;
}
const voice = (id: string, at = Date.now()) => ({ id, kind: "voice", at });
const text = (id: string) => ({ id, kind: "text", at: Date.now() });

let deletes: string[] = [];
let status = 204;
beforeEach(() => {
  deletes = [];
  status = 204;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init?.method === "DELETE") deletes.push(url);
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ error: "not_found" }), { status });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const e of fake.effects) if (e?.cleanup) e.cleanup();
  fake.slots.length = 0;
  fake.effects.length = 0;
  fake.pending.length = 0;
});

describe("useRetakeSlot の流れ", () => {
  it("送れた声に場所を置く。文字なら置かない（前の場所も消す）", async () => {
    let r = render();
    await r.offer("answer", voice("n-1"));
    r = render();
    expect(r.slot).toMatchObject({ at: "answer", id: "n-1", retaking: false, failed: false, replacing: false });
    await r.offer("answer", text("n-2"));
    expect(render().slot).toBeNull();
    expect(deletes).toEqual([]);
  });

  it("start → 声が送れた → 前の語りを DELETE 一回。消している間は replacing、消せたら新しい声に場所", async () => {
    let r = render();
    await r.offer("answer", voice("n-old"));
    r = render();
    r.start("answer");
    r = render();
    expect(r.slot).toMatchObject({ id: "n-old", retaking: true });
    const p = r.offer("answer", voice("n-new"));
    expect(render().slot).toMatchObject({ id: "n-new", replacing: true, retaking: false });
    await p;
    expect(deletes).toEqual(["/api/narrations/n-old"]);
    expect(render().slot).toMatchObject({ at: "answer", id: "n-new", replacing: false, failed: false, retaking: false });
  });

  it("start → end（やめた・短すぎた・マイクが使えない・欄が閉じた）→ 声が送れても DELETE しない", async () => {
    let r = render();
    await r.offer("answer", voice("n-old"));
    r = render();
    r.start("answer");
    r = render();
    r.end("answer");
    r = render();
    expect(r.slot).toMatchObject({ id: "n-old", retaking: false });
    await r.offer("answer", voice("n-new"));
    expect(deletes).toEqual([]);
    expect(render().slot).toMatchObject({ id: "n-new", replacing: false });
  });

  it("end は別の場所には効かない", async () => {
    let r = render();
    await r.offer("answer", voice("n-old"));
    r = render();
    r.start("answer");
    r = render();
    r.end("n-1");
    expect(render().slot).toMatchObject({ retaking: true });
  });

  it("送信に失敗（offer が呼ばれない）→ DELETE しない。取り直しは続き、送り直せたら一度だけ消す", async () => {
    let r = render();
    await r.offer("answer", voice("n-old"));
    r = render();
    r.start("answer");
    r = render();
    // 送れなかった間は何も呼ばれない
    expect(deletes).toEqual([]);
    expect(r.slot).toMatchObject({ id: "n-old", retaking: true });
    await r.offer("answer", voice("n-new"));
    expect(deletes).toEqual(["/api/narrations/n-old"]);
  });

  it("DELETE 404 → 新しい場所を failed に（ボタンを出さず一文。二つとも残る）。送り直さない。failed の場所では start しない", async () => {
    status = 404;
    let r = render();
    await r.offer("answer", voice("n-old"));
    r = render();
    r.start("answer");
    r = render();
    await r.offer("answer", voice("n-new"));
    expect(deletes).toEqual(["/api/narrations/n-old"]);
    r = render();
    expect(r.slot).toMatchObject({ id: "n-new", failed: true, replacing: false, retaking: false });
    r.start("answer");
    expect(render().slot).toMatchObject({ failed: true, retaking: false });
  });

  it("録り直している間の clear は無視、録り直していなければ消す", async () => {
    let r = render();
    await r.offer("answer", voice("n-old"));
    r = render();
    r.start("answer");
    r = render();
    r.clear();
    r = render();
    expect(r.slot).toMatchObject({ id: "n-old", retaking: true });
    r.end("answer");
    r = render();
    r.clear();
    expect(render().slot).toBeNull();
  });

  it("前の前の声は消さない（一回ごとに直前の一つだけ）", async () => {
    let r = render();
    await r.offer("answer", voice("n-a"));
    r = render();
    r.start("answer");
    r = render();
    await r.offer("answer", voice("n-b"));
    r = render();
    r.start("answer");
    r = render();
    await r.offer("answer", voice("n-c"));
    expect(deletes).toEqual(["/api/narrations/n-a", "/api/narrations/n-b"]);
    expect(render().slot).toMatchObject({ id: "n-c" });
  });

  it("場所が違えば消さない（返事の場所で録り直していて、今日の答えが送れた）", async () => {
    let r = render();
    await r.offer("n-1", voice("n-old"));
    r = render();
    r.start("n-1");
    r = render();
    await r.offer("answer", voice("n-new"));
    expect(deletes).toEqual([]);
  });

  it("録り直している間は表示の期限で消えない。終えたら残りの時間で消える", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    let r = render();
    await r.offer("answer", voice("n-old", Date.now()));
    r = render();
    r.start("answer");
    r = render();
    vi.advanceTimersByTime(RETAKE_SHOW_MS + 1_000);
    r = render();
    expect(r.slot).toMatchObject({ id: "n-old", retaking: true });
    r.end("answer");
    r = render();
    vi.advanceTimersByTime(0);
    expect(render().slot).toBeNull();
  });

  it("録り直していなければ RETAKE_SHOW_MS で消える", async () => {
    vi.useFakeTimers();
    let r = render();
    await r.offer("answer", voice("n-1", Date.now()));
    r = render();
    vi.advanceTimersByTime(RETAKE_SHOW_MS - 1);
    expect(render().slot).toMatchObject({ id: "n-1" });
    vi.advanceTimersByTime(1);
    expect(render().slot).toBeNull();
  });
});
