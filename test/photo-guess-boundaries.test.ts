// 写真の初回整理（photo_guess）の境界: ほかの家族の写真を取らない・回収しない、デモの家族と実際の家族が混ざらない、
// 時間の予算、release の回数の戻し方、Batch の画像の大きさの上限、重複の登録で回さないこと、毎朝の処理を止めないこと。
// Claude は偽物。画像は架空のバイト列だけ。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CLAUDE_MAX_IMAGE_BASE64_CHARS } from "../src/server/adapters/anthropic-claude";
import { notConfiguredClaude } from "../src/server/core/claude";
import { runMorning } from "../src/server/core/morning";
import {
  PHOTO_GUESS_BACKGROUND_BUDGET_MS,
  PHOTO_GUESS_BATCH_MAX_IMAGE_CHARS,
  PHOTO_GUESS_CALL_CONCURRENCY,
  PHOTO_GUESS_CALL_THRESHOLD,
  PHOTO_GUESS_BATCH_STALE_MS,
  PHOTO_GUESS_MAX_ATTEMPTS,
  PHOTO_GUESS_MAX_IMAGE_BASE64_CHARS,
  PHOTO_GUESS_STALE_MS,
  PHOTO_GUESS_TIME_BUDGET_MS,
  runPhotoGuesses,
} from "../src/server/core/photo-guess";
import {
  addMember,
  addPhoto,
  createFamily,
  fakeClaude,
  fakeClaudeMessage,
  hashOf,
  makeTestApp,
  photoForm,
  postForm,
  startD1,
  tinyJpeg,
  type FakeClaudeReply,
  type FakeClaudeRequest,
  type TestApp,
} from "./helpers";

// 写真を何十枚も登録するテストがあるので、全体を並べて走らせたときの時間切れを避ける
vi.setConfig({ testTimeout: 60_000 });

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

const VERSION = "photo_guess/v1";
const guessReply = (description = "屋外。木の前に人が二人立っている。"): FakeClaudeReply => ({
  kind: "json",
  value: { description },
  model: "claude-haiku-5-5",
  inputTokens: 900,
  outputTokens: 40,
});
const messageCalls = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages");
const batchCreates = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages/batches");
const batchGets = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "GET" && r.path.startsWith("/v1/messages/batches"));
const okRow = (id: string) => ({ custom_id: id, result: { type: "succeeded", message: fakeClaudeMessage(guessReply() as any) } });

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
  for (let i = 0; i < n; i++) ids.push((await addPhoto(t, m.cookie, 500 + i)).id);
  await t.flush();
  return { ...f, cookie: m.cookie, memberId: m.id, photoIds: ids };
}

/** 保存先の画像を、架空の大きなバイト列に差し替える（登録の上限 10MB の内側なら API からも届きうる大きさ） */
async function replaceImage(t: TestApp, familyId: string, photoId: string, bytes: number) {
  const photo = (await t.deps.repos.photos.list(familyId)).find((p) => p.id === photoId)!;
  const data = new Uint8Array(bytes);
  data.set([0xff, 0xd8, 0xff, 0xe0]);
  await t.deps.photos.put(photo.storageKey, data, { contentType: "image/jpeg" });
}

