import { createAnthropicClaude, type AnthropicClaudeOptions } from "../src/server/adapters/anthropic-claude";
import { createApp } from "../src/server/app";
import { notConfiguredClaude } from "../src/server/core/claude";
import type { AppDeps, ClaudeClient, ClaudePurpose, PhotoStore, Repositories, Speaker, SpeechProbe, Transcriber, TranscribeInput, TranscribeProbe } from "../src/server/core/ports";
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
    claude: notConfiguredClaude,
    transcribeProbe: null,
    speechProbe: null,
    speaker: null,
    runInBackground: () => {},
    config: { appEnv: "development", createFamilyToken: null, opsRecordToken: null, opsRecordFamilies: [], demoResetToken: null, demoGuideKey: null, demoGuideLinks: null },
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

// ---- Claude の偽物 ----
// 本物の実装（createAnthropicClaude）に、API の形の応答を台本どおりに返す fetch を差し込む。
// 合う応答も合わない応答（スキーマ違反、時間切れ、429 など）も返せる。検証と再試行は本物の実装が行う。
// npm test では本物の API を呼ばない（呼ばれた要求はすべてここに残る）。

export type FakeClaudeReply =
  /** 構造化出力として value を JSON で返す（スキーマに合うかは value 次第） */
  | { kind: "json"; value: unknown; model?: string; inputTokens?: number; outputTokens?: number }
  /** JSON でない文字を返す */
  | { kind: "text"; text: string }
  /** 止まった理由（拒否、上限で切れた） */
  | { kind: "stop"; stopReason: "refusal" | "max_tokens" }
  /** HTTP のエラー。429 なら retryAfter を付けられる */
  | { kind: "status"; status: number; retryAfter?: string }
  /** 返さない（実装の時間切れまで待つ） */
  | { kind: "timeout" }
  /** 接続できない */
  | { kind: "network" };

export interface FakeClaudeScript {
  /** POST /v1/messages に、順に返すもの。尽きたら 500 */
  replies?: FakeClaudeReply[];
  /** Batch の状態と結果。batchReplies があれば、Batch の各要求の前に先に使う（エラーを返したいとき） */
  batch?: { status?: "in_progress" | "canceling" | "ended"; rows?: unknown[] };
  batchReplies?: FakeClaudeReply[];
}

export interface FakeClaudeRequest {
  method: string;
  path: string;
  body: unknown;
}

const FAKE_ORIGIN = "https://api.anthropic.com";
const FAKE_BATCH_ID = "msgbatch_fake";

/** 架空のメッセージ（Batch の結果の行を作るのにも使う） */
export function fakeClaudeMessage(reply: Extract<FakeClaudeReply, { kind: "json" | "text" | "stop" }>) {
  const text = reply.kind === "json" ? JSON.stringify(reply.value) : reply.kind === "text" ? reply.text : "";
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: (reply.kind === "json" && reply.model) || "claude-fake",
    content: reply.kind === "stop" ? [] : [{ type: "text", text }],
    stop_reason: reply.kind === "stop" ? reply.stopReason : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: reply.kind === "json" ? (reply.inputTokens ?? 10) : 10,
      output_tokens: reply.kind === "json" ? (reply.outputTokens ?? 5) : 5,
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

async function replyToResponse(reply: FakeClaudeReply, signal: AbortSignal | null | undefined): Promise<Response> {
  switch (reply.kind) {
    case "json":
    case "text":
    case "stop":
      return jsonResponse(fakeClaudeMessage(reply));
    case "status":
      return jsonResponse(
        { type: "error", error: { type: reply.status === 429 ? "rate_limit_error" : "api_error", message: "fake" } },
        reply.status,
        reply.retryAfter !== undefined ? { "retry-after": reply.retryAfter } : {},
      );
    case "timeout":
      return new Promise<Response>((_, reject) => {
        const abort = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort);
      });
    case "network":
      throw new TypeError("fetch failed");
  }
}

