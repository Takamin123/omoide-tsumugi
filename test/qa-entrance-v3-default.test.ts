// 入り口の既定を v3 にした後の境界（0046、qa-engineer）。
// - 生きているむすびが無い家族でも、既定の v3 は input_musubi_ids を [] で残す（null にしない）。<same_event> は渡さない
// - むすびがすべて rejected で 2 枚未満になる家族も [] で残す
// - デモの家族: 時計のボタン（Cron と同じ runMorning）で翌朝に進めると、v3 の入り口ができ、家族向けの API には新しい列が出ない
// - デモの初期化（demo-reset）は既定の v3 で落ちず、その後の時計のボタンでも v3 の入り口ができる
// - 時計のボタンの中で、むすびの読み出しが落ちても 200 で、全員に固定の入り口が出る
// Claude は偽物（入り口だけ）。写真・録音は架空の数バイト。家族はすべて架空。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import { ENTRANCE_VERSION } from "../src/server/core/entrance-claude";
import { runMorning } from "../src/server/core/morning";
import type { ClaudeCallRequest, ClaudeCallResult, ClaudeClient } from "../src/server/core/ports";
import { SEED_MEMBERS, SEED_NARRATIONS, SEED_PHOTOS, seedPhotoKey, seedVoiceKey } from "../src/server/demo/seed";
import { createR2PhotoStore } from "../src/server/platform/cloudflare/r2-photo-store";
import { DEMO_RESET_TOKEN, addMember, addPhoto, createFamily, makeTestApp, onlyPurpose, postForm, startD1, type TestApp } from "./helpers";

vi.setConfig({ testTimeout: 60_000 });

let d1: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, bucket, dispose } = await startD1());
  for (const p of SEED_PHOTOS) await bucket.put(seedPhotoKey(p), new Uint8Array([0xff, 0xd8, 1, 2]), { httpMetadata: { contentType: "image/jpeg" } });
  for (const n of SEED_NARRATIONS) {
    if (n.kind !== "voice") continue;
    await bucket.put(seedVoiceKey(n), new Uint8Array([7, 7, 7]), { httpMetadata: { contentType: "audio/mp4" } });
  }
}, 60_000);
afterAll(() => dispose());

const NOW = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00
const DEMO_NOW = new Date("2026-11-02T00:00:00Z");

/** 候補の先頭を選ぶ偽物の入り口。版を記録し、v3 なら receiver_present を返す */
function entranceClaude() {
  const versions: string[] = [];
  const sent: string[] = [];
  const claude: ClaudeClient = {
    async call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>> {
      versions.push(req.prompt.version);
      const text = req.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      sent.push(text);
      const first = [...text.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1]!)[0]!;
      const base = { reason: "架空の理由", photo_id: first, focus: null, quote: null, question: "この日のことを、聞かせてください" };
      const value = (req.prompt.version === "entrance/v3" ? { receiver_present: "unknown", ...base } : base) as T;
      const meta = { purpose: req.prompt.purpose, model: "claude-fake", promptVersion: req.prompt.version, inputTokens: 1, outputTokens: 1, attempts: 1 };
      const violation = req.check?.(value) ?? null;
      if (violation) return { ok: false, reason: "check_failed", violation, meta };
      return { ok: true, value, meta };
    },
    createBatch: (req) => notConfiguredClaude.createBatch(req),
    getBatch: (id) => notConfiguredClaude.getBatch(id),
    getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
  };
  return { claude: onlyPurpose(claude, "entrance"), versions, sent };
}

async function postText(t: TestApp, cookie: string, photoId: string, text: string) {
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId, entranceId: null, replyToId: null, text }));
  expect((await postForm(t, "/api/narrations", form, cookie)).ok).toBe(true);
}

const rowsFor = async (familyId: string, forDate: string) =>
  (
    await d1
      .prepare("SELECT member_id, kind, prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE family_id = ? AND for_date = ?")
      .bind(familyId, forDate)
      .all<Record<string, unknown>>()
  ).results;

const advance = (t: TestApp, cookie: string) => t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: cookie } });

