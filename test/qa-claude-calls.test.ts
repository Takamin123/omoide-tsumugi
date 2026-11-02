// qa-engineer が足したテスト: Claude の呼び出しの土台（試す言い回しの検出、再試行の分け方、ログへの漏れ）。
// 本物の API は呼ばない。データはすべて架空。
// 初めは it.fails で書いた取りこぼし（活用の抜け、投げる所）は、直したので it に戻した。
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAnthropicClaude } from "../src/server/adapters/anthropic-claude";
import { findTestingPhrase } from "../src/server/core/claude-checks";
import type { ClaudePrompt } from "../src/server/core/ports";
import { fakeClaude, fakeClaudeMessage } from "./helpers";

const SECRET_PROMPT = "架空のプロンプト本文-秘";
const SECRET_INPUT = "架空の家族の語り-秘";
const SECRET_OUTPUT = "架空の応答の本文-秘";
const SECRET_KEY = "fake-anthropic-key";
const prompt: ClaudePrompt = { purpose: "entrance", version: "entrance/v9", text: SECRET_PROMPT };
const schema = z.object({ question: z.string() });
const content = [{ type: "text" as const, text: SECRET_INPUT }];

/** 応答を一つずつ返す fetch。エラーの文に本文を含めて、ログに漏れないかを見るため */
function scriptedClaude(responses: Array<() => Response | Promise<Response>>) {
  const logs: Record<string, unknown>[] = [];
  const sleeps: number[] = [];
  const headers: Record<string, string>[] = [];
  let i = 0;
  const claude = createAnthropicClaude(SECRET_KEY, {
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
      const next = responses[i++];
      if (!next) throw new Error("台本が尽きた");
      return next();
    }) as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    timeoutMs: 50,
    log: (line) => void logs.push(line),
  });
  return { claude, logs, sleeps, headers, sent: () => i };
}

function errorResponse(status: number, type: string, message: string) {
  return () => new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json" } });
}
function messageResponse(value: unknown) {
  return () => new Response(JSON.stringify(fakeClaudeMessage({ kind: "json", value })), { status: 200, headers: { "content-type": "application/json" } });
}

function expectNoSecrets(x: unknown) {
  const s = JSON.stringify(x);
  for (const secret of [SECRET_PROMPT, SECRET_INPUT, SECRET_OUTPUT, SECRET_KEY]) expect(s).not.toContain(secret);
}

describe("試す言い回し: 今の検出で止まるもの（取りこぼさない）", () => {
  it.each([
    "この写真のこと、覚えとる？",
    "おぼえてはりますか",
    "この人のことご存知でしたか",
    "どこか分かる？",
    "これが誰だかわかるかな？",
    "知ってる？",
    "思い出した？",
    "ここがどこか当ててみてね",
    "どなたでしょうか？",
    "覚えてますか\nこの日のこと",
  ])("%s", (text) => {
    expect(findTestingPhrase(text)).not.toBeNull();
  });
});

describe("試す言い回し: 誤検出しない（開かれた問いかけ、名詞の「思い出」）", () => {
  it.each([
    "この日はどんな一日でしたか？",
    "思い出深い日ですか",
    "思い出話を聞かせてください",
    "このころの暮らしはどんなふうでしたか",
    "誰と一緒でしたか？",
    "目覚ましの音で起きていましたか",
    "わかりやすい道でしたか",
    "この海で、どんなことをしましたか",
  ])("%s", (text) => {
    expect(findTestingPhrase(text)).toBeNull();
  });
});

describe("試す言い回し: 活用の抜けも止める", () => {
  // 初めの実装で抜けていた活用。思い出す・当てる・知っている を止める
  it.each([
    "この日のこと、思い出されますか？", // 思い出さ（受け身・尊敬）
    "このころのこと、思い出さない？",
    "どこか当ててみませんか", // 当ててみ + ませんか
    "誰か当てられますか",
    "この人のこと知っとる？", // 方言
    "この場所、知ってた？",
    "これは何でしょう？", // 「何」は何歳だけが入っている
    "何歳のときでしょう？", // 何歳 と でしょう の間に語が入る
    "オボエテル？", // カタカナ
  ])("%s", (text) => {
    expect(findTestingPhrase(text)).not.toBeNull();
  });
});