export function fakeClaudeFetch(script: FakeClaudeScript = {}): { fetch: typeof fetch; requests: FakeClaudeRequest[] } {
  const replies = [...(script.replies ?? [])];
  const batchReplies = [...(script.batchReplies ?? [])];
  const requests: FakeClaudeRequest[] = [];
  const batchObject = (status: "in_progress" | "canceling" | "ended") => {
    const rows = script.batch?.rows ?? [];
    return {
      id: FAKE_BATCH_ID,
      type: "message_batch",
      processing_status: status,
      request_counts: { processing: status === "ended" ? 0 : rows.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
      results_url: status === "ended" ? `${FAKE_ORIGIN}/v1/messages/batches/${FAKE_BATCH_ID}/results` : null,
      created_at: "2026-11-03T00:00:00Z",
      expires_at: "2026-11-04T00:00:00Z",
      ended_at: null,
      cancel_initiated_at: null,
      archived_at: null,
    };
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname === "/v1/messages" && method === "POST") {
      return replyToResponse(replies.shift() ?? { kind: "status", status: 500 }, init?.signal);
    }
    if (url.pathname.startsWith("/v1/messages/batches")) {
      const pre = batchReplies.shift();
      if (pre) return replyToResponse(pre, init?.signal);
      if (url.pathname === "/v1/messages/batches" && method === "POST") return jsonResponse(batchObject("in_progress"));
      if (url.pathname.endsWith("/results")) {
        const lines = (script.batch?.rows ?? []).map((r) => JSON.stringify(r)).join("\n");
        return new Response(lines, { status: 200, headers: { "content-type": "application/binary" } });
      }
      if (method === "GET") return jsonResponse(batchObject(script.batch?.status ?? "ended"));
    }
    return jsonResponse({ type: "error", error: { type: "not_found_error", message: "fake" } }, 404);
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

/**
 * 一つの用途の call だけを claude に通し、ほかの用途と Batch はキーなし（not_configured）にする。
 * 写真の登録で背景の写真の整理が走っても、台本の応答を食わないようにする
 */
export function onlyPurpose(claude: ClaudeClient, purpose: ClaudePurpose): ClaudeClient {
  return {
    call: (req) => (req.prompt.purpose === purpose ? claude.call(req) : notConfiguredClaude.call(req)),
    createBatch: (req) => notConfiguredClaude.createBatch(req),
    getBatch: (id) => notConfiguredClaude.getBatch(id),
    getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
  };
}

/** 偽の API につないだ本物の実装。待ち時間は記録するだけで実際には待たない */
export function fakeClaude(
  script: FakeClaudeScript = {},
  opts: Pick<AnthropicClaudeOptions, "timeoutMs"> = {},
): { claude: ClaudeClient; requests: FakeClaudeRequest[]; sleeps: number[]; logs: Record<string, unknown>[] } {
  const { fetch: fetchImpl, requests } = fakeClaudeFetch(script);
  const sleeps: number[] = [];
  const logs: Record<string, unknown>[] = [];
  const claude = createAnthropicClaude("fake-anthropic-key", {
    fetch: fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    timeoutMs: opts.timeoutMs ?? 50,
    log: (line) => void logs.push(line),
  });
  return { claude, requests, sleeps, logs };
}

// ---- 手元の D1（wrangler の getPlatformProxy。メモリの中だけに持ち、.wrangler/ に残さない） ----

/* eslint-disable @typescript-eslint/no-explicit-any */
const MIGRATIONS_DIR = path.join(repoRoot, "drizzle/migrations");

/** マイグレーションのファイル名（名前の順） */
export function migrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f: string) => f.endsWith(".sql")).sort();
}

