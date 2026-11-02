// Claude の呼び出し（公式 SDK @anthropic-ai/sdk）。SDK は fetch だけで動くので、Workers でも VPS でも同じものを使う。
// 応答は外から来るデータとして zod で検証する。全か無か。再試行は SDK に任せず、ここで方針どおりに行う（implementation-policy 2）。
// ログは ID・モデル名・版・トークン数・エラーの種類だけ。本文・プロンプト・SDK のエラーの文は出さない。
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CLAUDE_PURPOSES, emptyMeta } from "../core/claude";
import type {
  ClaudeBatchInfo,
  ClaudeBatchRow,
  ClaudeCallMeta,
  ClaudeCallRequest,
  ClaudeCallResult,
  ClaudeClient,
  ClaudeContentPart,
  ClaudeFailure,
  ClaudeOpResult,
  ClaudePrompt,
} from "../core/ports";

export const CLAUDE_TIMEOUT_MS = 60_000;
/** 合計で送る回数（再試行は 1 回） */
export const CLAUDE_MAX_ATTEMPTS = 2;
export const CLAUDE_RETRY_WAIT_MS = 2_000;
/** 429 の Retry-After に従って待つ上限 */
export const CLAUDE_MAX_RETRY_AFTER_MS = 30_000;
/** 一枚の画像の base64 の長さの上限（API の上限 5MB の内側。縮小済みなら届かない） */
export const CLAUDE_MAX_IMAGE_BASE64_CHARS = 5 * 1024 * 1024;
/** Batch 一回に載せる画像の base64 の合計の上限（Workers のメモリ 128MB の内側に収める。超えるなら呼ぶ側が分ける） */
export const CLAUDE_MAX_BATCH_IMAGE_CHARS = 32 * 1024 * 1024;

const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

const RETRYABLE: ReadonlySet<ClaudeFailure> = new Set<ClaudeFailure>([
  "timeout",
  "network",
  "rate_limited",
  "upstream",
  "truncated",
  "invalid_response",
  "check_failed",
]);

export interface AnthropicClaudeOptions {
  fetch?: typeof fetch;
  /** 待つ関数（テストで差し替える） */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** ログの出し先。既定は console.log に JSON 一行 */
  log?: (line: Record<string, unknown>) => void;
}

