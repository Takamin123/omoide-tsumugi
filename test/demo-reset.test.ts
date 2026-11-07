// デモの初期化（POST /api/demo/families/:familyId/reset。0038）を、手元の D1・R2（メモリの中）で確かめる。
// 守ること（implementation-policy 5）: 初期化の鍵の確かめ、デモの家族の外に触れないこと、冪等、毎朝の処理と同じ関数を通ること。
// 家族はすべて架空。R2 に入れるのは数バイトの架空のバイト列だけ（本物の写真・声ではない）。Claude はキーなし（固定の入り口になる）。
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkMarked, quoteText } from "../src/server/core/clean-transcript";
import { notConfiguredClaude } from "../src/server/core/claude";
import { buildSeedRows, matchSeedMembers } from "../src/server/core/demo-reset";
import { DEMO_RESET_TABLES, type ClaudeClient, type MemberRow } from "../src/server/core/ports";
import { SEED_CLEANED } from "../src/server/demo/seed-cleaned";
import { SEED_ENTRANCES, SEED_MEMBERS, SEED_NARRATIONS, SEED_PHOTOS, seedPhotoKey, seedVoiceKey } from "../src/server/demo/seed";
import { placeName } from "../src/server/core/place";
import * as schema from "../src/server/db/schema";
import { createR2PhotoStore } from "../src/server/platform/cloudflare/r2-photo-store";
import { demoResetKeyMisconfig } from "../src/server/routes/auth";
import {
  CREATE_TOKEN,
  DEMO_RESET_TOKEN,
  OPS_TOKEN,
  addMember,
  addPhoto,
  createFamily,
  fakeClaude,
  makeTestApp,
  startD1,
  type TestApp,
} from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

let d1: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, bucket, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
// 手元の D1・R2 で家族を何組も作るので、全体を走らせたときの混み合いでも落ちない長さにする
vi.setConfig({ testTimeout: 60_000 });

const NOW = new Date("2026-11-02T00:00:00Z"); // 日本時間 2026-11-02 9:00
const AS_OF = "2026-11-02";

const tables: SQLiteTable[] = (Object.values(schema) as unknown[]).filter((t): t is SQLiteTable => is(t, SQLiteTable));
const tableNames = tables.map((t) => getTableConfig(t).name);

/** その家族の全表の行（並びを決めて） */
async function dumpFamily(familyId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of tableNames.sort()) {
    const col = name === "families" ? "id" : "family_id";
    out[name] = (await d1.prepare(`SELECT * FROM ${name} WHERE ${col} = ? ORDER BY 1, 2`).bind(familyId).all()).results;
  }
  return out;
}

async function r2Keys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys.sort();
}

/** 種の写真・録音（架空の数バイト）を demo/seed/ に置く */
async function putSeedAssets(opts: { skipVoice?: string } = {}) {
  for (const p of SEED_PHOTOS) await bucket.put(seedPhotoKey(p), new Uint8Array([0xff, 0xd8, 1, 2]), { httpMetadata: { contentType: "image/jpeg" } });
  for (const n of SEED_NARRATIONS) {
    if (n.kind !== "voice") continue;
    const key = seedVoiceKey(n);
    if (n.label === opts.skipVoice) await bucket.delete(key);
    else await bucket.put(key, new Uint8Array([7, 7, 7]), { httpMetadata: { contentType: "audio/mp4" } });
  }
}

function appWithR2(opts: { demoResetToken?: string | null } = {}): TestApp {
  const t = makeTestApp(d1, { now: NOW });
  t.deps.photos = createR2PhotoStore(bucket);
  if (opts.demoResetToken !== undefined) t.deps.config = { ...t.deps.config, demoResetToken: opts.demoResetToken };
  return t;
}

/** 運営が画面で作るのと同じ道で、デモの家族と台本の 4 人を作る */
async function demoFamily(t: TestApp, members: readonly { calledAs: string; role: "elder" | "family" }[] = SEED_MEMBERS) {
  const f = await createFamily(t, true);
  // 最初の人は家族の画面の人（祖父母の画面の人は家族のことを触れない）
  const order = [...members].sort((a, b) => (a.role === b.role ? 0 : a.role === "family" ? -1 : 1));
  const first = await addMember(t, f.cookie, { calledAs: order[0]!.calledAs, role: order[0]!.role, relation: "架空" });
  for (const m of order.slice(1)) await addMember(t, first.cookie, { calledAs: m.calledAs, role: m.role, relation: "架空" });
  return { familyId: f.familyId, cookie: first.cookie };
}