/** マイグレーションのファイルを一つ適用する */
export async function applyMigration(d1: D1Database, file: string): Promise<void> {
  const statements = (fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8") as string)
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  await d1.batch(statements.map((s) => d1.prepare(s)));
}

/** 手元の D1 を立てて、マイグレーションを適用する。before を渡すと、その名前より前のファイルだけ（移行のテスト用） */
export async function startD1(opts: { before?: string } = {}): Promise<{ d1: D1Database; bucket: R2Bucket; dispose: () => Promise<void> }> {
  const wrangler: any = await import("wrangler" as string);
  const proxy = await wrangler.getPlatformProxy({ configPath: path.join(repoRoot, "wrangler.jsonc"), persist: false });
  const d1 = proxy.env.DB as D1Database;
  for (const f of migrationFiles()) {
    if (opts.before !== undefined && f >= opts.before) break;
    await applyMigration(d1, f);
  }
  return { d1, bucket: proxy.env.BUCKET as R2Bucket, dispose: () => proxy.dispose() };
}

export const CREATE_TOKEN = "fake-create-tok";
/** 運営の記録の鍵（架空）。下限の 32 文字を超える長さにする（0030） */
export const OPS_TOKEN = "fake-ops-record-".padEnd(40, "x");
/** デモの初期化の鍵（架空）。下限の 32 文字を超え、ほかの鍵と違う値にする（0038） */
export const DEMO_RESET_TOKEN = "fake-demo-reset-".padEnd(40, "y");

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
  opts: {
    appEnv?: string;
    transcriber?: ReturnType<typeof fakeTranscriber>;
    claude?: ClaudeClient;
    transcribeProbe?: TranscribeProbe;
    speechProbe?: SpeechProbe;
    speaker?: Speaker;
    now?: Date;
  } = {},
): TestApp {
  let now = opts.now ?? new Date("2026-11-02T00:00:00Z"); // 日本時間 9:00
  const background: Promise<unknown>[] = [];
  const store = memoryPhotoStore();
  const transcriber = opts.transcriber ?? fakeTranscriber();
  const deps: AppDeps = {
    repos: createD1Repositories(d1),
    photos: store,
    transcriber,
    claude: opts.claude ?? notConfiguredClaude,
    transcribeProbe: opts.transcribeProbe ?? null,
    speechProbe: opts.speechProbe ?? null,
    speaker: opts.speaker ?? null,
    runInBackground: (t) => void background.push(t),
    config: {
      appEnv: opts.appEnv ?? "development",
      createFamilyToken: CREATE_TOKEN,
      opsRecordToken: OPS_TOKEN,
      opsRecordFamilies: [],
      demoResetToken: DEMO_RESET_TOKEN,
      demoGuideKey: null,
      demoGuideLinks: null,
    },
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

/** set-cookie から合言葉の cookie（omoide_invite=...）を取り出す。なければ null */
export function inviteCookieFrom(res: Response): string | null {
  const m = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${INVITE_COOKIE}=([^;]*)`));
  return m && m[1] ? cookieOf(m[1]) : null;
}

/**
 * 家族を作り、「最初の人のリンク」の cookie を返す。
 * この cookie は一度きりで、最初の一人を入れる（addMember）と使えなくなる。以後はその人の cookie（addMember の戻り値）を使う（0036）
 */
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

/**
 * 人を足し、その人の cookie（その人のリンクで開いた端末）も返す。
 * cookie が最初の人のリンクなら、足した人が最初の一人になる（その cookie は使えなくなる）。
 * そうでなければ、cookie の人（role = family）が足し、続けてその人のリンクを作る
 */
export async function addMember(t: TestApp, cookie: string, input: Record<string, unknown> = {}): Promise<{ id: string; cookie: string }> {
  const res = await t.app.request("/api/members", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...defaultMember, ...input }),
  });
  if (res.status !== 201) throw new Error(`addMember ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  const own = inviteCookieFrom(res) ?? (await memberLinkCookie(t, cookie, id));
  return { id, cookie: own };
}

/** cookie の人（role = family）が、その人のリンクを作り、その cookie を返す */
export async function memberLinkCookie(t: TestApp, cookie: string, memberId: string): Promise<string> {
  const res = await t.app.request(`/api/members/${memberId}/link`, { method: "POST", headers: { Cookie: cookie } });
  if (res.status !== 200) throw new Error(`memberLink ${res.status}`);
  return cookieOf(((await res.json()) as { token: string }).token);
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

/** 写真を足す。持ち主は cookie の人（0036） */
export async function addPhoto(t: TestApp, cookie: string, n: number, extra: Record<string, unknown> = {}): Promise<{ id: string }> {
  const meta = { contentHash: hashOf(n), width: 10, height: 10, takenAt: null, latitude: null, longitude: null, ...extra };
  const res = await postForm(t, "/api/photos", photoForm(meta, tinyJpeg(n)), cookie);
  if (res.status !== 201 && res.status !== 200) throw new Error(`addPhoto ${res.status}`);
  return ((await res.json()) as { photo: { id: string } }).photo;
}