describe("試す言い回し: 写っているものの正体を答えさせる形も止める（0020）", () => {
  // fable-advisor に相談して、止める側に決めた（docs/decisions/0020）
  it.each(["この人は誰ですか？", "これは誰？", "お名前は？", "誰だと思いますか？", "これはどこですか？", "何歳のころですか？", "いつごろの写真でしょうか"])(
    "%s",
    (text) => {
      expect(findTestingPhrase(text)).not.toBeNull();
    },
  );

  it.each(["写っているのは、いつのことでしたか", "名前をつけたのは誰でしたか", "いつ？", "半角でも　ﾄﾞｺﾃﾞｽｶ?"])("%s", (text) => {
    expect(findTestingPhrase(text)).not.toBeNull();
  });

  // 0020 の「通す」: 疑問詞が節の中にあり、語りを引き出す問い
  it.each([
    "どこへ行った帰りでしたか",
    "何がおいしかったですか",
    "どこが好きでしたか",
    "いつごろから通っていたんですか",
    "何歳のころから始めたんですか",
    "どこでも寝られましたか",
    "誰にでも優しかったですか",
    "名前の由来を聞かせてください",
    "どんな名前で呼んでいましたか",
    "楽しかったでしょう？",
  ])("通す: %s", (text) => {
    expect(findTestingPhrase(text)).toBeNull();
  });
});

describe("試す言い回し: 0020 に合わせて直したもの（再確認で見つけた）", () => {
  // 直す前の取りこぼし: 「誰の／どこの＋名詞」が述語になると止まらない。identify の「の」の後が 写真・こと・ころ・頃・とき・時 に限られるため
  it.each(["誰の家でしたか", "誰の誕生日でしたか", "どなたの結婚式でしたか", "どこのお店でしたか", "この人のこと知っとった？"])(
    "止める: %s",
    (text) => {
      expect(findTestingPhrase(text)).not.toBeNull();
    },
  );

  // 直す前の誤検出: quiz の /(誰|…|何|なに|なん)[^?。]{0,6}(だ|で)しょう/ が、開かれた問いや、別の語の一部（いつも・なんだか・ナンバー）を止める
  it.each([
    "この日は何をしたのでしょう",
    "ここで何を話したのでしょう",
    "このあと、何が起きたでしょう",
    "何度も行ったのでしょうか",
    "どこへ出かけたのでしょうか",
    "いつもの道でしょうか",
    "いつも楽しそうでしょう",
    "なんだか楽しそうでしょう",
    "ナンバープレートでしょうか",
  ])("通す: %s", (text) => {
    expect(findTestingPhrase(text)).toBeNull();
  });
});

