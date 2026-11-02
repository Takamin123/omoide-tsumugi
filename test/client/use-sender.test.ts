// useSender: 送れなかったら、同じ requestId で送り直す。
// DOM がないので、react の hook を最小の偽物に差し替えて、hook を一度だけ呼んで確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";

const states = vi.hoisted(() => [] as unknown[]);
vi.mock("react", () => ({
  useState: (init: unknown) => {
    const i = states.length;
    states.push(init);
    return [init, (v: unknown) => (states[i] = typeof v === "function" ? (v as (s: unknown) => unknown)(states[i]) : v)];
  },
  useRef: (init: unknown) => ({ current: init }),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
}));

const load = (name: string): Promise<any> => import(name);
const { useSender } = await load("../../src/client/lib/useSender");

const target = { speakerMemberId: "m-grandpa", photoId: "p-1", entranceId: "e-1", replyToId: null };
const flush = () => new Promise((r) => setTimeout(r, 0));

function stubFetch(statuses: number[]) {
  const metas: any[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    metas.push(JSON.parse((init.body as FormData).get("meta") as string));
    const status = statuses[Math.min(i++, statuses.length - 1)]!;
    if (status === 0) throw new TypeError("network");
    return new Response(JSON.stringify(status < 300 ? { narration: { id: "n-1" } } : { error: "internal" }), { status });
  });
  return metas;
}

describe("useSender", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    states.length = 0;
  });

  it("声: 失敗したら failed、retry は同じ requestId と同じ録音で送る", async () => {
    const metas = stubFetch([0, 202]);
    const onSent = vi.fn();
    const s = useSender(target, onSent);
    const audio = new Blob([new Uint8Array([9, 9])], { type: "audio/webm" });
    s.sendVoice(audio);
    await flush();
    expect(states[0]).toBe("failed");
    expect(onSent).not.toHaveBeenCalled();
    s.retry();
    await flush();
    expect(states[0]).toBe("sent");
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(metas).toHaveLength(2);
    expect(metas[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(metas[1].requestId).toBe(metas[0].requestId);
    expect(metas[1]).toEqual(metas[0]);
  });

  it("文字: 失敗しても文は手元に残り、retry で同じ requestId で送る", async () => {
    const metas = stubFetch([500, 202]);
    const s = useSender(target);
    s.sendText("あの夏は暑かった");
    await flush();
    expect(states[0]).toBe("failed");
    expect(s.pendingText()).toBe("あの夏は暑かった");
    s.retry();
    await flush();
    expect(metas[1].requestId).toBe(metas[0].requestId);
    expect(s.pendingText()).toBeNull();
  });

  it("新しい語りには新しい requestId を作る", async () => {
    const metas = stubFetch([202]);
    const s = useSender(target);
    s.sendText("一つめ");
    await flush();
    s.sendText("二つめ");
    await flush();
    expect(metas[0].requestId).not.toBe(metas[1].requestId);
  });

  it("送れた後の retry は何もしない", async () => {
    const metas = stubFetch([202]);
    const s = useSender(target);
    s.sendText("一つめ");
    await flush();
    s.retry();
    await flush();
    expect(metas).toHaveLength(1);
  });
});
