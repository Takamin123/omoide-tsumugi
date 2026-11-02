// Workers の入り口（platform/cloudflare/entry.ts）を、偽の env と ctx で動かす。
// 毎朝の処理（scheduled）とデモ用のボタンが、同じ runMorning を通ることの土台を確かめる。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../src/server/core/ports";

const runMorning = vi.fn(async (_deps: AppDeps, _now?: Date, _opts?: { familyId?: string }) => {});
vi.mock("../src/server/core/morning", () => ({ runMorning }));

const { default: worker, createCloudflareDeps } = await import("../src/server/platform/cloudflare/entry");

/** 架空の小さなデータだけを持つ、R2Bucket の偽物。 */
function fakeBucket() {
  const items = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    items,
    async put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      const bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
      items.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
      return {};
    },
    async get(key: string) {
      const it = items.get(key);
      if (!it) return null;
      return { body: new Response(it.bytes).body, size: it.bytes.byteLength, httpMetadata: { contentType: it.contentType } };
    },
    async delete(key: string) {
      items.delete(key);
    },
  };
}

const fakeEnv = (bucket = fakeBucket()) => ({ DB: {}, BUCKET: bucket, APP_ENV: "preview" }) as unknown as Env;
const fakeCtx = () => ({ waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} }) as unknown as ExecutionContext;

beforeEach(() => runMorning.mockClear());

describe("scheduled（毎朝の処理）", () => {
  it("runMorning を一度だけ、Cron の時刻で呼ぶ", async () => {
    const scheduledTime = Date.UTC(2026, 10, 1, 21, 0, 0);
    const controller = { scheduledTime, cron: "0 21 * * *", noRetry: () => {} } as unknown as ScheduledController;
    await worker.scheduled(controller, fakeEnv(), fakeCtx());
    expect(runMorning).toHaveBeenCalledTimes(1);
    const [deps, now] = runMorning.mock.calls[0]!;
    expect(now).toEqual(new Date(scheduledTime));
    expect(deps).toHaveProperty("repos");
    expect(deps).toHaveProperty("photos");
    expect(deps).toHaveProperty("runInBackground");
  });

  it("runMorning に渡す依存は、env の R2 と ctx.waitUntil につながっている", async () => {
    const bucket = fakeBucket();
    const ctx = fakeCtx();
    await worker.scheduled({ scheduledTime: 0, cron: "0 21 * * *" } as unknown as ScheduledController, fakeEnv(bucket), ctx);
    const [deps] = runMorning.mock.calls[0]!;
    await deps.photos.put("test/tiny", new Uint8Array([1, 2, 3]), { contentType: "application/octet-stream" });
    expect([...bucket.items.keys()]).toEqual(["test/tiny"]);
    const task = Promise.resolve();
    deps.runInBackground(task);
    expect(ctx.waitUntil).toHaveBeenCalledWith(task);
  });

  it("runMorning が失敗したら、scheduled も失敗する（黙って飲み込まない）", async () => {
    runMorning.mockRejectedValueOnce(new Error("boom"));
    await expect(
      worker.scheduled({ scheduledTime: 0, cron: "0 21 * * *" } as unknown as ScheduledController, fakeEnv(), fakeCtx()),
    ).rejects.toThrow("boom");
  });
});

describe("fetch（Workers の入り口から）", () => {
  it("GET /api/health が 200 {ok:true} を返す", async () => {
    const res = await worker.fetch(new Request("https://example.test/api/health"), fakeEnv(), fakeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("合言葉のない /api/* は 401 JSON", async () => {
    const res = await worker.fetch(new Request("https://example.test/api/photos/x/image"), fakeEnv(), fakeCtx());
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("createCloudflareDeps と R2 の保存", () => {
  it("put した中身と contentType を、get で返す。ないものは null", async () => {
    const deps = createCloudflareDeps(fakeEnv(), fakeCtx());
    await deps.photos.put("test/a", new Uint8Array([9, 8, 7]), { contentType: "image/jpeg" });
    const got = await deps.photos.get("test/a");
    expect(got?.contentType).toBe("image/jpeg");
    expect(got?.size).toBe(3);
    expect(new Uint8Array(await new Response(got!.body).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    await deps.photos.delete("test/a");
    expect(await deps.photos.get("test/a")).toBeNull();
  });
});

describe("createCloudflareDeps の設定", () => {
  it("APP_ENV がなければ本番とみなす。OpenAI のキーがなければ文字起こしは not_configured で失敗する", async () => {
    const env = { DB: {}, BUCKET: fakeBucket() } as unknown as Env;
    const deps = createCloudflareDeps(env, fakeCtx());
    expect(deps.config.appEnv).toBe("production");
    expect(deps.config.createFamilyToken).toBeNull();
    expect(await deps.transcriber.transcribe({ audio: new Blob([]), dialectRegion: null })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("確かめの入り口（transcribeProbe）は、OpenAI のキーがあるときだけ作る", () => {
    expect(createCloudflareDeps(fakeEnv(), fakeCtx()).transcribeProbe).toBeNull();
    const env = { DB: {}, BUCKET: fakeBucket(), APP_ENV: "preview", OPENAI_API_KEY: "fake-key" } as unknown as Env;
    expect(createCloudflareDeps(env, fakeCtx()).transcribeProbe).not.toBeNull();
  });

  it("秘密の値を env から読む", () => {
    const env = { DB: {}, BUCKET: fakeBucket(), APP_ENV: "preview", CREATE_FAMILY_TOKEN: "t" } as unknown as Env;
    expect(createCloudflareDeps(env, fakeCtx()).config).toEqual({ appEnv: "preview", createFamilyToken: "t" });
  });
});