describe("失敗は投げずに種類で返す（直した後の確かめ）", () => {
  it("構造化出力にできないスキーマは、送らずに rejected / schema_unsupported。ログは一行で本文なし", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: "x" } }] });
    const bad = z.object({ question: z.string().transform((s) => s.length) });
    const r = await f.claude.call({ prompt, content, schema: bad });
    expect(r).toMatchObject({ ok: false, reason: "rejected", violation: "schema_unsupported", meta: { attempts: 0 } });
    expect(f.requests).toHaveLength(0);
    expect(f.logs).toHaveLength(1);
    expectNoSecrets(f.logs);
  });

  it("Batch の作成でも、構造化出力にできないスキーマは送らずに rejected", async () => {
    const f = fakeClaude();
    const bad = z.object({ question: z.string().transform((s) => s.length) });
    expect(await f.claude.createBatch({ prompt, schema: bad, items: [{ customId: "p1", content }] })).toMatchObject({ ok: false, reason: "rejected" });
    expect(f.requests).toHaveLength(0);
  });

  it("check が投げたら check_failed / check_threw。投げた文は出ない", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: "x" } }, { kind: "json", value: { question: "x" } }] });
    const r = await f.claude.call({
      prompt,
      content,
      schema,
      check: () => {
        throw new Error(SECRET_OUTPUT);
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "check_failed", violation: "check_threw" });
    expectNoSecrets(r);
    expectNoSecrets(f.logs);
  });

  it("Batch の結果で check が投げても、その行だけ check_failed", async () => {
    const msg = (q: string) => fakeClaudeMessage({ kind: "json", value: { question: q } });
    const f = fakeClaude({
      batch: {
        status: "ended",
        rows: [
          { custom_id: "a", result: { type: "succeeded", message: msg("boom") } },
          { custom_id: "b", result: { type: "succeeded", message: msg("ok") } },
        ],
      },
    });
    const r = await f.claude.getBatchResults({
      batchId: "msgbatch_fake",
      prompt,
      schema,
      check: (v) => {
        if (v.question === "boom") throw new Error(SECRET_OUTPUT);
        return null;
      },
    });
    if (!r.ok) throw new Error("ok のはず");
    expect(r.value.map((x) => [x.customId, x.ok ? "ok" : x.violation])).toEqual([
      ["a", "check_threw"],
      ["b", "ok"],
    ]);
    expectNoSecrets(f.logs);
  });
});

