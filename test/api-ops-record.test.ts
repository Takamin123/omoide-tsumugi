// 運営の記録の画面の入り口（GET /api/ops/families/:familyId/record と写真）。0017、0025、0030。
// - 運営の鍵（OPS_RECORD_TOKEN の Bearer）がなければ 401。家族の合言葉の cookie でも、家族を作る鍵でも開かない
// - 見つからない家族、ほかの家族の写真は 404
// - 全環境で同じ規則: デモの家族は鍵で開く。デモでない家族は、許可の一覧（OPS_RECORD_FAMILIES）に載っていなければ 404
// - 理由（reason）と写真の説明は、運営の入り口にだけ出る（家族向けの入り口には出ない）
// 架空の家族と架空の文だけを使う。
import { drizzle } from "drizzle-orm/d1";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../src/server/db/schema";
import type { OpsFamilyRecord } from "../src/shared/ops";
import { addMember, addPhoto, CREATE_TOKEN, createFamily, makeTestApp, OPS_TOKEN, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const SECRET_REASON = "架空の理由_REASON_7f3";
const SECRET_GUESS = "架空の説明_GUESS_9c1";
const bearer = (key = OPS_TOKEN) => ({ Authorization: `Bearer ${key}` });
const recordUrl = (familyId: string) => `/api/ops/families/${familyId}/record`;

/** 入り口（Claude、理由つき）・整形済みの声の語り・写真の説明を一つずつ持つ家族 */
async function seed(t: TestApp, isDemo = true) {
  const f = await createFamily(t, isDemo);
  const child = await addMember(t, f.cookie);
  const elder = await addMember(t, child.cookie, { role: "elder", relation: "祖母", calledAs: "おばあちゃん" });
  const photo = await addPhoto(t, child.cookie, 1);
  const db = drizzle(d1, { schema });
  const narrationId = crypto.randomUUID();
  const cleaned = "あの日は海へ行きました。浜で貝を拾いました。";
  await db.insert(schema.narrations).values({
    id: narrationId,
    familyId: f.familyId,
    speakerMemberId: child.id,
    photoId: photo.id,
    kind: "voice",
    audioKey: `families/${f.familyId}/audio/${narrationId}`,
    audioContentType: "audio/mp4",
    durationMs: 12800,
    transcript: "えー あの日は 海へ 行きました 浜で 貝を 拾いました",
    transcriptStatus: "done",
    cleanedText: cleaned,
    cleanedModel: "claude-haiku-fake",
    cleanedPromptVersion: "clean_transcript/v2",
    uncertainSpans: JSON.stringify([{ start: 14, end: 15 }]),
    forDate: "2026-11-02",
    createdAt: 1,
  });
  const entranceId = crypto.randomUUID();
  await db.insert(schema.entrances).values({
    id: entranceId,
    familyId: f.familyId,
    memberId: elder.id,
    forDate: "2026-11-03",
    photoId: photo.id,
    focus: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
    quoteNarrationId: narrationId,
    quoteStart: 0,
    quoteEnd: 16,
    question: "この日のことを聞かせてください",
    reason: SECRET_REASON,
    kind: "claude",
    model: "claude-sonnet-fake",
    promptVersion: "entrance/v0",
    inputNarrationIds: [narrationId],
    inputTokens: 1234,
    outputTokens: 56,
    createdAt: 2,
  });
  await t.deps.repos.photoGuesses.saveGuess({
    id: crypto.randomUUID(),
    photoId: photo.id,
    familyId: f.familyId,
    description: SECRET_GUESS,
    model: "claude-haiku-fake",
    promptVersion: "photo_guess/v1",
    createdAt: 3,
  });
  return { f, elder, child, photo, narrationId, entranceId, cleaned };
}

describe("運営の記録: 鍵", () => {
  it("鍵がないと 401、違う鍵も 401、鍵の設定がなければ誰も開けない", async () => {
    const t = makeTestApp(d1);
    const { f, photo } = await seed(t);
    for (const url of [recordUrl(f.familyId), `/api/ops/families/${f.familyId}/photos/${photo.id}/image`]) {
      expect((await t.app.request(url)).status, url).toBe(401);
      expect((await t.app.request(url, { headers: bearer("wrong") })).status, url).toBe(401);
      expect((await t.app.request(url, { headers: { Authorization: CREATE_TOKEN } })).status, url).toBe(401);
    }
    t.deps.config.opsRecordToken = null;
    expect((await t.app.request(recordUrl(f.familyId), { headers: bearer() })).status).toBe(401);
  });

  it("家族の合言葉の cookie では、自分の家族の記録も開けない", async () => {
    const t = makeTestApp(d1);
    const { f, child, photo } = await seed(t);
    const res = await t.app.request(recordUrl(f.familyId), { headers: { Cookie: child.cookie } });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(SECRET_REASON);
    const img = await t.app.request(`/api/ops/families/${f.familyId}/photos/${photo.id}/image`, { headers: { Cookie: child.cookie } });
    expect(img.status).toBe(401);
  });

  it("大文字・小文字を変えても、合言葉の cookie では開かない", async () => {
    const t = makeTestApp(d1);
    const { f, child } = await seed(t);
    for (const p of [`/API/ops/families/${f.familyId}/record`, `/api/OPS/families/${f.familyId}/record`]) {
      const res = await t.app.request(p, { headers: { Cookie: child.cookie } });
      expect([401, 404], p).toContain(res.status);
      expect(await res.text()).not.toContain(SECRET_REASON);
    }
  });

  it("運営の鍵では、家族向けの入り口は開かない（合言葉の代わりにならない）", async () => {
    const t = makeTestApp(d1);
    expect((await t.app.request("/api/family", { headers: bearer() })).status).toBe(401);
    expect((await t.app.request("/api/feed", { headers: bearer() })).status).toBe(401);
  });

  it("家族を作る鍵（CREATE_FAMILY_TOKEN）では、どの環境でも開かない（0027、0030）", async () => {
    for (const appEnv of ["development", "preview", "production"]) {
      const t = makeTestApp(d1, { appEnv });
      const { f, photo } = await seed(t);
      const res = await t.app.request(recordUrl(f.familyId), { headers: bearer(CREATE_TOKEN) });
      expect(res.status, appEnv).toBe(401);
      expect(await res.text()).not.toContain(SECRET_REASON);
      const img = await t.app.request(`/api/ops/families/${f.familyId}/photos/${photo.id}/image`, { headers: bearer(CREATE_TOKEN) });
      expect(img.status, appEnv).toBe(401);
    }
  });

  it("鍵の設定が短すぎるとき、家族を作る鍵と同じ値のときは、その鍵でも開かない。ログには種類だけ出す", async () => {
    const t = makeTestApp(d1);
    const { f } = await seed(t);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((m: unknown) => void logs.push(String(m)));
    try {
      t.deps.config.opsRecordToken = "short-ops-key";
      expect((await t.app.request(recordUrl(f.familyId), { headers: bearer("short-ops-key") })).status).toBe(401);
      const same = "same-as-create-family-".padEnd(40, "x");
      t.deps.config.opsRecordToken = same;
      t.deps.config.createFamilyToken = same;
      expect((await t.app.request(recordUrl(f.familyId), { headers: bearer(same) })).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
    expect(logs.map((l) => JSON.parse(l))).toEqual([
      { event: "ops_key_misconfigured", reason: "too_short" },
      { event: "ops_key_misconfigured", reason: "same_as_create_family_token" },
    ]);
    expect(logs.join("")).not.toContain("short-ops-key");
    expect(logs.join("")).not.toContain("same-as-create-family-");
  });

  it("本番（APP_ENV=production）でも、運営の鍵ならデモの家族は開く", async () => {
    const t = makeTestApp(d1, { appEnv: "production" });
    const { f, photo } = await seed(t);
    const res = await t.app.request(recordUrl(f.familyId), { headers: bearer() });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SECRET_REASON);
    expect((await t.app.request(`/api/ops/families/${f.familyId}/photos/${photo.id}/image`, { headers: bearer() })).status).toBe(200);
  });
});

describe("運営の記録: 見てよい家族（0030）", () => {
  for (const appEnv of ["development", "preview", "production"]) {
    it(`${appEnv}: デモでない家族は、許可の一覧になければ鍵が合っていても 404。載せれば開く`, async () => {
      const t = makeTestApp(d1, { appEnv });
      const { f, photo } = await seed(t, false);
      const other = await seed(t, false);
      const img = `/api/ops/families/${f.familyId}/photos/${photo.id}/image`;
      const res = await t.app.request(recordUrl(f.familyId), { headers: bearer() });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain(SECRET_REASON);
      expect((await t.app.request(img, { headers: bearer() })).status).toBe(404);

      t.deps.config.opsRecordFamilies = [f.familyId];
      const ok = await t.app.request(recordUrl(f.familyId), { headers: bearer() });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as OpsFamilyRecord).family).toMatchObject({ id: f.familyId, isDemo: false });
      expect((await t.app.request(img, { headers: bearer() })).status).toBe(200);
      // 一覧に載せた家族の道で、載っていない家族の写真は引けない。載っていない家族は 404 のまま
      expect((await t.app.request(`/api/ops/families/${f.familyId}/photos/${other.photo.id}/image`, { headers: bearer() })).status).toBe(404);
      expect((await t.app.request(recordUrl(other.f.familyId), { headers: bearer() })).status).toBe(404);
      expect((await t.app.request(`/api/ops/families/${other.f.familyId}/photos/${other.photo.id}/image`, { headers: bearer() })).status).toBe(404);
    });
  }

  it("許可の一覧にない家族と、存在しない家族は、同じ 404 の本文", async () => {
    const t = makeTestApp(d1, { appEnv: "production" });
    const { f } = await seed(t, false);
    const a = await t.app.request(recordUrl(f.familyId), { headers: bearer() });
    const b = await t.app.request(recordUrl("no-such-family"), { headers: bearer() });
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
  });

  it("許可の一覧に載せても、家族の合言葉の cookie と家族を作る鍵では開かない", async () => {
    const t = makeTestApp(d1, { appEnv: "production" });
    const { f, child } = await seed(t, false);
    t.deps.config.opsRecordFamilies = [f.familyId];
    expect((await t.app.request(recordUrl(f.familyId), { headers: { Cookie: child.cookie } })).status).toBe(401);
    expect((await t.app.request(recordUrl(f.familyId), { headers: bearer(CREATE_TOKEN) })).status).toBe(401);
  });
});