describe("ほかの家族の写真を取らない・回収しない", () => {
  it("一つの家族を回しても、ほかの家族（デモの家族も）の写真は呼ばず、作業の記録も作らない", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const real = await familyWithPhotos(t, 2);
    const demo = await familyWithPhotos(t, 2, { isDemo: true });
    const beforeDemo = await requestRows(demo.familyId);

    const f0 = fakeClaude({ replies: [guessReply(), guessReply()] });
    t.deps.claude = f0.claude;
    const s = await runPhotoGuesses(t.deps, real.familyId);
    expect(s).toMatchObject({ mode: "call", claimed: 2, saved: 2 });
    expect(messageCalls(f0.requests)).toHaveLength(2);
    expect(await t.deps.repos.photoGuesses.listByFamily(real.familyId)).toHaveLength(2);
    // デモの家族は手つかず（キーなしで戻した記録のまま）
    expect(await t.deps.repos.photoGuesses.listByFamily(demo.familyId)).toEqual([]);
    expect(await requestRows(demo.familyId)).toEqual(beforeDemo);
  });

  it("同じ Batch の ID に二つの家族の写真が入っていても、回収するのは回している家族の行だけ", async () => {
    // 偽の API は Batch の ID がいつも同じなので、ID の取り違えが起きた状態を作れる
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const a = await familyWithPhotos(t, n);
    const b = await familyWithPhotos(t, n, { isDemo: true });
    t.deps.claude = fakeClaude({ batch: { status: "in_progress" } }).claude;
    expect((await runPhotoGuesses(t.deps, a.familyId)).mode).toBe("batch");
    expect((await runPhotoGuesses(t.deps, b.familyId)).mode).toBe("batch");

    // 結果には両方の家族の写真がある
    const rows = [...a.photoIds, ...b.photoIds].map(okRow);
    const ended = fakeClaude({ batch: { status: "ended", rows } });
    t.deps.claude = ended.claude;
    const s = await runPhotoGuesses(t.deps, a.familyId);
    expect(s).toMatchObject({ batchesCollected: 1, saved: n, failed: 0 });
    const ga = await t.deps.repos.photoGuesses.listByFamily(a.familyId);
    expect(ga.map((g) => g.photoId).sort()).toEqual([...a.photoIds].sort());
    // b の家族の説明は入らず、b の作業の記録は Batch に入ったまま
    expect(await t.deps.repos.photoGuesses.listByFamily(b.familyId)).toEqual([]);
    for (const r of await requestRows(b.familyId)) expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake", attempts: 1 });
    expect(await t.deps.repos.photoGuesses.listOpenBatches(a.familyId)).toEqual([]);
    expect(await t.deps.repos.photoGuesses.listOpenBatches(b.familyId)).toEqual([
      { batchId: "msgbatch_fake", familyId: b.familyId, promptVersion: VERSION },
    ]);

    // b を回すと、b の分だけが入る
    await runPhotoGuesses(t.deps, b.familyId);
    const gb = await t.deps.repos.photoGuesses.listByFamily(b.familyId);
    expect(gb.map((g) => g.photoId).sort()).toEqual([...b.photoIds].sort());
    for (const g of gb) expect(g.familyId).toBe(b.familyId);
  });

  it("Batch が見つからなくなっても、ほかの家族の行は失敗にしない", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const a = await familyWithPhotos(t, n);
    const b = await familyWithPhotos(t, n);
    t.deps.claude = fakeClaude({ batch: { status: "in_progress" } }).claude;
    await runPhotoGuesses(t.deps, a.familyId);
    await runPhotoGuesses(t.deps, b.familyId);

    // a の回収で 404。a の後半の Batch づくりは失敗させる（a の行を failed にしておく）
    t.deps.claude = fakeClaude({ batchReplies: [{ kind: "status", status: 404 }, { kind: "status", status: 400 }] }).claude;
    await runPhotoGuesses(t.deps, a.familyId);
    for (const r of await requestRows(b.familyId)) expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake", attempts: 1 });
  });

  it("ほかの家族が持っている作業の記録は、取れない", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const a = await familyWithPhotos(t, 1);
    const b = await familyWithPhotos(t, 1);
    // b の写真は、キーなしで戻されて failed・回数 0（取り直せる状態）
    expect((await requestRows(b.familyId))[0]).toMatchObject({ state: "failed", attempts: 0 });
    const now = t.deps.now().getTime();
    const got = await t.deps.repos.photoGuesses.claim(a.familyId, b.photoIds, VERSION, {
      now,
      staleBefore: now,
      batchStaleBefore: now,
      maxAttempts: PHOTO_GUESS_MAX_ATTEMPTS,
    });
    expect(got).toEqual([]);
    expect((await requestRows(b.familyId))[0]).toMatchObject({ state: "failed", attempts: 0 });
    expect(await requestRows(a.familyId)).toHaveLength(1); // a 自身の写真の記録だけ
  });
});