const SECRETS = ["receiverPresent", "receiver_present", "inputMusubiIds", "input_musubi_ids", "musubi", "same_event", "entrance/v3"];

describe("既定は v3", () => {
  it("ENTRANCE_VERSION は v3", () => {
    expect(ENTRANCE_VERSION).toBe("v3");
  });
});

describe("生きているむすびが無い家族の v3", () => {
  async function family(t: TestApp) {
    const f = await createFamily(t);
    const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
    const elder = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
    const x = await addPhoto(t, gc.cookie, 501);
    const y = await addPhoto(t, gc.cookie, 502);
    await postText(t, gc.cookie, y.id, "架空の夜店の話");
    await postText(t, elder.cookie, x.id, "架空の盆踊りの話");
    await t.flush();
    return { familyId: f.familyId, x: x.id, y: y.id, elderId: elder.id };
  }

  it("むすびが一つもなければ input_musubi_ids は []（null ではない）、<same_event> は渡さない", async () => {
    const fake = entranceClaude();
    const t = makeTestApp(d1, { claude: fake.claude });
    const s = await family(t);
    const summary = await runMorning(t.deps, NOW, { familyId: s.familyId });
    expect(summary.failed).toEqual([]);
    expect(fake.versions.length).toBeGreaterThan(0);
    expect(new Set(fake.versions)).toEqual(new Set(["entrance/v3"]));
    for (const text of fake.sent) expect(text).not.toContain("same_event");
    const rows = await rowsFor(s.familyId, "2026-11-03");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row).toMatchObject({ kind: "claude", prompt_version: "entrance/v3", receiver_present: "unknown", input_musubi_ids: "[]" });
    }
  });

  it("rejected で 2 枚未満になったむすびだけなら、input_musubi_ids は []", async () => {
    const fake = entranceClaude();
    const t = makeTestApp(d1, { claude: fake.claude });
    const s = await family(t);
    const muId = `mu-rej-${crypto.randomUUID()}`;
    await d1
      .prepare("INSERT INTO musubi (id, family_id, created_by, guessed_reason, guessed_evidence_record_ids, model, prompt_version, created_at) VALUES (?, ?, 'guessed', '架空', '[]', 'm', 'musubi_guess/v1', 1)")
      .bind(muId, s.familyId)
      .run();
    await d1.prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES (?, ?, ?, 'guessed', 1)").bind(muId, s.x, s.familyId).run();
    await d1
      .prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, decided_by_member_id, decided_at, created_at) VALUES (?, ?, ?, 'rejected', ?, 2, 1)")
      .bind(muId, s.y, s.familyId, s.elderId)
      .run();
    const summary = await runMorning(t.deps, NOW, { familyId: s.familyId });
    expect(summary.failed).toEqual([]);
    for (const text of fake.sent) {
      expect(text).not.toContain("same_event");
      expect(text).not.toContain(muId);
    }
    for (const row of await rowsFor(s.familyId, "2026-11-03")) {
      expect(row).toMatchObject({ kind: "claude", prompt_version: "entrance/v3", input_musubi_ids: "[]" });
    }
  });
});