describe("再試行の分け方（補い）", () => {
  it("接続エラーが続けば network。2 回だけ送る", async () => {
    const f = fakeClaude({ replies: [{ kind: "network" }, { kind: "network" }, { kind: "json", value: { question: "x" } }] });
    expect(await f.claude.call({ prompt, content, schema })).toMatchObject({ ok: false, reason: "network", meta: { attempts: 2 } });
    expect(f.requests).toHaveLength(2);
  });

  it("Retry-After が日付でも従う。過去の日付なら待たずにやり直す", async () => {
    const f = fakeClaude({ replies: [{ kind: "status", status: 429, retryAfter: new Date(0).toUTCString() }, { kind: "json", value: { question: "x" } }] });
    expect((await f.claude.call({ prompt, content, schema })).ok).toBe(true);
    expect(f.sleeps).toEqual([0]);
  });

  it("Retry-After が読めなければ 2 秒", async () => {
    const f = fakeClaude({ replies: [{ kind: "status", status: 429, retryAfter: "soon" }, { kind: "json", value: { question: "x" } }] });
    expect((await f.claude.call({ prompt, content, schema })).ok).toBe(true);
    expect(f.sleeps).toEqual([2000]);
  });

  it("拒否の後には、二度目を送らない（トークン数は一回分）", async () => {
    const f = fakeClaude({ replies: [{ kind: "stop", stopReason: "refusal" }, { kind: "json", value: { question: "x" } }] });
    const r = await f.claude.call({ prompt, content, schema });
    expect(r).toMatchObject({ ok: false, reason: "refused", meta: { attempts: 1, inputTokens: 10, outputTokens: 5 } });
    expect(f.sleeps).toEqual([]);
  });

  it("一度目が上限で切れ、二度目に合えば ok。トークン数は合計", async () => {
    const f = fakeClaude({ replies: [{ kind: "stop", stopReason: "max_tokens" }, { kind: "json", value: { question: "x" }, inputTokens: 100, outputTokens: 50 }] });
    expect(await f.claude.call({ prompt, content, schema })).toMatchObject({ ok: true, meta: { attempts: 2, inputTokens: 110, outputTokens: 55 } });
  });

  it("Batch の作成: 時間切れでもやり直さない", async () => {
    const f = fakeClaude({ batchReplies: [{ kind: "timeout" }] }, { timeoutMs: 20 });
    expect(await f.claude.createBatch({ prompt, schema, items: [{ customId: "p1", content }] })).toEqual({ ok: false, reason: "timeout" });
    expect(f.requests).toHaveLength(1);
    expect(f.sleeps).toEqual([]);
  });

  it("Batch の作成: custom_id が 64 字を超えたら送らない。64 字ちょうどは送る", async () => {
    const f = fakeClaude();
    expect(await f.claude.createBatch({ prompt, schema, items: [{ customId: "a".repeat(65), content }] })).toEqual({ ok: false, reason: "rejected" });
    expect(f.requests).toHaveLength(0);
    expect((await f.claude.createBatch({ prompt, schema, items: [{ customId: "a".repeat(64), content }] })).ok).toBe(true);
  });

  it("Batch の状態: 401 はやり直さない", async () => {
    const f = fakeClaude({ batchReplies: [{ kind: "status", status: 401 }] });
    expect(await f.claude.getBatch("msgbatch_fake")).toEqual({ ok: false, reason: "auth" });
    expect(f.requests).toHaveLength(1);
  });

  it("Batch の結果: 取る途中の 5xx は一度やり直す（行が二重にならない）", async () => {
    const rows = [{ custom_id: "p1", result: { type: "succeeded", message: fakeClaudeMessage({ kind: "json", value: { question: "x" } }) } }];
    const f = fakeClaude({ batch: { status: "ended", rows }, batchReplies: [{ kind: "status", status: 503 }] });
    const r = await f.claude.getBatchResults({ batchId: "msgbatch_fake", prompt, schema });
    expect(r.ok && r.value.map((x) => x.customId)).toEqual(["p1"]);
    expect(f.sleeps).toEqual([2000]);
  });

  it("Batch の結果: 行のエラーの種類を読み替える", async () => {
    const err = (type: string) => ({ type: "error", error: { type, message: SECRET_INPUT } });
    const f = fakeClaude({
      batch: {
        status: "ended",
        rows: [
          { custom_id: "a", result: { type: "errored", error: err("overloaded_error") } },
          { custom_id: "b", result: { type: "errored", error: err("rate_limit_error") } },
          { custom_id: "c", result: { type: "errored", error: err("authentication_error") } },
          { custom_id: "d", result: { type: "errored", error: err("request_too_large") } },
          { custom_id: "e", result: { type: "canceled" } },
          { custom_id: "e", result: { type: "succeeded", message: fakeClaudeMessage({ kind: "json", value: { question: "x" } }) } },
        ],
      },
    });
    const r = await f.claude.getBatchResults({ batchId: "msgbatch_fake", prompt, schema });
    if (!r.ok) throw new Error("ok のはず");
    expect(r.value.map((x) => [x.customId, x.ok ? "ok" : x.reason])).toEqual([
      ["a", "upstream"],
      ["b", "rate_limited"],
      ["c", "auth"],
      ["d", "too_large"],
      ["e", "canceled"], // 重なった custom_id は先の行だけ
    ]);
    expectNoSecrets(r);
    expectNoSecrets(f.logs);
  });
});

describe("失敗は投げずに種類で返す", () => {
  // ports.ts の約束「失敗は投げずに種類で返す」。構造化出力にできないスキーマ（transform など）だと、
  // buildParams の zodOutputFormat が try の外で投げ、call が reject する（ログの一行も出ない）
  it("構造化出力にできないスキーマでも、call は投げない", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: "x" } }] });
    const bad = z.object({ question: z.string().transform((s) => s.length) });
    await expect(f.claude.call({ prompt, content, schema: bad })).resolves.toMatchObject({ ok: false });
  });

  // check が投げると、classifyError が network（接続エラー）と読み替え、やり直す。原因がログから分からない
  it("check が投げたとき、network とは読み替えない", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: "x" } }, { kind: "json", value: { question: "x" } }] });
    const r = await f.claude.call({
      prompt,
      content,
      schema,
      check: () => {
        throw new Error(SECRET_OUTPUT);
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).not.toBe("network");
  });

  it("check が投げても、その文はログにも返り値にも出ない", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: "x" } }, { kind: "json", value: { question: "x" } }] });
    const r = await f.claude.call({
      prompt,
      content,
      schema,
      check: () => {
        throw new Error(SECRET_OUTPUT);
      },
    });
    expectNoSecrets(r);
    expectNoSecrets(f.logs);
  });
});