describe("毎朝の処理（Cron）", () => {
  it("Cron の経路（家族を指定しない）は、時計を持つデモの家族の写真を回さない", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const demo = await familyWithPhotos(t, 1, { isDemo: true });
    const before = await requestRows(demo.familyId);
    const f0 = fakeClaude({ replies: Array.from({ length: 50 }, () => guessReply()) });
    t.deps.claude = f0.claude;
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runMorning(t.deps, t.deps.now());
    expect(await t.deps.repos.photoGuesses.listByFamily(demo.familyId)).toEqual([]);
    expect(await requestRows(demo.familyId)).toEqual(before);
  });

  it("写真の整理が投げても、入り口づくりは続ける", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, 1);
    vi.spyOn(t.deps.repos.photoGuesses, "listOpenBatches").mockRejectedValue(new Error("boom"));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => void logs.push(String(s)));
    const s = await runMorning(t.deps, t.deps.now(), { familyId: fam.familyId });
    expect(s.created).toBe(1);
    expect(s.failed).toEqual([]);
    expect(logs.some((l) => l.includes('"photo_guess_run"') && l.includes('"error"'))).toBe(true);
  });
});

describe("登録の後の背景処理", () => {
  it("重複の登録（200 duplicate）では、背景処理を足さない", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    await addPhoto(t, m.cookie, 1);
    await t.flush();
    const spy = vi.fn();
    const orig = t.deps.runInBackground;
    t.deps.runInBackground = (p) => {
      spy();
      orig(p);
    };
    const meta = { contentHash: hashOf(1), width: 10, height: 10, takenAt: null, latitude: null, longitude: null };
    const res = await postForm(t, "/api/photos", photoForm(meta, tinyJpeg(1)), m.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("画像が保存先にない写真は失敗にし、Claude は呼ばない", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, 1);
    const photo = (await t.deps.repos.photos.list(fam.familyId))[0]!;
    await t.deps.photos.delete(photo.storageKey);
    const f0 = fakeClaude({ replies: [guessReply()] });
    t.deps.claude = f0.claude;
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s).toMatchObject({ mode: "call", claimed: 1, failed: 1, saved: 0 });
    expect(messageCalls(f0.requests)).toHaveLength(0);
    expect(await requestRows(fam.familyId)).toEqual([{ photo_id: photo.id, state: "failed", batch_id: null, attempts: 1 }]);
  });
});

describe("試した回数", () => {
  it("失敗の後にキーなしで回しても、回数は増えない（取ったときの 1 だけを戻す）", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, 1);
    const id = fam.photoIds[0]!;
    // 500（再試行を含めて 2 回）で一度失敗
    t.deps.claude = fakeClaude({ replies: [] }).claude;
    await runPhotoGuesses(t.deps, fam.familyId);
    expect(await requestRows(fam.familyId)).toEqual([{ photo_id: id, state: "failed", batch_id: null, attempts: 1 }]);
    // キーなし: 取って（2）戻す（1）
    t.deps.claude = notConfiguredClaude;
    for (let i = 0; i < 3; i++) {
      laterThanRetryWait(t);
      await runPhotoGuesses(t.deps, fam.familyId);
    }
    expect(await requestRows(fam.familyId)).toEqual([{ photo_id: id, state: "failed", batch_id: null, attempts: 1 }]);
    // あと 2 回失敗すると上限に届き、それ以上は呼ばない
    const f0 = fakeClaude({ replies: [] });
    t.deps.claude = f0.claude;
    for (let i = 0; i < 4; i++) {
      laterThanRetryWait(t);
      await runPhotoGuesses(t.deps, fam.familyId);
    }
    expect(messageCalls(f0.requests)).toHaveLength((PHOTO_GUESS_MAX_ATTEMPTS - 1) * 2);
    expect(await requestRows(fam.familyId)).toEqual([{ photo_id: id, state: "failed", batch_id: null, attempts: PHOTO_GUESS_MAX_ATTEMPTS }]);
  });

  it("途中で落ちたまま残った記録（working、Batch なし）は、10 分を過ぎたら取り直せるが、回数の上限は越えない", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, 1);
    const id = fam.photoIds[0]!;
    const old = t.deps.now().getTime() - PHOTO_GUESS_STALE_MS - 1;
    const opts = {
      staleBefore: t.deps.now().getTime() - PHOTO_GUESS_STALE_MS,
      batchStaleBefore: 0,
      maxAttempts: PHOTO_GUESS_MAX_ATTEMPTS,
    };
    // 回数が上限の内側: 取り直せる
    await d1.prepare("UPDATE photo_guess_requests SET state = 'working', attempts = 1, claimed_at = ? WHERE photo_id = ?").bind(old, id).run();
    expect((await t.deps.repos.photoGuesses.listCandidates(fam.familyId, VERSION, 10, opts)).map((p) => p.id)).toEqual([id]);
    // 10 分の内側: 取り直さない（ほかの処理がまだ呼んでいるかもしれない）
    await d1.prepare("UPDATE photo_guess_requests SET claimed_at = ? WHERE photo_id = ?").bind(old + 2, id).run();
    expect(await t.deps.repos.photoGuesses.listCandidates(fam.familyId, VERSION, 10, opts)).toEqual([]);
    // 回数が上限に届いたまま落ちたもの: 取り直さない（落ち続ける写真を、10 分ごとに永遠に試さない）
    await d1.prepare("UPDATE photo_guess_requests SET attempts = ?, claimed_at = ? WHERE photo_id = ?").bind(PHOTO_GUESS_MAX_ATTEMPTS, old, id).run();
    expect(await t.deps.repos.photoGuesses.listCandidates(fam.familyId, VERSION, 10, opts)).toEqual([]);
  });
});

