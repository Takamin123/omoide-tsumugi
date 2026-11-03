// 写真の初回整理（photo_guess）: 登録の後の背景処理、冪等、しきい値で call と Batch が分かれること、Batch の回収、
// 毎朝の処理（デモの時計のボタン）から同じ関数で回ること、家族向けの API に説明が出ないこと。Claude は偽物。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import {
  PHOTO_GUESS_BATCH_STALE_MS,
  PHOTO_GUESS_CALL_THRESHOLD,
  PHOTO_GUESS_FEELING_WORDS,
  PHOTO_GUESS_KINSHIP_WORDS,
  PHOTO_GUESS_MAX_ATTEMPTS,
  PHOTO_GUESS_STALE_MS,
  checkPhotoGuess,
  runPhotoGuesses,
} from "../src/server/core/photo-guess";
import { runMorning } from "../src/server/core/morning";
import { PROMPTS } from "../src/server/prompts";
import {
  addMember,
  addPhoto,
  createFamily,
  fakeClaude,
  fakeClaudeMessage,
  makeTestApp,
  startD1,
  type FakeClaudeReply,
  type FakeClaudeRequest,
  type TestApp,
} from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

/** 家族向けの API に出てはいけない、架空の説明の目印 */
const SECRET = "架空の説明ZQX";
const guessReply = (description = `${SECRET}。屋外で大人二人が並んで立っている。`): FakeClaudeReply => ({
  kind: "json",
  value: { description },
  model: "claude-haiku-5-5",
  inputTokens: 900,
  outputTokens: 40,
});
const messageCalls = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages");
const batchCreates = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages/batches");

async function requestRows(familyId: string) {
  return (
    await d1
      .prepare("SELECT photo_id, state, batch_id, attempts FROM photo_guess_requests WHERE family_id = ? ORDER BY photo_id")
      .bind(familyId)
      .all<{ photo_id: string; state: string; batch_id: string | null; attempts: number }>()
  ).results;
}

/** Claude を呼ばないまま（キーなし）写真を n 枚登録する */
async function familyWithPhotos(t: TestApp, n: number, opts: { isDemo?: boolean } = {}) {
  const f = await createFamily(t, opts.isDemo ?? false);
  const m = await addMember(t, f.cookie);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await addPhoto(t, m.cookie, 100 + i, { takenAt: "1985-08-12T10:30:00", latitude: 31.6, longitude: 130.56 })).id);
  await t.flush();
  return { ...f, cookie: m.cookie, memberId: m.id, photoIds: ids };
}

describe("説明の機械検査", () => {
  it("空、200 字を超えるもの、続柄の語、感想の語を止める", () => {
    expect(checkPhotoGuess({ description: "屋外の公園。大人二人が並んで立っている。" })).toBeNull();
    expect(checkPhotoGuess({ description: "  " })).toBe("empty");
    expect(checkPhotoGuess({ description: "あ".repeat(201) })).toBe("too_long");
    expect(checkPhotoGuess({ description: "あ".repeat(200) })).toBeNull();
    for (const w of PHOTO_GUESS_KINSHIP_WORDS) expect(checkPhotoGuess({ description: `台所に${w}らしい人がいる` })).toBe("kinship");
    for (const w of PHOTO_GUESS_FEELING_WORDS) expect(checkPhotoGuess({ description: `海辺。${w}そうな様子` })).toBe("feeling");
  });

  it("プロンプトは v1 を使う", () => {
    expect(PROMPTS.photo_guess.version).toBe("photo_guess/v1");
  });
});