// 応答の形（外から来るデータ）。読むところだけを検証する
const usageShape = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
});
const messageShape = z.object({
  model: z.string(),
  stop_reason: z.string().nullish(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: usageShape,
});

const batchShape = z.object({
  id: z.string(),
  processing_status: z.enum(["in_progress", "canceling", "ended"]),
  request_counts: z.object({
    processing: z.number(),
    succeeded: z.number(),
    errored: z.number(),
    canceled: z.number(),
    expired: z.number(),
  }),
});
const batchRowShape = z.object({
  custom_id: z.string(),
  result: z.discriminatedUnion("type", [
    z.object({ type: z.literal("succeeded"), message: z.unknown() }),
    z.object({ type: z.literal("errored"), error: z.unknown() }),
    z.object({ type: z.literal("canceled") }),
    z.object({ type: z.literal("expired") }),
  ]),
});
const errorBodyShape = z.object({ error: z.object({ type: z.string() }) });

type Read<T> = { ok: true; value: T } | { ok: false; reason: ClaudeFailure; violation?: string };

/** 応答の中身を読む。stop_reason → 文字 → JSON → スキーマ → 中身の検査の順。どこかで外れたら何も拾わない */
export function readStructured<T>(raw: unknown, schema: z.ZodType<T>, check?: (value: T) => string | null): Read<T> {
  const msg = messageShape.safeParse(raw);
  if (!msg.success) return { ok: false, reason: "invalid_response" };
  if (msg.data.stop_reason === "refusal") return { ok: false, reason: "refused" };
  if (msg.data.stop_reason === "max_tokens") return { ok: false, reason: "truncated" };
  const texts = msg.data.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text!);
  if (texts.length === 0) return { ok: false, reason: "invalid_response" };
  let json: unknown;
  try {
    json = JSON.parse(texts.join(""));
  } catch {
    return { ok: false, reason: "invalid_response" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid_response" };
  let violation: string | null;
  try {
    violation = check?.(parsed.data) ?? null;
  } catch {
    // 検査そのものが投げた（呼ぶ側の不具合）。投げた文は入力を含むことがあるので捨て、種類だけにする
    violation = "check_threw";
  }
  if (violation) return { ok: false, reason: "check_failed", violation };
  return { ok: true, value: parsed.data };
}

function tokensOf(raw: unknown): { model: string | null; input: number; output: number } {
  const msg = messageShape.safeParse(raw);
  if (!msg.success) return { model: null, input: 0, output: 0 };
  const u = msg.data.usage;
  return {
    model: msg.data.model,
    input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output: u.output_tokens,
  };
}

/** SDK のエラーを種類に置き換える（エラーの文は入力を含むことがあるので捨てる） */
export function classifyError(e: unknown): { reason: ClaudeFailure; retryAfterMs?: number } {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { reason: "timeout" };
  if (e instanceof Anthropic.APIConnectionError) return { reason: "network" };
  if (e instanceof Anthropic.APIError && typeof e.status === "number") {
    const s = e.status;
    if (s === 429) {
      const retryAfterMs = parseRetryAfter(e.headers?.get("retry-after") ?? null);
      return retryAfterMs === undefined ? { reason: "rate_limited" } : { reason: "rate_limited", retryAfterMs };
    }
    if (s === 401 || s === 403) return { reason: "auth" };
    if (s === 413) return { reason: "too_large" };
    if (s >= 500) return { reason: "upstream" };
    return { reason: "rejected" };
  }
  // SDK が送る前に止めたもの（終わっていない Batch の結果を取ろうとした、など）。やり直しても同じ
  if (e instanceof Anthropic.AnthropicError) return { reason: "rejected" };
  return { reason: "network" };
}

/** Retry-After（秒か HTTP の日付）をミリ秒に。読めなければ undefined */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function waitBeforeRetry(failure: { reason: ClaudeFailure; retryAfterMs?: number }): number {
  if (failure.reason === "rate_limited" && failure.retryAfterMs !== undefined) {
    return Math.min(Math.max(failure.retryAfterMs, 0), CLAUDE_MAX_RETRY_AFTER_MS);
  }
  return CLAUDE_RETRY_WAIT_MS;
}

function errorTypeToFailure(raw: unknown): ClaudeFailure {
  const parsed = errorBodyShape.safeParse(raw);
  const type = parsed.success ? parsed.data.error.type : null;
  switch (type) {
    case "invalid_request_error":
    case "not_found_error":
      return "rejected";
    case "authentication_error":
    case "permission_error":
      return "auth";
    case "request_too_large":
      return "too_large";
    case "rate_limit_error":
      return "rate_limited";
    default:
      return "upstream";
  }
}

function toBlock(part: ClaudeContentPart): Anthropic.ContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } };
}

function imageChars(content: ClaudeContentPart[]): { total: number; max: number } {
  let total = 0;
  let max = 0;
  for (const p of content) {
    if (p.type !== "image") continue;
    total += p.base64.length;
    max = Math.max(max, p.base64.length);
  }
  return { total, max };
}

function buildParams<T>(prompt: ClaudePrompt, content: ClaudeContentPart[], schema: z.ZodType<T>): Anthropic.MessageCreateParamsNonStreaming {
  const settings = CLAUDE_PURPOSES[prompt.purpose];
  const format = zodOutputFormat(schema);
  return {
    model: settings.model,
    max_tokens: settings.maxTokens,
    system: prompt.text,
    messages: [{ role: "user", content: content.map(toBlock) }],
    output_config: {
      format: { type: "json_schema", schema: format.schema },
      ...(settings.effort ? { effort: settings.effort } : {}),
    },
  };
}