describe("上限の値の整合", () => {
  it("一枚の画像の上限は、アダプタの上限を超えない（超えると Batch 全体が too_large になる）", () => {
    expect(PHOTO_GUESS_MAX_IMAGE_BASE64_CHARS).toBeLessThanOrEqual(CLAUDE_MAX_IMAGE_BASE64_CHARS);
  });

  it("Batch に入れたまま 25 時間を過ぎた記録も、回数の上限に届いていたら取り直さない", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, 1);
    const id = fam.photoIds[0]!;
    const nowMs = t.deps.now().getTime();
    const opts = { staleBefore: 0, batchStaleBefore: nowMs - PHOTO_GUESS_BATCH_STALE_MS, maxAttempts: PHOTO_GUESS_MAX_ATTEMPTS };
    const old = nowMs - PHOTO_GUESS_BATCH_STALE_MS - 1;
    await d1
      .prepare("UPDATE photo_guess_requests SET state = 'working', batch_id = 'msgbatch_old', attempts = ?, claimed_at = ? WHERE photo_id = ?")
      .bind(PHOTO_GUESS_MAX_ATTEMPTS - 1, old, id)
      .run();
    expect((await t.deps.repos.photoGuesses.listCandidates(fam.familyId, VERSION, 10, opts)).map((p) => p.id)).toEqual([id]);
    await d1.prepare("UPDATE photo_guess_requests SET attempts = ? WHERE photo_id = ?").bind(PHOTO_GUESS_MAX_ATTEMPTS, id).run();
    expect(await t.deps.repos.photoGuesses.listCandidates(fam.familyId, VERSION, 10, opts)).toEqual([]);
    const got = await t.deps.repos.photoGuesses.claim(fam.familyId, [id], VERSION, { now: nowMs, ...opts });
    expect(got).toEqual([]);
  });
});

describe("時間の予算", () => {
  it("予算を超えたら残りの写真は呼ばず、回数に数えずに次の回へ回す", async () => {
    const n = PHOTO_GUESS_CALL_CONCURRENCY + 2;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    const f0 = fakeClaude({ replies: Array.from({ length: n }, () => guessReply()) });
    t.deps.claude = f0.claude;
    // 一度 Claude を呼んだら、時計が予算の外に出たことにする
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + (messageCalls(f0.requests).length > 0 ? PHOTO_GUESS_TIME_BUDGET_MS + 1 : 0));
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    vi.mocked(Date.now).mockRestore();
    // 最初に並んで走り出した分だけ呼ぶ
    expect(s).toMatchObject({ mode: "call", claimed: n, saved: PHOTO_GUESS_CALL_CONCURRENCY });
    expect(messageCalls(f0.requests)).toHaveLength(PHOTO_GUESS_CALL_CONCURRENCY);
    const left = await requestRows(fam.familyId);
    expect(left).toHaveLength(n - PHOTO_GUESS_CALL_CONCURRENCY);
    for (const r of left) expect(r).toMatchObject({ state: "failed", batch_id: null, attempts: 0 });

    // 次の回で残りを作る
    const s2 = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s2).toMatchObject({ claimed: n - PHOTO_GUESS_CALL_CONCURRENCY, saved: n - PHOTO_GUESS_CALL_CONCURRENCY });
    expect(await t.deps.repos.photoGuesses.listByFamily(fam.familyId)).toHaveLength(n);
    expect(await requestRows(fam.familyId)).toEqual([]);
  });
});