describe("登録の後に、一枚ずつ説明を作る（しきい値以下）", () => {
  it("写真ごとに一度だけ呼び、モデルと版と一緒に photo_guesses に入れる。作業の記録は残らない", async () => {
    const f0 = fakeClaude({ replies: [guessReply(), guessReply(), guessReply()] });
    const t = makeTestApp(d1, { claude: f0.claude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    // 並んで届いた登録の背景処理が重なっても、同じ写真を二度呼ばない
    const ids = await Promise.all([1, 2, 3].map((n) => addPhoto(t, m.cookie, n).then((p) => p.id)));
    await t.flush();

    expect(messageCalls(f0.requests)).toHaveLength(3);
    const guesses = await t.deps.repos.photoGuesses.listByFamily(f.familyId);
    expect(guesses.map((g) => g.photoId).sort()).toEqual([...ids].sort());
    for (const g of guesses) {
      expect(g).toMatchObject({ familyId: f.familyId, model: "claude-haiku-5-5", promptVersion: "photo_guess/v1" });
      expect(g.description).toContain(SECRET);
    }
    expect(await requestRows(f.familyId)).toEqual([]);

    // もう一度回しても、呼ばない（冪等）
    await runPhotoGuesses(t.deps, f.familyId);
    expect(messageCalls(f0.requests)).toHaveLength(3);
    expect(await t.deps.repos.photoGuesses.listByFamily(f.familyId)).toHaveLength(3);
  });

  it("候補を読んだ後にほかの処理が説明を入れた写真は、取らない（作業の行が消えた後でも二度呼ばない）", async () => {
    const t = makeTestApp(d1);
    const f = await familyWithPhotos(t, 1);
    const photoId = f.photoIds[0]!;
    const repo = t.deps.repos.photoGuesses;
    const version = PROMPTS.photo_guess.version;
    const opts = { staleBefore: 0, batchStaleBefore: 0, maxAttempts: 3 };
    // キーなしで登録したので、作業の行は「取り直せる」状態で残っている。一度消して、まっさらな候補にする
    await d1.prepare("DELETE FROM photo_guess_requests WHERE family_id = ?").bind(f.familyId).run();
    // 処理 B が候補を読む
    expect((await repo.listCandidates(f.familyId, version, 10, opts)).map((p) => p.id)).toEqual([photoId]);
    // 処理 A が取って、説明を入れる（作業の行は消える）
    expect(await repo.claim(f.familyId, [photoId], version, { now: 1, ...opts })).toEqual([photoId]);
    await repo.saveGuess({ id: crypto.randomUUID(), photoId, familyId: f.familyId, description: "架空", model: "m", promptVersion: version, createdAt: 1 });
    expect(await requestRows(f.familyId)).toEqual([]);
    // 処理 B が、読んだ候補を取ろうとしても取れない
    expect(await repo.claim(f.familyId, [photoId], version, { now: 2, ...opts })).toEqual([]);
    expect(await requestRows(f.familyId)).toEqual([]);
    // ほかの家族の写真も取れない
    const other = await familyWithPhotos(t, 1);
    expect(await repo.claim(f.familyId, [other.photoIds[0]!], version, { now: 3, ...opts })).toEqual([]);
  });

  it("渡すのは縮小済みの画像だけ。撮影日・位置・持ち主の呼ばれ方は渡さない。Haiku で、版のプロンプトを system に", async () => {
    const f0 = fakeClaude({ replies: [guessReply()] });
    const t = makeTestApp(d1, { claude: f0.claude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie, { calledAs: "架空のよびな" });
    await addPhoto(t, m.cookie, 7, { takenAt: "1985-08-12T10:30:00", latitude: 31.6, longitude: 130.56 });
    await t.flush();

    const body = messageCalls(f0.requests)[0]!.body as any;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe(PROMPTS.photo_guess.text);
    const content = body.messages[0].content;
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
    const sent = JSON.stringify(body.messages);
    expect(sent).not.toContain("1985");
    expect(sent).not.toContain("31.6");
    expect(sent).not.toContain("130.56");
    expect(sent).not.toContain("架空のよびな");
  });

  it("Claude が失敗しても写真の登録は 201。失敗は記録し、上限の回数でやめる", async () => {
    // 500 は再試行を含めて 2 回送る
    const f0 = fakeClaude({ replies: [] });
    const t = makeTestApp(d1, { claude: f0.claude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    await t.flush();
    expect(p.id).toBeTruthy();
    expect(await requestRows(f.familyId)).toEqual([{ photo_id: p.id, state: "failed", batch_id: null, attempts: 1 }]);

    // 待つ時間の内側では取り直さない（一時的な障害の間に、続く登録で回数を使い切らない）
    for (let i = 0; i < 3; i++) await runPhotoGuesses(t.deps, f.familyId);
    expect(messageCalls(f0.requests)).toHaveLength(2);
    expect((await requestRows(f.familyId))[0]).toMatchObject({ attempts: 1 });

    for (let i = 0; i < PHOTO_GUESS_MAX_ATTEMPTS + 2; i++) {
      laterThanRetryWait(t);
      await runPhotoGuesses(t.deps, f.familyId);
    }
    expect(messageCalls(f0.requests)).toHaveLength(PHOTO_GUESS_MAX_ATTEMPTS * 2);
    expect(await requestRows(f.familyId)).toEqual([{ photo_id: p.id, state: "failed", batch_id: null, attempts: PHOTO_GUESS_MAX_ATTEMPTS }]);
    expect(await t.deps.repos.photoGuesses.listByFamily(f.familyId)).toEqual([]);
  });

  it("続柄を決めつけた説明は、検査で止めて入れない", async () => {
    const f0 = fakeClaude({ replies: [guessReply("台所に祖母と孫がいる"), guessReply("台所に祖母と孫がいる")] });
    const t = makeTestApp(d1, { claude: f0.claude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    await addPhoto(t, m.cookie, 1);
    await t.flush();
    expect(messageCalls(f0.requests)).toHaveLength(2);
    expect(await t.deps.repos.photoGuesses.listByFamily(f.familyId)).toEqual([]);
    expect((await requestRows(f.familyId))[0]).toMatchObject({ state: "failed", attempts: 1 });
  });

  it("キーがないときは、試した回数に数えない（キーを入れた後に作れる）", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, 2);
    for (let i = 0; i < PHOTO_GUESS_MAX_ATTEMPTS + 1; i++) await runPhotoGuesses(t.deps, fam.familyId);
    for (const r of await requestRows(fam.familyId)) expect(r.attempts).toBe(0);

    const f0 = fakeClaude({ replies: [guessReply(), guessReply()] });
    t.deps.claude = f0.claude;
    await runPhotoGuesses(t.deps, fam.familyId);
    expect(await t.deps.repos.photoGuesses.listByFamily(fam.familyId)).toHaveLength(2);
  });

  it("ログに説明の本文を出さない", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => void logs.push(String(s)));
    const f0 = fakeClaude({ replies: [guessReply()] });
    const t = makeTestApp(d1, { claude: f0.claude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    await addPhoto(t, m.cookie, 1);
    await t.flush();
    const all = [...logs, ...f0.logs.map((l) => JSON.stringify(l))].join("\n");
    expect(all).toContain("photo_guess_run");
    expect(all).not.toContain(SECRET);
  });
});

describe("しきい値を超えたら Batch", () => {
  it("超えたら Batch を一つ作り、同じ写真を二度入れない。終わったら回収して入れる", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);

    // 作る
    const creating = fakeClaude({ batch: { status: "in_progress" } });
    t.deps.claude = creating.claude;
    const s1 = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s1).toMatchObject({ mode: "batch", claimed: n, batchId: "msgbatch_fake" });
    expect(messageCalls(creating.requests)).toHaveLength(0);
    const created = batchCreates(creating.requests);
    expect(created).toHaveLength(1);
    const sentIds = (created[0]!.body as any).requests.map((r: any) => r.custom_id);
    expect([...sentIds].sort()).toEqual([...fam.photoIds].sort());
    expect((created[0]!.body as any).requests[0].params.model).toBe("claude-haiku-5-5");
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake" });

    // まだ終わっていない: 回収もしないし、新しい Batch も作らない
    const s2 = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s2).toMatchObject({ mode: "none", claimed: 0, batchesCollected: 0 });
    expect(batchCreates(creating.requests)).toHaveLength(1);

    // 終わった: 一枚は失敗、ほかは入れる
    const [failedId, ...okIds] = fam.photoIds;
    const rows = [
      ...okIds.map((id) => ({ custom_id: id, result: { type: "succeeded", message: fakeClaudeMessage(guessReply() as any) } })),
      { custom_id: failedId, result: { type: "expired" } },
      // 頼んでいない写真の行は拾わない
      { custom_id: "not-ours", result: { type: "succeeded", message: fakeClaudeMessage(guessReply() as any) } },
    ];
    const collecting = fakeClaude({ batch: { status: "ended", rows }, replies: [guessReply()] });
    t.deps.claude = collecting.claude;
    const s3 = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s3).toMatchObject({ batchesCollected: 1, saved: okIds.length, failed: 1, mode: "none" });
    expect(await requestRows(fam.familyId)).toEqual([{ photo_id: failedId, state: "failed", batch_id: null, attempts: 1 }]);
    expect(messageCalls(collecting.requests)).toHaveLength(0);

    // 失敗した一枚は、待つ時間の後に一枚ずつ取り直す
    laterThanRetryWait(t);
    const s3b = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s3b).toMatchObject({ mode: "call", claimed: 1, saved: 1 });
    const guesses = await t.deps.repos.photoGuesses.listByFamily(fam.familyId);
    expect(guesses).toHaveLength(n);
    expect(new Set(guesses.map((g) => g.photoId)).size).toBe(n);
    for (const g of guesses) expect(g.promptVersion).toBe("photo_guess/v1");
    expect(messageCalls(collecting.requests)).toHaveLength(1);
    expect(await requestRows(fam.familyId)).toEqual([]);

    // もう一度回しても何もしない
    const s4 = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s4).toMatchObject({ batchesCollected: 0, mode: "none" });
  });

  it("Batch を作るのに失敗したら、取った写真を失敗にする（二重に作らない）", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 2;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    const f0 = fakeClaude({ batchReplies: [{ kind: "status", status: 500 }] });
    t.deps.claude = f0.claude;
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s).toMatchObject({ mode: "batch", batchId: null, failed: n });
    expect(batchCreates(f0.requests)).toHaveLength(1);
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "failed", batch_id: null, attempts: 1 });
  });
  it("Batch が見つからなくなったら、入っていた写真を失敗にして取り直せるようにする", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    t.deps.claude = fakeClaude({ batch: { status: "in_progress" } }).claude;
    await runPhotoGuesses(t.deps, fam.familyId);

    const gone = fakeClaude({ batchReplies: [{ kind: "status", status: 404 }], replies: Array.from({ length: n }, () => guessReply()) });
    t.deps.claude = gone.claude;
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s).toMatchObject({ failed: n, mode: "none" });
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "failed", batch_id: null, attempts: 1 });
    // 待つ時間の後に、新しい Batch を作り直す（同じ写真が二つの Batch に同時に入ることはない）
    laterThanRetryWait(t);
    const s2 = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s2).toMatchObject({ mode: "batch", claimed: n });
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "working", attempts: 2 });
  });

  it("Batch に入れたまま 25 時間を過ぎた記録は、取り直せる", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    t.deps.claude = fakeClaude({ batch: { status: "in_progress" } }).claude;
    await runPhotoGuesses(t.deps, fam.familyId);
    const opts = { staleBefore: 0, maxAttempts: PHOTO_GUESS_MAX_ATTEMPTS };
    const nowMs = t.deps.now().getTime();
    // まだ期限の内側: 候補にならない
    expect(await t.deps.repos.photoGuesses.listCandidates(fam.familyId, "photo_guess/v1", 100, { ...opts, batchStaleBefore: nowMs - PHOTO_GUESS_BATCH_STALE_MS })).toEqual([]);
    // 期限の外側（時計を 25 時間と少し進めたのと同じ）
    const later = nowMs + PHOTO_GUESS_BATCH_STALE_MS + 1;
    const c = await t.deps.repos.photoGuesses.listCandidates(fam.familyId, "photo_guess/v1", 100, { ...opts, batchStaleBefore: later - PHOTO_GUESS_BATCH_STALE_MS });
    expect(c).toHaveLength(n);
  });
});

