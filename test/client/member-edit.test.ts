// 家族のこと（/family）で一人ひとりを直す: useMemberEditor。
// DOM がないので、use-sender.test.ts と同じく react の hook を最小の偽物に差し替えて確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";

const states = vi.hoisted(() => [] as unknown[]);
vi.mock("react", () => ({
  useState: (init: unknown) => {
    const i = states.length;
    states.push(init);
    return [init, (v: unknown) => (states[i] = typeof v === "function" ? (v as (s: unknown) => unknown)(states[i]) : v)];
  },
  useCallback: (fn: unknown) => fn,
}));

const load = (name: string): Promise<any> => import(name);
const { useMemberEditor } = await load("../../src/client/lib/useMemberEditor");

const input = { role: "elder", relation: "祖母", calledAs: "おばあちゃん", speechStyle: "dialect", dialectRegion: "鹿児島", setUpByMemberId: "m-mother" };

function stubFetch(status = 200) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : null });
    const body = status < 300 ? { id: "m-grandma", ...input } : { error: "internal" };
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

describe("useMemberEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    states.length = 0;
  });

  it("開くのは一度に一人だけ（別の人を開くと、前の人は閉じる）", () => {
    stubFetch();
    const e = useMemberEditor(async () => {});
    expect(states[0]).toBe(null);
    e.open("m-grandma");
    expect(states[0]).toBe("m-grandma");
    e.open("m-mother");
    expect(states[0]).toBe("m-mother");
  });

  it("やめると閉じて、何も送らない", () => {
    const calls = stubFetch();
    const reload = vi.fn(async () => {});
    const e = useMemberEditor(reload);
    e.open("m-grandma");
    e.close();
    expect(states[0]).toBe(null);
    expect(calls).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("直すと PATCH /api/members/:id に送り、一覧を読み直してから閉じる", async () => {
    const calls = stubFetch();
    const order: string[] = [];
    const reload = vi.fn(async () => {
      order.push(`reload:${String(states[0])}`);
    });
    const e = useMemberEditor(reload);
    e.open("m-grandma");
    const m = await e.save("m-grandma", input);
    expect(calls).toEqual([{ url: "/api/members/m-grandma", method: "PATCH", body: input }]);
    expect(m).toMatchObject({ id: "m-grandma", calledAs: "おばあちゃん" });
    // 読み直したときはまだ開いていて、読み直した後に閉じる
    expect(order).toEqual(["reload:m-grandma"]);
    expect(states[0]).toBe(null);
  });

  it("送れなかったら、開いたまま、読み直さない（フォームがエラーを出す）", async () => {
    stubFetch(500);
    const reload = vi.fn(async () => {});
    const e = useMemberEditor(reload);
    e.open("m-grandma");
    await expect(e.save("m-grandma", input)).rejects.toThrow();
    expect(states[0]).toBe("m-grandma");
    expect(reload).not.toHaveBeenCalled();
  });
});