describe("登録の後の背景処理の予算", () => {
  it("waitUntil の 30 秒の内側に収まる", () => {
    expect(PHOTO_GUESS_BACKGROUND_BUDGET_MS).toBeLessThan(30_000);
  });

  it("登録の後の背景処理は、短いほうの予算で止まり、残りは待たずに次の回で取り直せる", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, PHOTO_GUESS_CALL_CONCURRENCY + 1);
    const f0 = fakeClaude({ replies: Array.from({ length: 20 }, () => guessReply()) });
    t.deps.claude = f0.claude;
    // 一度 Claude を呼んだら、背景処理の予算は超えたが、毎朝の予算（60 秒）の内側の時刻にする
    const realNow = Date.now.bind(Date);
    const jump = PHOTO_GUESS_BACKGROUND_BUDGET_MS + 1;
    expect(jump).toBeLessThan(PHOTO_GUESS_TIME_BUDGET_MS);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + (messageCalls(f0.requests).length > 0 ? jump : 0));
    await addPhoto(t, fam.cookie, 900);
    await t.flush();
    vi.mocked(Date.now).mockRestore();
    expect(messageCalls(f0.requests)).toHaveLength(PHOTO_GUESS_CALL_CONCURRENCY);
    const left = await requestRows(fam.familyId);
    expect(left).toHaveLength(2);
    for (const r of left) expect(r).toMatchObject({ state: "failed", attempts: 0 });
    // 時計を進めずに次の回で残りを作れる（試していないので待たない）
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s).toMatchObject({ claimed: 2, saved: 2 });
  });
});

describe("Batch ごとの回収の失敗", () => {
  it("回収で投げても、新しい写真の説明づくりは続ける", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    t.deps.claude = fakeClaude({ batch: { status: "in_progress" } }).claude;
    await runPhotoGuesses(t.deps, fam.familyId);
    // Batch の外に、新しい写真を一枚（キーなしで戻しておく）
    t.deps.claude = notConfiguredClaude;
    const extra = await addPhoto(t, fam.cookie, 901);
    await t.flush();

    const f0 = fakeClaude({ replies: [guessReply()] });
    vi.spyOn(f0.claude, "getBatch").mockRejectedValue(new Error("boom"));
    t.deps.claude = f0.claude;
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s).toMatchObject({ batchesCollected: 0, mode: "call", claimed: 1, saved: 1 });
    expect((await t.deps.repos.photoGuesses.listByFamily(fam.familyId)).map((g) => g.photoId)).toEqual([extra.id]);
    // Batch の行はそのまま（次の回でまた回収する）
    for (const r of (await requestRows(fam.familyId)).filter((r) => r.photo_id !== extra.id)) {
      expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake", attempts: 1 });
    }
  });
});

