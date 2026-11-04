// 「とりなおす」（0050）の境界（qa）。入り口の入力の JSON が壊れている・null・ほかの家族の行が同じ ID を指している、など。
// 家族・写真・声はすべて架空
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RETAKE_WINDOW_MS } from "../src/shared/api";
import { addMember, addPhoto, createFamily, makeTestApp, memberLinkCookie, postForm, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const NOW = new Date("2026-11-02T00:00:00Z");
const fakeAudio = { bytes: new Uint8Array([9, 8, 7, 6]), type: "audio/webm;codecs=opus" };

function form(meta: Record<string, unknown>, withAudio: boolean): FormData {
  const f = new FormData();
  f.append("meta", JSON.stringify(meta));
  if (withAudio) f.append("audio", new File([fakeAudio.bytes], "a", { type: fakeAudio.type }));
  return f;
}
async function postVoice(t: TestApp, cookie: string, photoId: string, extra: Record<string, unknown> = {}) {
  const res = await postForm(t, "/api/narrations", form({ kind: "voice", photoId, entranceId: null, replyToId: null, text: null, ...extra }, true), cookie);
  if (res.status !== 202) throw new Error(`postVoice ${res.status}`);
  return ((await res.json()) as { narration: { id: string } }).narration;
}
async function postText(t: TestApp, cookie: string, photoId: string, extra: Record<string, unknown> = {}) {
  const res = await postForm(t, "/api/narrations", form({ kind: "text", photoId, entranceId: null, replyToId: null, text: "架空の文", ...extra }, false), cookie);
  if (res.status !== 202) throw new Error(`postText ${res.status}`);
  return ((await res.json()) as { narration: { id: string } }).narration;
}
const retake = (t: TestApp, cookie: string, id: string) => t.app.request(`/api/narrations/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Cookie: cookie } });
const row = (id: string) => d1.prepare("SELECT id FROM narrations WHERE id = ?").bind(id).first();
const audioKeys = (t: TestApp, familyId: string) => t.store.keys().filter((k) => k.startsWith(`families/${familyId}/audio/`));

async function setup(n: number) {
  const t = makeTestApp(d1, { now: NOW });
  const f = await createFamily(t);
  const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
  const elder = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
  const photo = await addPhoto(t, gc.cookie, n);
  return { t, familyId: f.familyId, gc, elder, photoId: photo.id };
}
type S = Awaited<ReturnType<typeof setup>>;

/** 入り口の行を直接入れる（input_narration_ids は生の文字列のまま） */
let entranceDay = 0;
async function insertEntrance(familyId: string, memberId: string, photoId: string, opts: { quote?: string | null; inputsRaw?: string | null }) {
  // (member_id, for_date) は一意なので、入れるたびに日をずらす
  const forDate = new Date(Date.UTC(2026, 10, 3) + 86_400_000 * entranceDay++).toISOString().slice(0, 10);
  await d1
    .prepare(
      "INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, quote_narration_id, question, kind, model, prompt_version, input_narration_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, '架空の問い', 'claude', 'm', 'v', ?, 1)",
    )
    .bind(crypto.randomUUID(), familyId, memberId, forDate, photoId, opts.quote ?? null, opts.inputsRaw ?? null)
    .run();
}

/** もう一つの家族（よその家族）。写真とメンバーを持つ */
async function otherFamily(s: S, n: number) {
  const o = await createFamily(s.t);
  const m = await addMember(s.t, o.cookie, { calledAs: "架空のよその人" });
  const p = await addPhoto(s.t, m.cookie, n);
  return { familyId: o.familyId, member: m, photoId: p.id };
}

async function expectRetaken(s: S, cookie: string, id: string) {
  const res = await retake(s.t, cookie, id);
  expect(res.status).toBe(204);
  expect(await row(id)).toBeNull();
  expect(audioKeys(s.t, s.familyId).filter((k) => k.endsWith(id))).toEqual([]);
}
async function expectKept(s: S, cookie: string, id: string) {
  const before = audioKeys(s.t, s.familyId);
  const res = await retake(s.t, cookie, id);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(await row(id)).not.toBeNull();
  expect(audioKeys(s.t, s.familyId)).toEqual(before);
}

describe("とりなおす（0050）の境界（qa）", () => {
  describe("入り口の入力（input_narration_ids）の値がふつうでない", () => {
    it.each([
      ["壊れた JSON", "not json ["],
      ["空の文字列", ""],
      ["null（SQL の NULL）", null],
      ["JSON の null", "null"],
      ["空の配列", "[]"],
      ["数の配列", "[1, 2, 3]"],
    ])("%s の入り口が同じ家族にあっても、json_each が失敗せず 204", async (_label, raw) => {
      const s = await setup(5001);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await insertEntrance(s.familyId, s.gc.id, s.photoId, { inputsRaw: raw });
      await expectRetaken(s, s.elder.cookie, n.id);
    });

    it("壊れた JSON の入り口と、正しく指している入り口が並んでいれば 404（壊れた行で判定が抜けない）", async () => {
      const s = await setup(5002);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await insertEntrance(s.familyId, s.gc.id, s.photoId, { inputsRaw: "{broken" });
      await insertEntrance(s.familyId, s.gc.id, s.photoId, { inputsRaw: JSON.stringify([n.id]) });
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("ID の前方一致・部分一致では止まらない（完全一致だけ）", async () => {
      const s = await setup(5003);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await insertEntrance(s.familyId, s.gc.id, s.photoId, { inputsRaw: JSON.stringify([`${n.id}x`, n.id.slice(0, 8), `"${n.id}"`]) });
      await expectRetaken(s, s.elder.cookie, n.id);
    });

    it("JSON の配列の文字列がそのまま入っている（二重に文字列化）なら止まらない", async () => {
      const s = await setup(5004);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await insertEntrance(s.familyId, s.gc.id, s.photoId, { inputsRaw: JSON.stringify(JSON.stringify([n.id])) });
      // 文字列 "[\"id\"]" の json_each は一つの値（文字列全体）で、ID と一致しない
      await expectRetaken(s, s.elder.cookie, n.id);
    });
  });

  describe("ほかの家族の行が同じ ID を指していても、この家族の判定には入らない（500 にもならない）", () => {
    it("よその家族の入り口の input_narration_ids", async () => {
      const s = await setup(5101);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const o = await otherFamily(s, 5102);
      await insertEntrance(o.familyId, o.member.id, o.photoId, { inputsRaw: JSON.stringify([n.id]) });
      await expectRetaken(s, s.elder.cookie, n.id);
    });

    it("よその家族の入り口の quote_narration_id", async () => {
      const s = await setup(5103);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const o = await otherFamily(s, 5104);
      await insertEntrance(o.familyId, o.member.id, o.photoId, { quote: n.id });
      await expectRetaken(s, s.elder.cookie, n.id);
    });

    it("よその家族の語りの reply_to_id（API では作れないので直接入れる）", async () => {
      const s = await setup(5105);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const o = await otherFamily(s, 5106);
      await d1
        .prepare("INSERT INTO narrations (id, family_id, photo_id, speaker_member_id, kind, transcript, transcript_status, reply_to_id, for_date, created_at) VALUES (?, ?, ?, ?, 'text', '架空', 'done', ?, '2026-11-02', 1)")
        .bind(crypto.randomUUID(), o.familyId, o.photoId, o.member.id, n.id)
        .run();
      await expectRetaken(s, s.elder.cookie, n.id);
    });

    it("よその家族の人が同じ ID で DELETE しても 404 で、録音も残る", async () => {
      const s = await setup(5107);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const o = await otherFamily(s, 5108);
      await expectKept(s, o.member.cookie, n.id);
    });
  });

  describe("そのほか", () => {
    it("同じ人のもう一台の端末（人のリンク）からでも消せる", async () => {
      const s = await setup(5201);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const second = await memberLinkCookie(s.t, s.gc.cookie, s.elder.id);
      await expectRetaken(s, second, n.id);
    });

    it("声の返事（自分の声で返したもの）は消せて、返した先の語りは残る", async () => {
      const s = await setup(5202);
      const parent = await postText(s.t, s.gc.cookie, s.photoId);
      const reply = await postVoice(s.t, s.elder.cookie, s.photoId, { replyToId: parent.id });
      await s.t.flush();
      await expectRetaken(s, s.elder.cookie, reply.id);
      expect(await row(parent.id)).not.toBeNull();
    });

    it("同じ人のほかの声の語りは消えない（ID で一つだけ）", async () => {
      const s = await setup(5203);
      const a = await postVoice(s.t, s.elder.cookie, s.photoId);
      const b = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await expectRetaken(s, s.elder.cookie, a.id);
      expect(await row(b.id)).not.toBeNull();
      expect(audioKeys(s.t, s.familyId)).toEqual([`families/${s.familyId}/audio/${b.id}`]);
    });

    it("10 分のうち一つの語りが使われていても、使われていない別の語りは消せる", async () => {
      const s = await setup(5204);
      const used = await postVoice(s.t, s.elder.cookie, s.photoId);
      const free = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await insertEntrance(s.familyId, s.gc.id, s.photoId, { quote: used.id, inputsRaw: JSON.stringify([used.id]) });
      await expectKept(s, s.elder.cookie, used.id);
      await expectRetaken(s, s.elder.cookie, free.id);
    });

    it("ちょうど 10 分ちょうどは 204、10 分と 1 ミリ秒は 404（境界はミリ秒）", async () => {
      const s = await setup(5205);
      const a = await postVoice(s.t, s.elder.cookie, s.photoId);
      const b = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      s.t.setNow(new Date(NOW.getTime() + RETAKE_WINDOW_MS + 1));
      await expectKept(s, s.elder.cookie, a.id);
      s.t.setNow(new Date(NOW.getTime() + RETAKE_WINDOW_MS));
      await expectRetaken(s, s.elder.cookie, b.id);
    });

    it("SQL に見える ID・とても長い ID でも 404 で、ほかの行は消えない", async () => {
      const s = await setup(5206);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      for (const id of ["' OR '1'='1", "%", "*", "x".repeat(2000)]) {
        expect((await retake(s.t, s.elder.cookie, id)).status).toBe(404);
      }
      expect(await row(n.id)).not.toBeNull();
    });

    it("合言葉なしは 401 で、何も消えない", async () => {
      const s = await setup(5207);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const res = await s.t.app.request(`/api/narrations/${n.id}`, { method: "DELETE" });
      expect(res.status).toBe(401);
      expect(await row(n.id)).not.toBeNull();
    });
  });
});