describe("運営の記録: 中身", () => {
  it("入り口・語り・写真の説明を、出所と推測に分けて返す", async () => {
    const t = makeTestApp(d1);
    const { f, elder, child, photo, narrationId, entranceId, cleaned } = await seed(t);
    const res = await t.app.request(recordUrl(f.familyId), { headers: bearer() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const r = (await res.json()) as OpsFamilyRecord;

    expect(r.family).toMatchObject({ id: f.familyId, isDemo: true });
    expect(r.entrances).toHaveLength(1);
    const e = r.entrances[0]!;
    expect(e).toMatchObject({ id: entranceId, memberId: elder.id, kind: "claude", photoId: photo.id, forDate: "2026-11-03" });
    expect(e.told.quote).toEqual({
      narrationId,
      speakerMemberId: child.id,
      start: 0,
      end: 16,
      rawText: cleaned.slice(0, 16),
      // 家族の画面に出た形（印は「……」）
      shownText: cleaned.slice(0, 14) + "……" + cleaned.slice(15, 16),
    });
    expect(e.guessed).toEqual({
      focus: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
      question: "この日のことを聞かせてください",
      reason: SECRET_REASON,
      model: "claude-sonnet-fake",
      promptVersion: "entrance/v0",
      inputNarrationIds: [narrationId],
      inputTokens: 1234,
      outputTokens: 56,
      inputMusubiIds: null,
      receiverPresent: null,
    });

    const n = r.narrations.find((x) => x.id === narrationId)!;
    expect(n).toMatchObject({ speakerMemberId: child.id, kind: "voice", hasAudio: true, durationMs: 12800, transcriptStatus: "done" });
    expect(n.transcript).toContain("えー");
    expect(n.cleaned).toEqual({
      text: cleaned,
      uncertainSpans: [{ start: 14, end: 15 }],
      model: "claude-haiku-fake",
      promptVersion: "clean_transcript/v2",
    });
    expect(n).not.toHaveProperty("audioUrl");

    expect(r.photoGuesses).toEqual([
      expect.objectContaining({ photoId: photo.id, description: SECRET_GUESS, model: "claude-haiku-fake", promptVersion: "photo_guess/v1" }),
    ]);
    // 写真は運営の鍵で開く URL。緯度経度と保存先のキーは返さない
    expect(r.photos[0]).toEqual({
      id: photo.id,
      ownerMemberId: child.id,
      width: 10,
      height: 10,
      takenAt: null,
      createdAt: expect.any(Number),
      imageUrl: `/api/ops/families/${f.familyId}/photos/${photo.id}/image`,
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain("latitude");
    expect(text).not.toContain("storageKey");
    expect(text).not.toContain("audioKey");
  });

  it("引用の原文は、文字の語りなら transcript の位置、声で整形がなければ範囲つきでは取り出さない（quoteSource と同じ規則）", async () => {
    const t = makeTestApp(d1);
    const { f, elder, child, photo } = await seed(t);
    const db = drizzle(d1, { schema });
    const typed = "庭の柿がよく実った年でした。";
    const textId = crypto.randomUUID();
    const voiceId = crypto.randomUUID();
    await db.insert(schema.narrations).values([
      {
        id: textId,
        familyId: f.familyId,
        speakerMemberId: child.id,
        photoId: photo.id,
        kind: "text",
        transcript: typed,
        transcriptStatus: "done",
        forDate: "2026-11-02",
        createdAt: 10,
      },
      {
        id: voiceId,
        familyId: f.familyId,
        speakerMemberId: child.id,
        photoId: photo.id,
        kind: "voice",
        audioKey: `families/${f.familyId}/audio/${voiceId}`,
        audioContentType: "audio/mp4",
        transcript: "えー 縁側で お茶を 飲みました",
        transcriptStatus: "done",
        forDate: "2026-11-02",
        createdAt: 11,
      },
    ]);
    const entrance = (id: string, narrationId: string, start: number | null, end: number | null, forDate: string) => ({
      id,
      familyId: f.familyId,
      memberId: elder.id,
      forDate,
      photoId: photo.id,
      quoteNarrationId: narrationId,
      quoteStart: start,
      quoteEnd: end,
      question: "この日のことを聞かせてください",
      kind: "claude" as const,
      model: "claude-sonnet-fake",
      promptVersion: "entrance/v0",
      createdAt: 20,
    });
    const textEntrance = crypto.randomUUID();
    const voiceEntrance = crypto.randomUUID();
    const textWhole = crypto.randomUUID();
    await db.insert(schema.entrances).values([
      entrance(textEntrance, textId, 0, 6, "2026-11-04"),
      entrance(voiceEntrance, voiceId, 0, 4, "2026-11-05"),
      entrance(textWhole, textId, null, null, "2026-11-06"),
    ]);
    const r = (await (await t.app.request(recordUrl(f.familyId), { headers: bearer() })).json()) as OpsFamilyRecord;
    const quoteOf = (id: string) => r.entrances.find((e) => e.id === id)!.told.quote!;
    expect(quoteOf(textEntrance)).toMatchObject({ rawText: typed.slice(0, 6), shownText: typed.slice(0, 6) });
    expect(quoteOf(voiceEntrance)).toMatchObject({ rawText: null, shownText: null });
    expect(quoteOf(textWhole)).toMatchObject({ rawText: typed, shownText: typed });
    // 声の長さは、文字の語りと、長さの分からない声では null（0 や undefined にしない）
    const narrationOf = (id: string) => r.narrations.find((n) => n.id === id)!;
    expect(narrationOf(textId).durationMs).toBeNull();
    expect(narrationOf(voiceId).durationMs).toBeNull();
  });

  it("声の語りで整えた文字があっても、印が読めなければ範囲つきの原文は取り出さない（家族の画面に出た文字と同じく null）", async () => {
    const t = makeTestApp(d1);
    const { f, elder, child, photo } = await seed(t);
    const db = drizzle(d1, { schema });
    const voiceId = crypto.randomUUID();
    const cleaned = "縁側でお茶を飲みました。";
    await db.insert(schema.narrations).values({
      id: voiceId,
      familyId: f.familyId,
      speakerMemberId: child.id,
      photoId: photo.id,
      kind: "voice",
      audioKey: `families/${f.familyId}/audio/${voiceId}`,
      audioContentType: "audio/mp4",
      transcript: "えー 縁側で お茶を 飲みました",
      transcriptStatus: "done",
      cleanedText: cleaned,
      cleanedModel: "claude-haiku-fake",
      cleanedPromptVersion: "clean_transcript/v2",
      // 印が読めない（壊れている）整形。quoteSource は使わない
      uncertainSpans: null,
      forDate: "2026-11-02",
      createdAt: 12,
    });
    const entranceId = crypto.randomUUID();
    await db.insert(schema.entrances).values({
      id: entranceId,
      familyId: f.familyId,
      memberId: elder.id,
      forDate: "2026-11-07",
      photoId: photo.id,
      quoteNarrationId: voiceId,
      quoteStart: 0,
      quoteEnd: 3,
      question: "この日のことを聞かせてください",
      kind: "claude",
      model: "claude-sonnet-fake",
      promptVersion: "entrance/v0",
      createdAt: 21,
    });
    const r = (await (await t.app.request(recordUrl(f.familyId), { headers: bearer() })).json()) as OpsFamilyRecord;
    const q = r.entrances.find((e) => e.id === entranceId)!.told.quote!;
    expect(q).toMatchObject({ narrationId: voiceId, rawText: null, shownText: null });
  });

  it("写真は鍵で返す（private, no-store）。録音を返す入り口はない", async () => {
    const t = makeTestApp(d1);
    const { f, photo, narrationId } = await seed(t);
    const img = await t.app.request(`/api/ops/families/${f.familyId}/photos/${photo.id}/image`, { headers: bearer() });
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toBe("private, no-store");
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    const audio = await t.app.request(`/api/ops/families/${f.familyId}/narrations/${narrationId}/audio`, { headers: bearer() });
    expect(audio.status).toBe(404);
  });

  it("見つからない家族は 404。ほかの家族の写真を、この家族の道で引いても 404", async () => {
    const t = makeTestApp(d1);
    const a = await seed(t);
    const b = await seed(t);
    expect((await t.app.request(recordUrl("no-such-family"), { headers: bearer() })).status).toBe(404);
    const cross = await t.app.request(`/api/ops/families/${a.f.familyId}/photos/${b.photo.id}/image`, { headers: bearer() });
    expect(cross.status).toBe(404);
    // 一つの家族の記録に、ほかの家族のものは混ざらない
    const r = (await (await t.app.request(recordUrl(a.f.familyId), { headers: bearer() })).json()) as OpsFamilyRecord;
    expect(r.entrances.map((e) => e.id)).toEqual([a.entranceId]);
    expect(r.narrations.map((n) => n.id)).toEqual([a.narrationId]);
    expect(r.photos.map((p) => p.id)).toEqual([a.photo.id]);
  });

  it("入り口 v3 の推測: receiverPresent と渡したむすびの ID を返し、むすびは渡したものだけを写真と状態つきで返す（推測の理由は返さない）", async () => {
    const t = makeTestApp(d1);
    const { f, elder, child, photo, entranceId } = await seed(t);
    const other = await addPhoto(t, child.cookie, 2);
    const third = await addPhoto(t, child.cookie, 3);
    const MUSUBI_REASON = "架空のむすびの理由_MU_5d0";
    const passedId = `mu-pass-${f.familyId}`;
    const unusedId = `mu-unused-${f.familyId}`;
    for (const id of [passedId, unusedId]) {
      await d1
        .prepare("INSERT INTO musubi (id, family_id, created_by, guessed_reason, guessed_evidence_record_ids, model, prompt_version, created_at) VALUES (?, ?, 'guessed', ?, '[]', 'm', 'musubi_guess/v1', 1)")
        .bind(id, f.familyId, MUSUBI_REASON)
        .run();
    }
    for (const [mid, pid] of [[passedId, photo.id], [passedId, other.id], [unusedId, other.id], [unusedId, third.id]] as const) {
      await d1.prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES (?, ?, ?, 'guessed', 1)").bind(mid, pid, f.familyId).run();
    }
    await d1
      .prepare("UPDATE entrances SET input_musubi_ids = ?, receiver_present = 'no', prompt_version = 'entrance/v3' WHERE id = ?")
      .bind(JSON.stringify([passedId]), entranceId)
      .run();

    const r = (await (await t.app.request(recordUrl(f.familyId), { headers: bearer() })).json()) as OpsFamilyRecord;
    const e = r.entrances.find((x) => x.id === entranceId)!;
    expect(e.memberId).toBe(elder.id);
    expect(e.guessed).toMatchObject({ inputMusubiIds: [passedId], receiverPresent: "no", promptVersion: "entrance/v3" });
    expect(r.musubi).toEqual([
      {
        id: passedId,
        photos: expect.arrayContaining([
          { photoId: photo.id, status: "guessed" },
          { photoId: other.id, status: "guessed" },
        ]),
      },
    ]);
    expect(r.musubi[0]!.photos).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain(MUSUBI_REASON);
  });

  it("ほかの家族のむすびの ID が入り口に入っていても、その家族のむすびは返さない。家族が決めた状態（確かめた・外した）はそのまま返す", async () => {
    const t = makeTestApp(d1);
    const a = await seed(t);
    const b = await seed(t);
    const OTHER_REASON = "架空のほかの家族の理由_MU_c71";
    const ownId = `mu-own-${a.f.familyId}`;
    const otherId = `mu-other-${b.f.familyId}`;
    const insertMusubi = (id: string, familyId: string, reason: string) =>
      d1
        .prepare("INSERT INTO musubi (id, family_id, created_by, guessed_reason, guessed_evidence_record_ids, model, prompt_version, created_at) VALUES (?, ?, 'guessed', ?, '[]', 'm', 'musubi_guess/v1', 1)")
        .bind(id, familyId, reason)
        .run();
    await insertMusubi(ownId, a.f.familyId, "架空");
    await insertMusubi(otherId, b.f.familyId, OTHER_REASON);
    const aOther = await addPhoto(t, a.child.cookie, 7);
    await d1
      .prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, decided_by_member_id, decided_at, created_at) VALUES (?, ?, ?, 'confirmed', ?, 5, 1)")
      .bind(ownId, a.photo.id, a.f.familyId, a.child.id)
      .run();
    await d1
      .prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, decided_by_member_id, decided_at, created_at) VALUES (?, ?, ?, 'rejected', ?, 5, 1)")
      .bind(ownId, aOther.id, a.f.familyId, a.child.id)
      .run();
    await d1
      .prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES (?, ?, ?, 'guessed', 1)")
      .bind(otherId, b.photo.id, b.f.familyId)
      .run();
    // a の入り口に、a のむすびと b のむすびの ID の両方が入っている（ありえないはずの形でも漏らさない）
    await d1
      .prepare("UPDATE entrances SET input_musubi_ids = ?, receiver_present = 'unknown' WHERE id = ?")
      .bind(JSON.stringify([ownId, otherId]), a.entranceId)
      .run();

    const ra = (await (await t.app.request(recordUrl(a.f.familyId), { headers: bearer() })).json()) as OpsFamilyRecord;
    expect(ra.musubi.map((m) => m.id)).toEqual([ownId]);
    expect(ra.musubi[0]!.photos).toEqual(
      expect.arrayContaining([
        { photoId: a.photo.id, status: "confirmed" },
        { photoId: aOther.id, status: "rejected" },
      ]),
    );
    expect(ra.musubi[0]!.photos).toHaveLength(2);
    // 決めた人と時刻は返さない（画面で使わない）
    expect(JSON.stringify(ra.musubi)).not.toContain(a.child.id);
    expect(JSON.stringify(ra)).not.toContain(OTHER_REASON);
    expect(JSON.stringify(ra)).not.toContain(b.photo.id);
    // b の家族は、どの入り口にも渡していないので空
    const rb = (await (await t.app.request(recordUrl(b.f.familyId), { headers: bearer() })).json()) as OpsFamilyRecord;
    expect(rb.musubi).toEqual([]);
  });

  it("むすびは、家族の合言葉の入り口には出ない（運営の鍵なしの記録は 401）", async () => {
    const t = makeTestApp(d1);
    const { f, child } = await seed(t);
    const res = await t.app.request(recordUrl(f.familyId), { headers: { Cookie: child.cookie } });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("musubi");
  });

  it("v2 の入り口しかない家族では、むすびは空", async () => {
    const t = makeTestApp(d1);
    const { f } = await seed(t);
    const r = (await (await t.app.request(recordUrl(f.familyId), { headers: bearer() })).json()) as OpsFamilyRecord;
    expect(r.musubi).toEqual([]);
  });

  it("理由と写真の説明は、家族向けの入り口（合言葉）には出ない", async () => {
    const t = makeTestApp(d1);
    const { elder, child, photo } = await seed(t);
    // 入り口の日付に合わせて、今日を 2026-11-03（日本時間）にする
    t.setNow(new Date("2026-11-03T00:00:00Z"));
    const urls = [
      "/api/family",
      "/api/photos",
      "/api/feed",
      "/api/narrations",
      `/api/narrations?photoId=${photo.id}`,
    ];
    // 家族の画面の人の端末と、祖母の端末（今日の入り口は cookie の人の入り口）
    const requests = [
      ...urls.map((url) => [url, child.cookie] as const),
      ...[...urls, "/api/entrances/today"].map((url) => [url, elder.cookie] as const),
    ];
    for (const [url, cookie] of requests) {
      const res = await t.app.request(url, { headers: { Cookie: cookie } });
      expect(res.status, url).not.toBe(401);
      const text = await res.text();
      expect(text, url).not.toContain(SECRET_REASON);
      expect(text, url).not.toContain(SECRET_GUESS);
      expect(text, url).not.toContain("reason");
      expect(text, url).not.toContain("inputNarrationIds");
      expect(text, url).not.toContain("uncertainSpans");
    }
  });
});
