import { createApp } from "../src/server/app";
import type { AppDeps, PhotoStore, Repositories, SpeechProbe, Transcriber, TranscribeInput, TranscribeProbe } from "../src/server/core/ports";
import { createD1Repositories } from "../src/server/platform/cloudflare/d1-repositories";
import { INVITE_COOKIE } from "../src/server/routes/auth";
import { fs, path, repoRoot } from "./node";

/** テスト用の、メモリに持つ PhotoStore。架空の小さなデータだけを入れる。 */
export function memoryPhotoStore(): PhotoStore & { keys(): string[] } {
  const items = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async put(key, body, meta) {
      const bytes =
        body instanceof ReadableStream || body instanceof Blob
          ? new Uint8Array(await new Response(body).arrayBuffer())
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : body;
      items.set(key, { bytes, contentType: meta.contentType });
    },
    async get(key) {
      const item = items.get(key);
      if (!item) return null;
      return { body: new Response(item.bytes).body!, size: item.bytes.byteLength, contentType: item.contentType };
    },
    async delete(key) {
      items.delete(key);
    },
    keys: () => [...items.keys()],
  };
}

/** 呼ばれたら失敗するリポジトリ（データベースを使わないテスト用） */
export const unusedRepos = new Proxy({} as Repositories, {
  get() {
    throw new Error("repos should not be used in this test");
  },
});

export function fakeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    repos: unusedRepos,
    photos: memoryPhotoStore(),
    transcriber: fakeTranscriber(),
    transcribeProbe: null,
    speechProbe: null,
    runInBackground: () => {},
    config: { appEnv: "development", createFamilyToken: null },
    now: () => new Date(),
    ...overrides,
  };
}

/** 文字起こしの偽物。合う応答も合わない応答も返せる。呼ばれた入力を覚える。 */
export function fakeTranscriber(
  respond: (input: TranscribeInput) => Awaited<ReturnType<Transcriber["transcribe"]>> = () => ({ ok: true, text: "架空の語り" }),
): Transcriber & { calls: TranscribeInput[] } {
  const calls: TranscribeInput[] = [];
  return {
    calls,
    async transcribe(input) {
      calls.push(input);
      return respond(input);
    },
  };
}

// ---- 手元の D1（wrangler の getPlatformProxy。メモリの中だけに持ち、.wrangler/ に残さない） ----

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function startD1(): Promise<{ d1: D1Database; dispose: () => Promise<void> }> {
  const wrangler: any = await import("wrangler" as string);
  const proxy = await wrangler.getPlatformProxy({ configPath: path.join(repoRoot, "wrangler.jsonc"), persist: false });
  const d1 = proxy.env.DB as D1Database;
  const dir = path.join(repoRoot, "drizzle/migrations");
  const files: string[] = fs.readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const statements = (fs.readFileSync(path.join(dir, f), "utf8") as string)
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await d1.batch(statements.map((s) => d1.prepare(s)));
  }
  return { d1, dispose: () => proxy.dispose() };
}

export const CREATE_TOKEN = "fake-create-tok";

export interface TestApp {
  app: ReturnType<typeof createApp>;
  deps: AppDeps;
  store: ReturnType<typeof memoryPhotoStore>;
  transcriber: ReturnType<typeof fakeTranscriber>;
  /** 背景の処理（文字起こし）を待つ */
  flush: () => Promise<void>;
  setNow: (d: Date) => void;
}

export function makeTestApp(
  d1: D1Database,
  opts: { appEnv?: string; transcriber?: ReturnType<typeof fakeTranscriber>; transcribeProbe?: TranscribeProbe; speechProbe?: SpeechProbe; now?: Date } = {},
): TestApp {
  let now = opts.now ?? new Date("2026-11-02T00:00:00Z"); // 日本時間 9:00
  const background: Promise<unknown>[] = [];
  const store = memoryPhotoStore();
  const transcriber = opts.transcriber ?? fakeTranscriber();
  const deps: AppDeps = {
    repos: createD1Repositories(d1),
    photos: store,
    transcriber,
    transcribeProbe: opts.transcribeProbe ?? null,
    speechProbe: opts.speechProbe ?? null,
    runInBackground: (t) => void background.push(t),
    config: { appEnv: opts.appEnv ?? "development", createFamilyToken: CREATE_TOKEN },
    now: () => now,
  };
  return {
    app: createApp(() => deps),
    deps,
    store,
    transcriber,
    flush: async () => {
      while (background.length) await background.shift();
    },
    setNow: (d) => {
      now = d;
    },
  };
}

export const cookieOf = (token: string) => `${INVITE_COOKIE}=${token}`;

/** 家族を作り、合言葉の cookie を返す */
export async function createFamily(t: TestApp, isDemo = false): Promise<{ familyId: string; token: string; cookie: string }> {
  const res = await t.app.request("/api/families", {
    method: "POST",
    headers: { Authorization: `Bearer ${CREATE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isDemo }),
  });
  if (res.status !== 201) throw new Error(`createFamily ${res.status}`);
  const body = (await res.json()) as { familyId: string; token: string };
  return { ...body, cookie: cookieOf(body.token) };
}

export const defaultMember = {
  role: "family",
  relation: "母",
  calledAs: "おかあさん",
  speechStyle: "standard",
  dialectRegion: null,
  setUpByMemberId: null,
} as const;

export async function addMember(t: TestApp, cookie: string, input: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await t.app.request("/api/members", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...defaultMember, ...input }),
  });
  if (res.status !== 201) throw new Error(`addMember ${res.status}`);
  return (await res.json()) as { id: string };
}

/** JPEG の先頭だけを持つ、架空の小さなバイト列（本物の写真ではない） */
export const tinyJpeg = (n = 0) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 1, 2, 3]);

export const hashOf = (n: number) => n.toString(16).padStart(64, "0");

export function photoForm(meta: Record<string, unknown>, bytes: Uint8Array = tinyJpeg(), type = "image/jpeg"): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("file", new File([bytes], "p.jpg", { type }));
  return form;
}

/** multipart を、Content-Length 付きで送る（ブラウザと同じ） */
export async function postForm(t: TestApp, url: string, form: FormData, cookie: string): Promise<Response> {
  const req = new Request("http://localhost" + url, { method: "POST", body: form });
  const body = await req.arrayBuffer();
  return t.app.request(url, {
    method: "POST",
    body,
    headers: { Cookie: cookie, "Content-Type": req.headers.get("content-type")!, "Content-Length": String(body.byteLength) },
  });
}

export async function addPhoto(
  t: TestApp,
  cookie: string,
  ownerMemberId: string,
  n: number,
  extra: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const meta = { ownerMemberId, contentHash: hashOf(n), width: 10, height: 10, takenAt: null, latitude: null, longitude: null, ...extra };
  const res = await postForm(t, "/api/photos", photoForm(meta, tinyJpeg(n)), cookie);
  if (res.status !== 201 && res.status !== 200) throw new Error(`addPhoto ${res.status}`);
  return ((await res.json()) as { photo: { id: string } }).photo;
}
