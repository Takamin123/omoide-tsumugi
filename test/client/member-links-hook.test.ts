// 家族のこと（/family）で一人ひとりのリンクを作る: useMemberLinks（0036）。
// DOM がないので、member-edit.test.ts と同じく react の hook を最小の偽物に差し替えて確かめる。
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
const { useMemberLinks } = await load("../../src/client/lib/useMemberLinks");
const { words } = await load("../../src/client/words");

const member = (hasLink: boolean) => ({ id: "m-grandma", role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "standard", dialectRegion: null, setUpByMemberId: "m-mother", hasLink });
const TOKEN = "tok-".padEnd(43, "a");

function stubFetch(status = 200) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ?? null });
    const body = status < 300 ? { token: TOKEN } : { error: "forbidden" };
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

describe("useMemberLinks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    states.length = 0;
  });

  it("リンクがない人は、確かめずに POST /api/members/:id/link で作り、合言葉をその人の所に置いて一覧を読み直す", async () => {
    const calls = stubFetch();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const reload = vi.fn(async () => {});
    const l = useMemberLinks(reload);
    await l.make(member(false));
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual([{ url: "/api/members/m-grandma/link", method: "POST", body: null }]);
    expect(states[0]).toEqual({ "m-grandma": TOKEN });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(states[2]).toBe(false); // busy は戻る
  });

  it("リンクがある人は作り直しなので確かめる。文は「（タブレットなど）」のないもの", async () => {
    const calls = stubFetch();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const l = useMemberLinks(async () => {});
    await l.make(member(true));
    expect(confirm).toHaveBeenCalledWith(words.family.regenerateConfirm);
    expect(words.family.regenerateConfirm).toBe("いまのリンクは使えなくなります。いまのリンクで開いている端末は、新しいリンクで開きなおしが必要です");
    expect(calls).toHaveLength(1);
  });

  it("確かめで「キャンセル」なら何も送らない", async () => {
    const calls = stubFetch();
    vi.stubGlobal("confirm", () => false);
    const reload = vi.fn(async () => {});
    const l = useMemberLinks(reload);
    await l.make(member(true));
    expect(calls).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    expect(states[0]).toEqual({});
  });

  it("作れなかったら、その人の所に文を出す（合言葉は置かない）", async () => {
    stubFetch(403);
    vi.stubGlobal("confirm", () => true);
    const l = useMemberLinks(async () => {});
    await l.make(member(false));
    expect(states[0]).toEqual({});
    expect(states[1]).toEqual({ memberId: "m-grandma", text: words.errors.forbidden });
  });
});