describe("毎朝の処理（デモの時計のボタン）から同じ関数で回る", () => {
  it("翌朝に進めると、終わった Batch を回収する", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n, { isDemo: true });
    t.deps.claude = fakeClaude({ batch: { status: "in_progress" } }).claude;
    await runPhotoGuesses(t.deps, fam.familyId);

    const rows = fam.photoIds.map((id) => ({ custom_id: id, result: { type: "succeeded", message: fakeClaudeMessage(guessReply() as any) } }));
    t.deps.claude = fakeClaude({ batch: { status: "ended", rows } }).claude;
    for (let i = 0; i < 3; i++) {
      const res = await t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: fam.cookie } });
      expect(res.status).toBe(200);
    }
    expect(await t.deps.repos.photoGuesses.listByFamily(fam.familyId)).toHaveLength(n);
  });
});

describe("Batch にしない指定（デモの初期化だけが使う。0038）", () => {
  it("noBatch なら、しきい値を超えても一枚ずつ呼び、Batch を作らない", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 2;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    const f0 = fakeClaude({ replies: Array.from({ length: n }, () => guessReply()) });
    t.deps.claude = f0.claude;
    const s = await runPhotoGuesses(t.deps, fam.familyId, { noBatch: true });
    expect(s).toMatchObject({ mode: "call", claimed: n, saved: n, failed: 0, batchId: null });
    expect(batchCreates(f0.requests)).toHaveLength(0);
    expect(messageCalls(f0.requests)).toHaveLength(n);
    expect(await requestRows(fam.familyId)).toEqual([]);
  });

  it("毎朝の処理（Cron と同じ runMorning、指定なし）では、従来どおりしきい値を超えたら Batch", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    const f0 = fakeClaude({ batch: { status: "in_progress" } });
    t.deps.claude = f0.claude;
    await runMorning(t.deps, new Date("2026-11-05T00:00:00Z"), { familyId: fam.familyId });
    expect(batchCreates(f0.requests)).toHaveLength(1);
    // 写真の説明は一枚ずつ呼ばない（入り口の呼び出しはある）
    const guessCalls = messageCalls(f0.requests).filter((r) => (r.body as any).system === PROMPTS.photo_guess.text);
    expect(guessCalls).toHaveLength(0);
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake" });
  });
});

describe("家族向けの API に説明を出さない", () => {
  it("写真・家族・語り・入り口の応答に、説明の本文が入らない", async () => {
    const f0 = fakeClaude({ replies: [guessReply(), guessReply()] });
    const t = makeTestApp(d1, { claude: f0.claude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    await addPhoto(t, m.cookie, 2);
    await t.flush();
    expect(await t.deps.repos.photoGuesses.listByFamily(f.familyId)).toHaveLength(2);

    const urls = [
      "/api/photos",
      `/api/photos?ownerMemberId=${m.id}`,
      "/api/family",
      "/api/members",
      "/api/narrations",
      `/api/narrations?photoId=${p.id}`,
      "/api/feed",
      "/api/entrances/today",
    ];
    for (const url of urls) {
      const res = await t.app.request(url, { headers: { Cookie: m.cookie } });
      const text = await res.text();
      expect(text, url).not.toContain(SECRET);
      expect(text, url).not.toContain("description");
      expect(text, url).not.toContain("photo_guess");
    }
  });
});

/** 失敗した写真を取り直してよくなるまで、時計を進める */
function laterThanRetryWait(t: TestApp) {
  t.setNow(new Date(t.deps.now().getTime() + PHOTO_GUESS_STALE_MS + 1));
}