/** デモの家族に、戻す前の中身（全部の表に一行ずつ）とファイルを入れる（デモで遊んだ後の状態） */
async function dirty(familyId: string) {
  const m = (await d1.prepare("SELECT id FROM members WHERE family_id = ? LIMIT 1").bind(familyId).first<{ id: string }>())!.id;
  const p = familyId.slice(0, 8);
  const pre = `families/${familyId}`;
  const keys = { photo: `${pre}/photos/${p}-old.jpg`, audio: `${pre}/audio/${p}-old`, speech: `${pre}/speech/${p}-old.mp3` };
  await d1.batch([
    d1
      .prepare("INSERT INTO photos (id, family_id, owner_member_id, storage_key, content_hash, width, height, created_at) VALUES (?, ?, ?, ?, 'h', 1, 1, 1)")
      .bind(`${p}-ph`, familyId, m, keys.photo),
    d1
      .prepare("INSERT INTO photo_guesses (id, photo_id, family_id, description, model, prompt_version, created_at) VALUES (?, ?, ?, '架空', 'm', 'v1', 1)")
      .bind(`${p}-pg`, `${p}-ph`, familyId),
    d1
      .prepare("INSERT INTO photo_guess_requests (photo_id, prompt_version, family_id, state, attempts, claimed_at) VALUES (?, 'v2', ?, 'failed', 1, 1)")
      .bind(`${p}-ph`, familyId),
    d1
      .prepare(
        "INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, question, kind, model, prompt_version, question_audio_key, created_at) VALUES (?, ?, ?, '2026-11-05', ?, '架空の問い', 'claude', 'm', 'v2', ?, 1)",
      )
      .bind(`${p}-e1`, familyId, m, `${p}-ph`, keys.speech),
    d1
      .prepare(
        "INSERT INTO narrations (id, family_id, speaker_member_id, photo_id, entrance_id, kind, audio_key, transcript_status, for_date, created_at) VALUES (?, ?, ?, ?, ?, 'voice', ?, 'done', '2026-11-05', 1)",
      )
      .bind(`${p}-n1`, familyId, m, `${p}-ph`, `${p}-e1`, keys.audio),
    d1
      .prepare("INSERT INTO records (id, family_id, photo_id, kind, value, origin, told_by_member_id, narration_id, created_at) VALUES (?, ?, ?, 'place', '架空', 'told', ?, ?, 1)")
      .bind(`${p}-r1`, familyId, `${p}-ph`, m, `${p}-n1`),
    d1
      .prepare(
        "INSERT INTO record_extractions (narration_id, family_id, prompt_version, model, state, attempts, input_tokens, output_tokens, created_at) VALUES (?, ?, 'extract_records/v1', 'm', 'done', 1, 1, 1, 1)",
      )
      .bind(`${p}-n1`, familyId),
    d1.prepare("INSERT INTO musubi (id, family_id, created_by, created_at) VALUES (?, ?, 'family', 1)").bind(`${p}-mu`, familyId),
    d1
      .prepare(
        "INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, evidence_narration_id, decided_by_member_id, decided_at, created_at) VALUES (?, ?, ?, 'confirmed', ?, ?, 1, 1)",
      )
      .bind(`${p}-mu`, `${p}-ph`, familyId, `${p}-n1`, m),
    d1
      .prepare(
        "INSERT INTO musubi_guess_runs (family_id, input_key, prompt_version, model, state, attempts, input_tokens, output_tokens, created_at) VALUES (?, ?, 'musubi_guess/v1', 'm', 'done', 1, 1, 1, 1)",
      )
      .bind(familyId, `${p}-key`),
    // 時計は進めた後
    d1.prepare("UPDATE families SET clock_date = '2026-11-05', clock_slot = 'night' WHERE id = ?").bind(familyId),
    // 「返事」のタブを開いた後（0058）
    d1.prepare("UPDATE members SET replies_seen_at = 4102444800000 WHERE family_id = ?").bind(familyId),
  ]);
  for (const k of Object.values(keys)) await bucket.put(k, new Uint8Array([1, 2, 3]));
  return keys;
}

const reset = (t: TestApp, familyId: string, token: string | null = DEMO_RESET_TOKEN, extra: Record<string, string> = {}) =>
  t.app.request(`/api/demo/families/${familyId}/reset`, {
    method: "POST",
    headers: { ...(token !== null ? { Authorization: `Bearer ${token}` } : {}), ...extra },
  });

/** 二度の初期化を比べるため、ID と鍵を印に置き換えた中身 */
async function normalized(familyId: string) {
  const d = await dumpFamily(familyId);
  const idCols = new Set(["id", "photo_id", "entrance_id", "reply_to_id", "quote_narration_id", "storage_key", "audio_key", "narration_id", "question_audio_key", "input_narration_ids"]);
  const out: Record<string, unknown> = {};
  for (const name of ["photos", "narrations", "entrances"]) {
    const rows = d[name] as Record<string, unknown>[];
    out[name] = rows
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, idCols.has(k) && v !== null ? "<id>" : v])))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  out.counts = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length]));
  out.families = d.families;
  out.members = d.members;
  out.invite_links = d.invite_links;
  return out;
}