describe("Batch の画像の大きさ", () => {
  it("合計の上限を超える分は今回の Batch に載せず、回数に数えずに次の回へ回す", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    // base64 で一枚 4MB（3MB のバイト列）。上限 24MB にちょうど 6 枚載る
    const perImageBytes = 3 * 1024 * 1024;
    const fit = PHOTO_GUESS_BATCH_MAX_IMAGE_CHARS / ((perImageBytes / 3) * 4);
    expect(fit).toBe(6);
    for (const id of fam.photoIds) await replaceImage(t, fam.familyId, id, perImageBytes);

    const f0 = fakeClaude({ batch: { status: "in_progress" } });
    t.deps.claude = f0.claude;
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s).toMatchObject({ mode: "batch", claimed: n, batchId: "msgbatch_fake", failed: 0 });
    const sent = (batchCreates(f0.requests)[0]!.body as any).requests.map((r: any) => r.custom_id) as string[];
    expect(sent).toHaveLength(fit);
    const rows = await requestRows(fam.familyId);
    const inBatch = rows.filter((r) => r.batch_id === "msgbatch_fake");
    const left = rows.filter((r) => r.batch_id === null);
    expect(inBatch.map((r) => r.photo_id).sort()).toEqual([...sent].sort());
    for (const r of inBatch) expect(r).toMatchObject({ state: "working", attempts: 1 });
    expect(left).toHaveLength(n - fit);
    for (const r of left) expect(r).toMatchObject({ state: "failed", attempts: 0 });

    // 次の回: Batch はまだ終わっていない。残りは（しきい値以下なので）一枚ずつ呼ぶ。Batch に入った写真は取らない
    const f1 = fakeClaude({ batch: { status: "in_progress" }, replies: Array.from({ length: n }, () => guessReply()) });
    t.deps.claude = f1.claude;
    const s2 = await runPhotoGuesses(t.deps, fam.familyId);
    expect(s2).toMatchObject({ mode: "call", claimed: n - fit, saved: n - fit });
    expect(batchCreates(f1.requests)).toHaveLength(0);
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake" });
  }, 60_000);

  it("一枚だけ大きすぎる画像があっても、ほかの写真の Batch を道連れにしない", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    // 一枚あたりの上限（base64 で 5MB）を超える画像。登録の上限（10MB）の内側なので API からも届きうる
    const bigBytes = Math.ceil((CLAUDE_MAX_IMAGE_BASE64_CHARS / 4) * 3) + 3;
    const bigId = fam.photoIds[0]!;
    await replaceImage(t, fam.familyId, bigId, bigBytes);

    const f0 = fakeClaude({ batch: { status: "in_progress" } });
    t.deps.claude = f0.claude;
    const s = await runPhotoGuesses(t.deps, fam.familyId);
    // 期待: 大きすぎる一枚を外して、残りで Batch を作る
    const created = batchCreates(f0.requests);
    expect(created).toHaveLength(1);
    const sent = (created[0]!.body as any).requests.map((r: any) => r.custom_id) as string[];
    expect(sent).not.toContain(bigId);
    expect(sent).toHaveLength(n - 1);
    expect(s.batchId).toBe("msgbatch_fake");
    for (const r of await requestRows(fam.familyId)) {
      if (r.photo_id === bigId) expect(r.state).toBe("failed");
      else expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake", attempts: 1 });
    }
  }, 60_000);
});

describe("Batch の回収の境界", () => {
  it("in_progress の Batch には結果を取りに行かない。ended のときだけ取りに行く", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    t.deps.claude = fakeClaude({ batch: { status: "in_progress" } }).claude;
    await runPhotoGuesses(t.deps, fam.familyId);

    const waiting = fakeClaude({ batch: { status: "in_progress" } });
    t.deps.claude = waiting.claude;
    await runPhotoGuesses(t.deps, fam.familyId);
    expect(batchGets(waiting.requests).some((r) => r.path.endsWith("/results"))).toBe(false);

    const canceling = fakeClaude({ batch: { status: "canceling" } });
    t.deps.claude = canceling.claude;
    await runPhotoGuesses(t.deps, fam.familyId);
    expect(batchGets(canceling.requests).some((r) => r.path.endsWith("/results"))).toBe(false);
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "working", attempts: 1 });
  });

  it("結果が欠けた写真は、上限の回数まで取り直し、それ以上は Batch にも入れない", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const fam = await familyWithPhotos(t, n);
    // 毎回、Batch は終わっているが結果は空（全部欠け）。作り直しも同じ ID で受け付ける
    const f0 = fakeClaude({ batch: { status: "ended", rows: [] } });
    t.deps.claude = f0.claude;
    for (let i = 0; i < PHOTO_GUESS_MAX_ATTEMPTS + 3; i++) {
      laterThanRetryWait(t);
      await runPhotoGuesses(t.deps, fam.familyId);
    }
    expect(batchCreates(f0.requests)).toHaveLength(PHOTO_GUESS_MAX_ATTEMPTS);
    for (const r of await requestRows(fam.familyId)) expect(r).toMatchObject({ state: "failed", batch_id: null, attempts: PHOTO_GUESS_MAX_ATTEMPTS });
  });
});

/** 失敗した写真を取り直してよくなるまで、時計を進める */
function laterThanRetryWait(t: TestApp) {
  t.setNow(new Date(t.deps.now().getTime() + PHOTO_GUESS_STALE_MS + 1));
}