describe("ログへの漏れ", () => {
  it("API のエラーの文に入力が含まれても、ログにも返り値にも出ない", async () => {
    const s = scriptedClaude([errorResponse(400, "invalid_request_error", `bad: ${SECRET_INPUT} ${SECRET_PROMPT}`)]);
    const r = await s.claude.call({ prompt, content, schema, traceId: "t1" });
    expect(r).toMatchObject({ ok: false, reason: "rejected" });
    expectNoSecrets(r);
    expectNoSecrets(s.logs);
  });

  it("5xx・429 のエラーの文も出ない（やり直しの後の一行だけ）", async () => {
    const s = scriptedClaude([errorResponse(529, "overloaded_error", SECRET_INPUT), errorResponse(429, "rate_limit_error", SECRET_PROMPT)]);
    await s.claude.call({ prompt, content, schema });
    expect(s.logs).toHaveLength(1);
    expectNoSecrets(s.logs);
  });

  it("応答の本文は、スキーマ違反でも検査違反でも出ない", async () => {
    const f = fakeClaude({
      replies: [
        { kind: "json", value: { question: 1, extra: SECRET_OUTPUT } },
        { kind: "json", value: { question: SECRET_OUTPUT } },
      ],
    });
    const r = await f.claude.call({ prompt, content, schema, check: (v) => (v.question === SECRET_OUTPUT ? "testing_phrase" : null) });
    expect(r).toMatchObject({ ok: false, reason: "check_failed", violation: "testing_phrase" });
    expectNoSecrets(r);
    expectNoSecrets(f.logs);
  });

  it("成功のときも、ログに本文・キーが出ない", async () => {
    const s = scriptedClaude([messageResponse({ question: SECRET_OUTPUT })]);
    const r = await s.claude.call({ prompt, content, schema });
    expect(r.ok).toBe(true);
    expectNoSecrets(s.logs);
  });

  it("キーは認証の見出しだけで送り、URL と本文には入れない", async () => {
    const seen: { url: string; body: string; auth: string }[] = [];
    const claude = createAnthropicClaude(SECRET_KEY, {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        seen.push({ url: String(input), body: String(init?.body ?? ""), auth: `${h.get("x-api-key") ?? ""}${h.get("authorization") ?? ""}` });
        return messageResponse({ question: "x" })();
      }) as typeof fetch,
      log: () => {},
    });
    await claude.call({ prompt, content, schema });
    expect(seen[0]!.auth).toContain(SECRET_KEY);
    expect(seen[0]!.url).not.toContain(SECRET_KEY);
    expect(seen[0]!.body).not.toContain(SECRET_KEY);
  });

  it("Batch の作成・状態・結果のログに、本文もプロンプトも出ない", async () => {
    const f = fakeClaude({
      batch: { status: "ended", rows: [{ custom_id: "p1", result: { type: "succeeded", message: fakeClaudeMessage({ kind: "json", value: { question: SECRET_OUTPUT } }) } }] },
    });
    await f.claude.createBatch({ prompt, schema, items: [{ customId: "p1", content }] });
    await f.claude.getBatch("msgbatch_fake");
    await f.claude.getBatchResults({ batchId: "msgbatch_fake", prompt, schema });
    expect(f.logs.map((l) => l.event)).toEqual(["claude_batch_create", "claude_batch_get", "claude_batch_results"]);
    expectNoSecrets(f.logs);
  });

  it("送る前に止めた（大きすぎる画像）ときもログは一行で、本文が出ない", async () => {
    const f = fakeClaude();
    const big = "A".repeat(5 * 1024 * 1024 + 4);
    await f.claude.call({ prompt, content: [...content, { type: "image", mediaType: "image/jpeg", base64: big }], schema });
    expect(f.logs).toHaveLength(1);
    expect(JSON.stringify(f.logs).length).toBeLessThan(1000);
    expectNoSecrets(f.logs);
  });
});