describe("種そのもの", () => {
  it("台本の 4 人・写真 12 枚・語り 11 本・固定の入り口 4 つ（n12 は撮影で送る。2026-11-04）", () => {
    expect(SEED_MEMBERS.map((m) => `${m.calledAs}:${m.role}`)).toEqual(["じいちゃん:elder", "お母さん:family", "まさとおじさん:family", "ゆい:family"]);
    expect(SEED_PHOTOS).toHaveLength(12);
    expect(SEED_NARRATIONS).toHaveLength(11);
    expect(SEED_NARRATIONS.filter((n) => n.kind === "voice").map((n) => n.label)).toEqual(["n1", "n7", "n8"]);
    expect(SEED_ENTRANCES.map((e) => e.label)).toEqual(["E1", "E2", "E3", "E4"]);
  });

  it("声の語りの整えた文字は、本物の Haiku の結果で、アプリと同じ検査を通る（モデルと版つき）", () => {
    for (const n of SEED_NARRATIONS.filter((x) => x.kind === "voice")) {
      const c = SEED_CLEANED[n.label]!;
      expect(c, n.label).toBeTruthy();
      expect(checkMarked(n.text, c.cleanedText), n.label).toBeNull();
      expect(c.cleanedModel).toMatch(/^claude-haiku-/);
      expect(c.cleanedPromptVersion).toMatch(/^clean_transcript\/v\d+$/);
    }
    // 文字の語りには整えた文字を作らない
    expect(Object.keys(SEED_CLEANED).sort()).toEqual(["n1", "n7", "n8"]);
  });

  it("入り口への答えは入り口と同じ写真、返事は同じ写真の語りへ。語りの日は入り口の日の中で入り口の後", () => {
    const ent = new Map(SEED_ENTRANCES.map((e) => [e.label, e]));
    const nar = new Map(SEED_NARRATIONS.map((n) => [n.label, n]));
    for (const n of SEED_NARRATIONS) {
      if (n.entrance) {
        const e = ent.get(n.entrance)!;
        expect(n.photo).toBe(e.photo);
        expect(n.daysAgo).toBe(e.daysAgo);
        expect(n.at > e.shownAt).toBe(true);
      }
      if (n.replyTo) {
        const to = nar.get(n.replyTo)!;
        expect(n.photo).toBe(to.photo);
        expect(n.daysAgo * 10000 - Number(n.at.replace(":", ""))).toBeLessThan(to.daysAgo * 10000 - Number(to.at.replace(":", "")));
      }
    }
  });

  it("組んだ行: 引用は台本の文字そのもの、固定の入り口は Claude の言葉を持たない、鍵は families/<id>/ の下", () => {
    const fid = "11111111-0000-4000-8000-000000000001";
    const people = new Map(SEED_MEMBERS.map((m, i) => [m.calledAs, { id: `m${i}`, calledAs: m.calledAs, role: m.role } as MemberRow]));
    const rows = buildSeedRows(fid, AS_OF, people);
    const byId = new Map(rows.narrations.map((n) => [n.row.id, n.row]));
    for (const [i, e] of rows.entrances.entries()) {
      expect(e).toMatchObject({ kind: "fixed", question: null, model: null, reason: null, promptVersion: null });
      expect(quoteText(byId.get(e.quoteNarrationId!)!, e.quoteStart, e.quoteEnd)).toBe(SEED_ENTRANCES[i]!.quote.text);
    }
    for (const p of rows.photos) expect(p.row.storageKey.startsWith(`families/${fid}/`)).toBe(true);
    for (const n of rows.narrations) if (n.row.audioKey) expect(n.row.audioKey.startsWith(`families/${fid}/`)).toBe(true);
    expect(rows.narrations.map((n) => n.row.forDate)).toEqual(SEED_NARRATIONS.map((n) => {
      const d = new Date(`${AS_OF}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - n.daysAgo);
      return d.toISOString().slice(0, 10);
    }));
  });

  it("場所は架空の公開の代表点（小数第 2 位）: 伊勢・二見の旅は三重県伊勢市、山形の家の近くは山形県大石田町（0047）", () => {
    for (const p of SEED_PHOTOS) {
      expect(Math.round(p.latitude * 100) / 100, p.label).toBe(p.latitude);
      expect(Math.round(p.longitude * 100) / 100, p.label).toBe(p.longitude);
      expect(placeName(p.latitude, p.longitude), p.label).toBe(p.label.startsWith("P") ? "三重県伊勢市" : "山形県大石田町");
    }
    const people = new Map(SEED_MEMBERS.map((m, i) => [m.calledAs, { id: `m${i}`, calledAs: m.calledAs, role: m.role } as MemberRow]));
    const rows = buildSeedRows("11111111-0000-4000-8000-000000000001", AS_OF, people);
    expect(rows.photos.map((p) => [p.row.latitude, p.row.longitude])).toEqual(SEED_PHOTOS.map((p) => [p.latitude, p.longitude]));
  });

  it("消す表と残す表で、schema.ts の表をすべて覆う。消す順は外部キーの子が先", () => {
    const kept = ["families", "members", "invite_links"];
    expect([...DEMO_RESET_TABLES, ...kept].sort()).toEqual([...tableNames].sort());
    const order: string[] = [...DEMO_RESET_TABLES];
    for (const t of tables) {
      const c = getTableConfig(t);
      if (!order.includes(c.name)) continue;
      for (const fk of c.foreignKeys) {
        const parent = getTableConfig(fk.reference().foreignTable).name;
        if (parent === c.name || !order.includes(parent)) continue;
        expect(order.indexOf(c.name), `${c.name} → ${parent}`).toBeLessThan(order.indexOf(parent));
      }
    }
  });

  it("呼ばれ方と role がすべて一致したときだけ結びつける", () => {
    const mk = (calledAs: string, role: "elder" | "family", i: number) => ({ id: `m${i}`, calledAs, role }) as MemberRow;
    const ok = SEED_MEMBERS.map((m, i) => mk(m.calledAs, m.role, i));
    expect(matchSeedMembers(ok)?.size).toBe(4);
    expect(matchSeedMembers(ok.slice(1))).toBeNull();
    expect(matchSeedMembers([...ok, mk("いとこ", "family", 9)])).toBeNull();
    expect(matchSeedMembers(ok.map((m, i) => (i === 0 ? { ...m, role: "family" as const } : m)))).toBeNull();
    expect(matchSeedMembers(ok.map((m, i) => (i === 3 ? { ...m, calledAs: "ゆいちゃん" } : m)))).toBeNull();
    expect(matchSeedMembers(ok.map((m, i) => (i === 3 ? { ...m, calledAs: "お母さん" } : m)))).toBeNull();
  });
});

describe("初期化の鍵（0038。0030 と同じ規則）", () => {
  beforeEach(() => putSeedAssets());

  it("鍵なし・違う鍵・家族の合言葉の cookie・ほかの鍵では 401 で、何も変えない", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    const before = await dumpFamily(f.familyId);
    for (const res of [
      await reset(t, f.familyId, null),
      await reset(t, f.familyId, "x".repeat(40)),
      await reset(t, f.familyId, null, { Cookie: f.cookie }),
      await reset(t, f.familyId, OPS_TOKEN),
      await reset(t, f.familyId, CREATE_TOKEN),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(await dumpFamily(f.familyId)).toEqual(before);
  });

  it("鍵の設定がない・32 文字未満・ほかの鍵と同じ値なら、その値を送っても誰も通さない", async () => {
    for (const bad of [null, "short-key-".padEnd(31, "z"), OPS_TOKEN]) {
      const t = appWithR2({ demoResetToken: bad });
      const f = await demoFamily(t);
      const res = await reset(t, f.familyId, bad ?? DEMO_RESET_TOKEN);
      expect(res.status, String(bad)).toBe(401);
    }
    const base = { appEnv: "production", createFamilyToken: CREATE_TOKEN, opsRecordToken: OPS_TOKEN, opsRecordFamilies: [], demoGuideKey: null, demoGuideLinks: null };
    expect(demoResetKeyMisconfig({ ...base, demoResetToken: null })).toBeNull();
    expect(demoResetKeyMisconfig({ ...base, demoResetToken: "a".repeat(31) })).toBe("too_short");
    expect(demoResetKeyMisconfig({ ...base, createFamilyToken: "c".repeat(40), demoResetToken: "c".repeat(40) })).toBe("same_as_create_family_token");
    expect(demoResetKeyMisconfig({ ...base, demoResetToken: OPS_TOKEN })).toBe("same_as_ops_record_token");
    expect(demoResetKeyMisconfig({ ...base, demoResetToken: DEMO_RESET_TOKEN })).toBeNull();
  });

  it("パスの大文字・小文字を変えても鍵の確かめを外れない", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    for (const p of [`/API/demo/families/${f.familyId}/reset`, `/api/DEMO/Families/${f.familyId}/reset`]) {
      const res = await t.app.request(p, { method: "POST", headers: { Cookie: f.cookie } });
      expect(res.status, p).toBe(401);
    }
  });
});

describe("デモの家族の外に触れない", () => {
  beforeEach(() => putSeedAssets());

  it("デモでない家族の ID・ない ID では 404 で、一行も変わらない", async () => {
    const t = appWithR2();
    const real = await createFamily(t, false);
    const m = await addMember(t, real.cookie);
    await addPhoto(t, m.cookie, 1);
    const before = await dumpFamily(real.familyId);
    const keysBefore = await r2Keys(`families/${real.familyId}/`);

    const res = await reset(t, real.familyId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(await dumpFamily(real.familyId)).toEqual(before);
    expect(await r2Keys(`families/${real.familyId}/`)).toEqual(keysBefore);

    expect((await reset(t, "99999999-0000-4000-8000-000000000009")).status).toBe(404);
  });

  it("隣の家族（実際の家族・ほかのデモの家族）の全表と R2 のファイルが、前後で変わらない", async () => {
    const t = appWithR2();
    const neighbor = await createFamily(t, false);
    const nm = await addMember(t, neighbor.cookie);
    await addPhoto(t, nm.cookie, 2);
    await dirty(neighbor.familyId);
    const otherDemo = await demoFamily(t);
    await dirty(otherDemo.familyId);
    const f = await demoFamily(t);
    await dirty(f.familyId);

    const snap = async () => ({
      neighbor: await dumpFamily(neighbor.familyId),
      otherDemo: await dumpFamily(otherDemo.familyId),
      // バケット全体から、戻す家族の接頭だけを除いたもの（ほかの場所への書き込みも拾う）
      keys: (await r2Keys("")).filter((k) => !k.startsWith(`families/${f.familyId}/`)),
    });
    const before = await snap();
    const res = await reset(t, f.familyId);
    expect(res.status).toBe(200);
    expect(await snap()).toEqual(before);
  });

  it("人（members。返事を見た時刻のほか）とリンク（invite_links）と家族の行（時計のほか）は、前後で同じ。返事を見た時刻は null に戻る（0058）", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    await dirty(f.familyId);
    const before = await dumpFamily(f.familyId);
    expect(before.members!.every((m: any) => m.replies_seen_at === 4102444800000)).toBe(true);
    expect((await reset(t, f.familyId)).status).toBe(200);
    const after = await dumpFamily(f.familyId);
    expect(after.members).toEqual(before.members!.map((m: any) => ({ ...m, replies_seen_at: null })));
    expect(after.invite_links).toEqual(before.invite_links);
    const strip = (r: any) => ({ ...r, clock_date: null, clock_slot: null });
    expect(after.families!.map(strip)).toEqual(before.families!.map(strip));
  });
});

describe("戻した後の状態", () => {
  beforeEach(() => putSeedAssets());

  it("古い中身とファイルが消え、種の行が入り、鍵はすべて families/<id>/ の下。時計は今日の朝", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    const oldKeys = await dirty(f.familyId);

    const res = await reset(t, f.familyId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      familyId: f.familyId,
      asOfDate: AS_OF,
      deleted: { files: 3, rows: Object.fromEntries(DEMO_RESET_TABLES.map((n) => [n, 1])) },
      inserted: { photos: 12, narrations: 11, entrances: 4, files: 15 },
    });
    // 返すのは ID と件数だけ（名前・本文・鍵を返さない）
    const text = JSON.stringify(body);
    for (const m of SEED_MEMBERS) expect(text).not.toContain(m.calledAs);
    expect(text).not.toContain("families/");
    expect(text).not.toContain("夫婦岩");

    const d = await dumpFamily(f.familyId);
    expect(d.photos).toHaveLength(12);
    expect(d.narrations).toHaveLength(11);
    // 推測の表は空（photo_guess_requests は最後の毎朝の処理が作業の行を置くので、古い行が残っていないことだけを見る）
    for (const n of ["records", "record_extractions", "musubi", "musubi_photos", "musubi_guess_runs", "photo_guesses"]) expect(d[n], n).toEqual([]);
    const photoIds = new Set((d.photos as any[]).map((r) => r.id));
    for (const r of d.photo_guess_requests as any[]) expect(photoIds.has(r.photo_id)).toBe(true);
    expect(d.families![0]).toMatchObject({ clock_date: AS_OF, clock_slot: "morning", is_demo: 1 });

    const prefix = `families/${f.familyId}/`;
    const keys = [
      ...(d.photos as any[]).map((r) => r.storage_key),
      ...(d.narrations as any[]).filter((r) => r.audio_key).map((r) => r.audio_key),
      ...(d.entrances as any[]).filter((r) => r.question_audio_key).map((r) => r.question_audio_key),
    ];
    for (const k of keys) expect(k.startsWith(prefix)).toBe(true);
    expect(await r2Keys(prefix)).toEqual([...keys].sort());
    for (const k of Object.values(oldKeys)) expect(await bucket.head(k)).toBeNull();

    // 声の語り: 録音は写した種類のまま。整えた文字は種のものを写し、モデルと版が付く。文字の語りに整形はない
    for (const n of d.narrations as any[]) {
      expect(n.transcript_status).toBe("done");
      if (n.kind === "voice") {
        expect(n.audio_content_type).toBe("audio/mp4");
        expect(n.cleaned_model).toMatch(/^claude-haiku-/);
      } else {
        expect(n.cleaned_text).toBeNull();
        expect(n.cleaned_model).toBeNull();
      }
    }
  });

  it("最後に毎朝の処理（Cron・時計のボタンと同じ関数）を、その家族について今日の日付で呼ぶ", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    const logs: Record<string, unknown>[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (typeof line === "string" && line.startsWith("{")) logs.push(JSON.parse(line));
    });
    const res = await reset(t, f.familyId);
    spy.mockRestore();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // runMorning が出す終わりのログ（一家族だけ）と、返した要約の runId が同じ
    const done = logs.filter((l) => l.event === "morning_done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ runId: body.morning.runId, families: 1 });
    // Claude のキーがないので、4 人とも固定の入り口
    expect(body.morning).toMatchObject({ created: 4, existing: 0, failed: [] });
    const today = (await d1.prepare("SELECT member_id FROM entrances WHERE family_id = ? AND for_date = ?").bind(f.familyId, AS_OF).all()).results;
    expect(today).toHaveLength(4);
    // ログに名前・本文・鍵を出さない
    const text = JSON.stringify(logs.filter((l) => l.event === "demo_reset"));
    expect(text).toContain(f.familyId);
    expect(text).not.toContain("families/");
    for (const m of SEED_MEMBERS) expect(text).not.toContain(m.calledAs);
  });

  it("写真の説明は Batch にせず一枚ずつその場で作り、全部そろってから入り口を作る。一枚失敗しても入り口は作る", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    // 写真の説明（photo_guess）と Batch だけを偽の API に通し、ほかの用途はキーなし（固定の入り口になる）。
    // 11 枚分だけ説明を返し、残りの一枚は 500（再試行しても失敗）
    const fake = fakeClaude({
      replies: Array.from({ length: SEED_PHOTOS.length - 1 }, () => ({ kind: "json" as const, value: { description: "屋外。大人が二人並んで立っている。" }, model: "claude-haiku-5-5" })),
    });
    /** 入り口の呼び出しが来た時点での、その家族の説明の数 */
    const guessesAtEntrance: number[] = [];
    const claude: ClaudeClient = {
      call: async (req) => {
        if (req.prompt.purpose === "photo_guess") return fake.claude.call(req);
        if (req.prompt.purpose === "entrance") {
          const n = await d1.prepare("SELECT COUNT(*) AS n FROM photo_guesses WHERE family_id = ?").bind(f.familyId).first<{ n: number }>();
          guessesAtEntrance.push(n!.n);
        }
        return notConfiguredClaude.call(req);
      },
      createBatch: (req) => fake.claude.createBatch(req),
      getBatch: (id, traceId) => fake.claude.getBatch(id, traceId),
      getBatchResults: (req) => fake.claude.getBatchResults(req),
    };
    t.deps.claude = claude;

    const res = await reset(t, f.familyId);
    expect(res.status).toBe(200);
    // 種の写真はしきい値（10 枚）を超えるが、Batch は作らない
    expect(SEED_PHOTOS.length).toBeGreaterThan(10);
    expect(fake.requests.filter((r) => r.path.startsWith("/v1/messages/batches"))).toHaveLength(0);
    const photoIds = new Set((await d1.prepare("SELECT id FROM photos WHERE family_id = ?").bind(f.familyId).all<{ id: string }>()).results.map((r) => r.id));
    const sent = fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/messages");
    // 12 枚 + 失敗した一枚の再試行
    expect(sent).toHaveLength(SEED_PHOTOS.length + 1);
    const guesses = (await d1.prepare("SELECT photo_id FROM photo_guesses WHERE family_id = ?").bind(f.familyId).all<{ photo_id: string }>()).results;
    expect(guesses).toHaveLength(SEED_PHOTOS.length - 1);
    for (const g of guesses) expect(photoIds.has(g.photo_id)).toBe(true);
    // 失敗した一枚は失敗の記録（Batch なし）で、次の回に取り直せる
    const reqs = (await d1.prepare("SELECT state, batch_id FROM photo_guess_requests WHERE family_id = ?").bind(f.familyId).all()).results;
    expect(reqs).toEqual([{ state: "failed", batch_id: null }]);
    // 入り口づくりは、説明がそろった後（4 人とも、呼ばれた時点で 11 件）。入り口は 4 人とも作る
    expect(guessesAtEntrance).toEqual([11, 11, 11, 11]);
    expect(((await res.json()) as any).morning).toMatchObject({ created: 4, failed: [] });
  });

  it("二度呼んでも同じ状態（ID のほか）。古いファイルは残らない", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    expect((await reset(t, f.familyId)).status).toBe(200);
    const first = await normalized(f.familyId);
    const keys1 = await r2Keys(`families/${f.familyId}/`);
    const second = (await (await reset(t, f.familyId)).json()) as any;
    expect(await normalized(f.familyId)).toEqual(first);
    expect(await r2Keys(`families/${f.familyId}/`)).toHaveLength(keys1.length);
    // 二度目は、一度目に入れた行（と今日の入り口）を消す
    expect(second.deleted.rows).toMatchObject({ photos: 12, narrations: 11, entrances: 8 });
    expect(second.deleted.files).toBe(15);
  });

  // 画面の「〜あたり」は test/client/photo-facts.test.ts（入り口）と test/client/photo-viewer.test.ts（拡大の画面。同じ地名で）
  it("戻した写真の場所は「三重県伊勢市」9 枚と「山形県大石田町」3 枚の文字だけ。緯度経度は返さない（0047）", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    expect((await reset(t, f.familyId)).status).toBe(200);
    const body = await (await t.app.request("/api/photos", { headers: { Cookie: f.cookie } })).text();
    expect(body).not.toMatch(/latitude|longitude|34\.49|136\.71|38\.59|140\.37/);
    const places = (JSON.parse(body) as { photos: { place: string | null }[] }).photos.map((p) => p.place);
    expect(places).toHaveLength(12);
    expect(places.filter((s) => s === "三重県伊勢市")).toHaveLength(9);
    expect(places.filter((s) => s === "山形県大石田町")).toHaveLength(3);
  });

  it("（qa）初期化の最後の毎朝の処理で、Claude に渡す入力にも、ログにも、地名と緯度経度が出ない（0047）", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    const fake = fakeClaude({
      replies: Array.from({ length: SEED_PHOTOS.length }, () => ({ kind: "json" as const, value: { description: "屋外。大人が二人並んで立っている。" }, model: "claude-haiku-5-5" })),
    });
    const inputs: string[] = [];
    const purposes = new Set<string>();
    const claude: ClaudeClient = {
      call: async (req) => {
        purposes.add(req.prompt.purpose);
        inputs.push(JSON.stringify(req.prompt));
        if (req.prompt.purpose === "photo_guess") return fake.claude.call(req);
        return notConfiguredClaude.call(req);
      },
      createBatch: (req) => {
        inputs.push(JSON.stringify({ prompt: req.prompt, items: req.items }));
        return fake.claude.createBatch(req);
      },
      getBatch: (id, traceId) => fake.claude.getBatch(id, traceId),
      getBatchResults: (req) => fake.claude.getBatchResults(req),
    };
    t.deps.claude = claude;
    const logs: string[] = [];
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "))),
    );
    let res: Response;
    try {
      res = await reset(t, f.familyId);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(res.status).toBe(200);
    // 写真の説明と入り口づくりの両方が、実際に Claude を呼ぶところまで進んだ
    expect(purposes.has("photo_guess")).toBe(true);
    expect(purposes.has("entrance")).toBe(true);
    const forbidden = /伊勢市|大石田|三重県|山形県大石田|34\.49|136\.71|38\.59|140\.37|latitude|longitude/;
    for (const s of [...inputs, ...fake.requests.map((r) => JSON.stringify(r.body))]) expect(s).not.toMatch(forbidden);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line).not.toMatch(forbidden);
  });

  it("アルバムに語りが並び、入り口への答えに元の言葉（言葉の糸）が付く", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    expect((await reset(t, f.familyId)).status).toBe(200);
    const feed = (await (await t.app.request("/api/feed", { headers: { Cookie: f.cookie } })).json()) as any;
    const all = feed.items.flatMap((i: any) => i.narrations);
    expect(all).toHaveLength(11);
    const threads = all.filter((n: any) => n.quotedFrom).map((n: any) => n.quotedFrom.text);
    // 言葉の糸が付くのは答えのある入り口（E1・E2）だけ。E3・E4 はじいちゃんがまだ答えていない入り口
    const answered = new Set(SEED_NARRATIONS.map((n) => n.entrance).filter(Boolean));
    expect(threads.sort()).toEqual(SEED_ENTRANCES.filter((e) => answered.has(e.label)).map((e) => e.quote.text).sort());
  });
});

describe("止める（何も変えない）", () => {
  beforeEach(() => putSeedAssets());

  it("人の呼ばれ方が種と合わなければ 409 demo_seed_mismatch。名前は返さない", async () => {
    const t = appWithR2();
    const members = SEED_MEMBERS.map((m) => (m.calledAs === "ゆい" ? { ...m, calledAs: "ゆいちゃん" } : m));
    const f = await demoFamily(t, members);
    await dirty(f.familyId);
    const before = await dumpFamily(f.familyId);
    const keys = await r2Keys(`families/${f.familyId}/`);
    const res = await reset(t, f.familyId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "demo_seed_mismatch" });
    expect(await dumpFamily(f.familyId)).toEqual(before);
    expect(await r2Keys(`families/${f.familyId}/`)).toEqual(keys);
  });

  it("role が違っても止める", async () => {
    const t = appWithR2();
    const f = await demoFamily(t, SEED_MEMBERS.map((m) => ({ ...m, role: "family" as const })));
    const before = await dumpFamily(f.familyId);
    expect((await reset(t, f.familyId)).status).toBe(409);
    expect(await dumpFamily(f.familyId)).toEqual(before);
  });

  it("種の録音が一つでも欠けていれば 409 demo_seed_missing。写した分は消え、何も変わらない", async () => {
    await putSeedAssets({ skipVoice: "n8" });
    const t = appWithR2();
    const f = await demoFamily(t);
    await dirty(f.familyId);
    const before = await dumpFamily(f.familyId);
    const keys = await r2Keys(`families/${f.familyId}/`);
    const res = await reset(t, f.familyId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "demo_seed_missing" });
    expect(await dumpFamily(f.familyId)).toEqual(before);
    expect(await r2Keys(`families/${f.familyId}/`)).toEqual(keys);
  });

  it("種の写真の種類が違えば（jpeg でない）止める", async () => {
    const p = SEED_PHOTOS[0]!;
    await bucket.put(seedPhotoKey(p), new Uint8Array([1]), { httpMetadata: { contentType: "application/octet-stream" } });
    const t = appWithR2();
    const f = await demoFamily(t);
    const res = await reset(t, f.familyId);
    expect(res.status).toBe(409);
    expect(await r2Keys(`families/${f.familyId}/`)).toEqual([]);
  });
});

describe("守りと失敗の道", () => {
  beforeEach(() => putSeedAssets());

  it("デモの家族の行が families/<id>/ の外（隣の家族・種）を指していても、そのファイルは消さず、数えない", async () => {
    const t = appWithR2();
    const neighbor = await createFamily(t, false);
    const f = await demoFamily(t);
    const m = (await d1.prepare("SELECT id FROM members WHERE family_id = ? LIMIT 1").bind(f.familyId).first<{ id: string }>())!.id;
    const outside = `families/${neighbor.familyId}/photos/x.jpg`;
    const seedVoice = seedVoiceKey(SEED_NARRATIONS.find((n) => n.kind === "voice")!);
    await bucket.put(outside, new Uint8Array([1]));
    await d1.batch([
      d1
        .prepare("INSERT INTO photos (id, family_id, owner_member_id, storage_key, content_hash, width, height, created_at) VALUES (?, ?, ?, ?, 'h', 1, 1, 1)")
        .bind("bad-ph", f.familyId, m, outside),
      d1
        .prepare("INSERT INTO narrations (id, family_id, speaker_member_id, photo_id, kind, audio_key, transcript_status, for_date, created_at) VALUES ('bad-n', ?, ?, 'bad-ph', 'voice', ?, 'done', '2026-11-01', 1)")
        .bind(f.familyId, m, seedVoice),
    ]);
    const res = await reset(t, f.familyId);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).deleted.files).toBe(0);
    expect(await bucket.head(outside)).not.toBeNull();
    expect(await bucket.head(seedVoice)).not.toBeNull();
  });

  it("D1 の一括の書き込みが失敗したら、写したファイルを消し、表は前のまま", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    await dirty(f.familyId);
    const before = await dumpFamily(f.familyId);
    const keys = await r2Keys(`families/${f.familyId}/`);
    t.deps.repos.demoReset.replaceContent = async () => {
      throw new Error("batch_failed");
    };
    const res = await reset(t, f.familyId);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(await dumpFamily(f.familyId)).toEqual(before);
    expect(await r2Keys(`families/${f.familyId}/`)).toEqual(keys);
  });

  it("毎朝の処理が全員失敗しても、戻した中身はそのままで 200、morning は null。ログは種類だけ", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    // 入り口の読み書きを落として、全員を失敗させる
    const entrances = t.deps.repos.entrances;
    t.deps.repos.entrances = { ...entrances, get: async () => { throw new Error("db down"); } };
    const logs: Record<string, unknown>[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (typeof line === "string" && line.startsWith("{")) logs.push(JSON.parse(line));
    });
    const res = await reset(t, f.familyId);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).morning).toBeNull();
    const d = await dumpFamily(f.familyId);
    expect(d.photos).toHaveLength(12);
    expect(d.narrations).toHaveLength(11);
    const failed = logs.find((l) => l.event === "demo_reset" && l.status === "morning_failed");
    expect(failed).toMatchObject({ kind: "morning_all_failed" });
    expect(JSON.stringify(failed)).not.toContain("db down");
  });
});