describe("デモの家族の流れ（時計のボタン）", () => {
  async function demo(t: TestApp) {
    const f = await createFamily(t, true);
    const mother = await addMember(t, f.cookie, { relation: "母", calledAs: "架空のはは" });
    const elder = await addMember(t, mother.cookie, { role: "elder", relation: "祖母", calledAs: "架空のそぼ" });
    const p1 = await addPhoto(t, mother.cookie, 601);
    const p2 = await addPhoto(t, mother.cookie, 602);
    await postText(t, mother.cookie, p1.id, "架空の運動会の話");
    await t.flush();
    return { familyId: f.familyId, mother, elder, photos: [p1.id, p2.id] };
  }

  it("翌朝に進めると v3 の入り口ができ、家族向けの API には新しい列が出ない", async () => {
    const fake = entranceClaude();
    const t = makeTestApp(d1, { claude: fake.claude, now: DEMO_NOW });
    const s = await demo(t);
    expect((await advance(t, s.mother.cookie)).status).toBe(200);
    expect(new Set(fake.versions)).toEqual(new Set(["entrance/v3"]));
    const rows = await rowsFor(s.familyId, "2026-11-03");
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row).toMatchObject({ kind: "claude", prompt_version: "entrance/v3", receiver_present: "unknown", input_musubi_ids: "[]" });

    for (const who of [s.elder, s.mother]) {
      const res = await t.app.request("/api/entrances/today", { headers: { Cookie: who.cookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      for (const secret of SECRETS) expect(body).not.toContain(secret);
      expect((JSON.parse(body) as { entrance: { forDate: string } }).entrance.forDate).toBe("2026-11-03");
    }
  });

  it("時計のボタンの中で、むすびの読み出しが落ちても 200 で、全員に固定の入り口が出る（Claude は呼ばない）", async () => {
    const fake = entranceClaude();
    const t = makeTestApp(d1, { claude: fake.claude, now: DEMO_NOW });
    const s = await demo(t);
    t.deps.repos = { ...t.deps.repos, musubi: { ...t.deps.repos.musubi, listByFamily: () => Promise.reject(new Error("架空の読み出しの失敗")) } };
    expect((await advance(t, s.mother.cookie)).status).toBe(200);
    expect(fake.versions).toEqual([]);
    const rows = await rowsFor(s.familyId, "2026-11-03");
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row).toMatchObject({ kind: "fixed", prompt_version: null, receiver_present: null, input_musubi_ids: null });
  });
});

describe("デモの初期化（demo-reset）と既定の v3", () => {
  it("初期化は 200 で、その後に翌朝へ進めると v3 の入り口ができる（新しい列は家族向けの API に出ない）", async () => {
    const fake = entranceClaude();
    const t = makeTestApp(d1, { claude: fake.claude, now: DEMO_NOW });
    t.deps.photos = createR2PhotoStore(bucket);
    const f = await createFamily(t, true);
    const order = [...SEED_MEMBERS].sort((a, b) => (a.role === b.role ? 0 : a.role === "family" ? -1 : 1));
    const first = await addMember(t, f.cookie, { calledAs: order[0]!.calledAs, role: order[0]!.role, relation: "架空" });
    for (const m of order.slice(1)) await addMember(t, first.cookie, { calledAs: m.calledAs, role: m.role, relation: "架空" });

    const res = await t.app.request(`/api/demo/families/${f.familyId}/reset`, { method: "POST", headers: { Authorization: `Bearer ${DEMO_RESET_TOKEN}` } });
    expect(res.status).toBe(200);
    // 初期化で入れた入り口は、新しい列が null のまま（種の入り口）
    const seeded = (
      await d1.prepare("SELECT kind, prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE family_id = ?").bind(f.familyId).all<Record<string, unknown>>()
    ).results;
    for (const row of seeded) {
      if (row.prompt_version === "entrance/v3") continue; // 初期化の中の毎朝の処理が作った分は v3
      expect(row).toMatchObject({ receiver_present: null, input_musubi_ids: null });
    }

    const clock = ((await (await t.app.request("/api/family", { headers: { Cookie: first.cookie } })).json()) as { family: { clock: { date: string } } }).family.clock;
    const next = new Date(Date.parse(`${clock.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await advance(t, first.cookie)).status).toBe(200);
    const rows = await rowsFor(f.familyId, next);
    expect(rows.length).toBeGreaterThan(0);
    const claudeRows = rows.filter((r) => r.kind === "claude");
    expect(claudeRows.length).toBeGreaterThan(0);
    for (const row of claudeRows) {
      expect(row.prompt_version).toBe("entrance/v3");
      expect(row.receiver_present).toBe("unknown");
      expect(Array.isArray(JSON.parse(row.input_musubi_ids as string))).toBe(true);
    }
    expect(fake.versions.every((v) => v === "entrance/v3")).toBe(true);

    const today = await t.app.request("/api/entrances/today", { headers: { Cookie: first.cookie } });
    expect(today.status).toBe(200);
    const body = await today.text();
    for (const secret of SECRETS) expect(body).not.toContain(secret);
  });
});