/** 構造化出力にできないスキーマ（transform など）なら null。送らずに rejected にする（投げない） */
function tryBuildParams<T>(prompt: ClaudePrompt, content: ClaudeContentPart[], schema: z.ZodType<T>): Anthropic.MessageCreateParamsNonStreaming | null {
  try {
    return buildParams(prompt, content, schema);
  } catch {
    return null;
  }
}

export function createAnthropicClaude(apiKey: string, options: AnthropicClaudeOptions = {}): ClaudeClient {
  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: options.timeoutMs ?? CLAUDE_TIMEOUT_MS,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = options.log ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));

  /** 一回の操作（Batch の作成以外）を、方針どおりに再試行する */
  async function withRetry<R>(op: () => Promise<R>): Promise<{ ok: true; value: R; attempts: number } | { ok: false; reason: ClaudeFailure; attempts: number }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return { ok: true, value: await op(), attempts: attempt };
      } catch (e) {
        const f = classifyError(e);
        if (!RETRYABLE.has(f.reason) || attempt >= CLAUDE_MAX_ATTEMPTS) return { ok: false, reason: f.reason, attempts: attempt };
        await sleep(waitBeforeRetry(f));
      }
    }
  }

  return {
    async call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>> {
      const { prompt, content, schema, check, traceId } = req;
      const started = Date.now();
      const meta: ClaudeCallMeta = emptyMeta(prompt);
      const finish = (result: ClaudeCallResult<T>) => {
        log({
          event: "claude_call",
          traceId: traceId ?? null,
          purpose: meta.purpose,
          model: meta.model,
          promptVersion: meta.promptVersion,
          attempts: meta.attempts,
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          elapsedMs: Date.now() - started,
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason, ...(result.violation ? { violation: result.violation } : {}) }),
        });
        return result;
      };

      if (imageChars(content).max > CLAUDE_MAX_IMAGE_BASE64_CHARS) return finish({ ok: false, reason: "too_large", meta });
      const params = tryBuildParams(prompt, content, schema);
      if (!params) return finish({ ok: false, reason: "rejected", violation: "schema_unsupported", meta });

      for (let attempt = 1; ; attempt++) {
        meta.attempts = attempt;
        let failure: { reason: ClaudeFailure; retryAfterMs?: number; violation?: string };
        try {
          const raw: unknown = await client.messages.create(params);
          const t = tokensOf(raw);
          if (t.model) meta.model = t.model;
          meta.inputTokens += t.input;
          meta.outputTokens += t.output;
          const read = readStructured(raw, schema, check);
          if (read.ok) return finish({ ok: true, value: read.value, meta });
          failure = read;
        } catch (e) {
          failure = classifyError(e);
        }
        if (!RETRYABLE.has(failure.reason) || attempt >= CLAUDE_MAX_ATTEMPTS) {
          return finish({ ok: false, reason: failure.reason, ...(failure.violation ? { violation: failure.violation } : {}), meta });
        }
        await sleep(waitBeforeRetry(failure));
      }
    },

    async createBatch({ prompt, schema, items, traceId }) {
      const done = (r: ClaudeOpResult<ClaudeBatchInfo>) => {
        log({
          event: "claude_batch_create",
          traceId: traceId ?? null,
          purpose: prompt.purpose,
          model: CLAUDE_PURPOSES[prompt.purpose].model,
          promptVersion: prompt.version,
          items: items.length,
          ok: r.ok,
          ...(r.ok ? { batchId: r.value.batchId } : { reason: r.reason }),
        });
        return r;
      };
      if (items.length === 0 || items.some((it) => !CUSTOM_ID.test(it.customId)) || new Set(items.map((it) => it.customId)).size !== items.length) {
        return done({ ok: false, reason: "rejected" });
      }
      let total = 0;
      for (const it of items) {
        const c = imageChars(it.content);
        if (c.max > CLAUDE_MAX_IMAGE_BASE64_CHARS) return done({ ok: false, reason: "too_large" });
        total += c.total;
      }
      if (total > CLAUDE_MAX_BATCH_IMAGE_CHARS) return done({ ok: false, reason: "too_large" });
      // 作成は再試行しない（届いていたのに時間切れになると、同じ Batch が二つできて費用が倍になる）。次の回で出し直す
      const requests: Anthropic.Messages.BatchCreateParams.Request[] = [];
      for (const it of items) {
        const params = tryBuildParams(prompt, it.content, schema);
        if (!params) return done({ ok: false, reason: "rejected" });
        requests.push({ custom_id: it.customId, params });
      }
      try {
        const raw: unknown = await client.messages.batches.create({ requests });
        const b = batchShape.safeParse(raw);
        if (!b.success) return done({ ok: false, reason: "invalid_response" });
        return done({ ok: true, value: toInfo(b.data) });
      } catch (e) {
        return done({ ok: false, reason: classifyError(e).reason });
      }
    },

    async getBatch(batchId, traceId) {
      const r = await withRetry(() => client.messages.batches.retrieve(batchId) as Promise<unknown>);
      let out: ClaudeOpResult<ClaudeBatchInfo>;
      if (!r.ok) out = { ok: false, reason: r.reason };
      else {
        const b = batchShape.safeParse(r.value);
        out = b.success ? { ok: true, value: toInfo(b.data) } : { ok: false, reason: "invalid_response" };
      }
      log({
        event: "claude_batch_get",
        traceId: traceId ?? null,
        batchId,
        attempts: r.attempts,
        ok: out.ok,
        ...(out.ok ? { status: out.value.status, counts: out.value.counts } : { reason: out.reason }),
      });
      return out;
    },

    async getBatchResults<T>({
      batchId,
      prompt,
      schema,
      check,
      traceId,
    }: {
      batchId: string;
      prompt: ClaudePrompt;
      schema: z.ZodType<T>;
      check?: (value: T) => string | null;
      traceId?: string;
    }): Promise<ClaudeOpResult<ClaudeBatchRow<T>[]>> {
      const r = await withRetry(async () => {
        const rows: ClaudeBatchRow<T>[] = [];
        const seen = new Set<string>();
        for await (const raw of await client.messages.batches.results(batchId)) {
          const row = batchRowShape.safeParse(raw);
          // 行の形が読めない（custom_id も分からない）ものは拾わない
          if (!row.success || seen.has(row.data.custom_id)) continue;
          seen.add(row.data.custom_id);
          const customId = row.data.custom_id;
          const meta: ClaudeCallMeta = { ...emptyMeta(prompt), attempts: 1 };
          const res = row.data.result;
          if (res.type === "succeeded") {
            const t = tokensOf(res.message);
            if (t.model) meta.model = t.model;
            meta.inputTokens = t.input;
            meta.outputTokens = t.output;
            const read = readStructured(res.message, schema, check);
            rows.push(read.ok ? { customId, ok: true, value: read.value, meta } : { customId, ok: false, reason: read.reason, ...(read.violation ? { violation: read.violation } : {}), meta });
          } else if (res.type === "errored") {
            rows.push({ customId, ok: false, reason: errorTypeToFailure(res.error), meta });
          } else {
            rows.push({ customId, ok: false, reason: res.type, meta });
          }
        }
        return rows;
      });
      const okRows = r.ok ? r.value.filter((x) => x.ok) : [];
      log({
        event: "claude_batch_results",
        traceId: traceId ?? null,
        batchId,
        purpose: prompt.purpose,
        promptVersion: prompt.version,
        attempts: r.attempts,
        ok: r.ok,
        ...(r.ok
          ? {
              rows: r.value.length,
              succeeded: okRows.length,
              failed: r.value.length - okRows.length,
              inputTokens: r.value.reduce((n, x) => n + x.meta.inputTokens, 0),
              outputTokens: r.value.reduce((n, x) => n + x.meta.outputTokens, 0),
            }
          : { reason: r.reason }),
      });
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
    },
  };
}

function toInfo(b: z.infer<typeof batchShape>): ClaudeBatchInfo {
  return { batchId: b.id, status: b.processing_status, counts: { ...b.request_counts } };
}
