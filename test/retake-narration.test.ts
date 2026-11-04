// 「とりなおす」（0050）のサーバー側: DELETE /api/narrations/:id。
// 消せるのは、この端末の人の声の語りで、送って RETAKE_WINDOW_MS 以内、まだ何にも使われていないものだけ。ほかはすべて 404 で何も消さない。
// 家族・写真・声はすべて架空。Claude と文字起こしは偽物
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RETAKE_WINDOW_MS } from "../src/shared/api";
import type { ClaudeClient, TranscribeInput } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, fakeClaude, fakeTranscriber, makeTestApp, onlyPurpose, postForm, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

const NOW = new Date("2026-11-02T00:00:00Z");
const fakeAudio = { bytes: new Uint8Array([1, 2, 3, 4]), type: "audio/webm;codecs=opus" };
/** 文字起こしの偽物が返す、見分けやすい架空の文（ログに出ないことを確かめる） */
const SECRET_TEXT = "架空のとりなおし本文ぴよぴよ";

function narrationForm(meta: Record<string, unknown>, audio?: typeof fakeAudio): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  if (audio) form.append("audio", new File([audio.bytes], "a", { type: audio.type }));
  return form;
}

type Posted = { id: string; audioUrl: string | null };
async function postVoice(t: TestApp, cookie: string, photoId: string, extra: Record<string, unknown> = {}): Promise<Posted> {
  const meta = { kind: "voice", photoId, entranceId: null, replyToId: null, text: null, ...extra };
  const res = await postForm(t, "/api/narrations", narrationForm(meta, fakeAudio), cookie);
  if (res.status !== 202) throw new Error(`postVoice ${res.status}`);
  return ((await res.json()) as { narration: Posted }).narration;
}
async function postText(t: TestApp, cookie: string, photoId: string, extra: Record<string, unknown> = {}): Promise<Posted> {
  const meta = { kind: "text", photoId, entranceId: null, replyToId: null, text: "架空の文", ...extra };
  const res = await postForm(t, "/api/narrations", narrationForm(meta), cookie);
  if (res.status !== 202) throw new Error(`postText ${res.status}`);
  return ((await res.json()) as { narration: Posted }).narration;
}

const retake = (t: TestApp, cookie: string, id: string) => t.app.request(`/api/narrations/${id}`, { method: "DELETE", headers: { Cookie: cookie } });

async function narrationRow(id: string) {
  return d1.prepare("SELECT * FROM narrations WHERE id = ?").bind(id).first<Record<string, unknown>>();
}
const audioKeys = (t: TestApp, familyId: string) => t.store.keys().filter((k) => k.startsWith(`families/${familyId}/audio/`));

/** 祖母（話す人）と孫。孫の写真一枚 */
async function setup(n: number, opts: Parameters<typeof makeTestApp>[1] = {}) {
  const t = makeTestApp(d1, { now: NOW, ...opts });
  const f = await createFamily(t);
  const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
  const elder = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
  const photo = await addPhoto(t, gc.cookie, n);
  return { t, familyId: f.familyId, gc, elder, photoId: photo.id };
}

describe("DELETE /api/narrations/:id（とりなおす。0050）", () => {
  it("自分の声で 10 分以内なら 204。行と録音が消え、録音は 404、アルバムから消え、今日の答えもなくなる", async () => {
    const s = await setup(3001);
    const today = (await (await s.t.app.request("/api/entrances/today", { headers: { Cookie: s.elder.cookie } })).json()) as {
      entrance: { id: string; photo: { id: string } };
    };
    const n = await postVoice(s.t, s.elder.cookie, today.entrance.photo.id, { entranceId: today.entrance.id });
    await s.t.flush();
    expect(audioKeys(s.t, s.familyId)).toHaveLength(1);

    s.t.setNow(new Date(NOW.getTime() + RETAKE_WINDOW_MS)); // ちょうど 10 分はまだ消せる
    const res = await retake(s.t, s.elder.cookie, n.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    expect(await narrationRow(n.id)).toBeNull();
    expect(audioKeys(s.t, s.familyId)).toEqual([]);
    expect((await s.t.app.request(n.audioUrl!, { headers: { Cookie: s.gc.cookie } })).status).toBe(404);
    const feed = (await (await s.t.app.request("/api/feed", { headers: { Cookie: s.gc.cookie } })).json()) as {
      items: { narrations: { id: string; entranceId: string | null }[] }[];
    };
    const all = feed.items.flatMap((i) => i.narrations);
    expect(all.map((x) => x.id)).not.toContain(n.id);
    expect(all.filter((x) => x.entranceId === today.entrance.id)).toEqual([]);
    const list = (await (await s.t.app.request(`/api/narrations?photoId=${today.entrance.photo.id}`, { headers: { Cookie: s.gc.cookie } })).json()) as {
      narrations: unknown[];
    };
    expect(list.narrations).toEqual([]);
    // 今日の入り口そのものは残る（答えていない状態に戻る）
    const again = (await (await s.t.app.request("/api/entrances/today", { headers: { Cookie: s.elder.cookie } })).json()) as { entrance: { id: string } };
    expect(again.entrance.id).toBe(today.entrance.id);
  });

  it("二度目は 404", async () => {
    const s = await setup(3002);
    const n = await postVoice(s.t, s.elder.cookie, s.photoId);
    await s.t.flush();
    expect((await retake(s.t, s.elder.cookie, n.id)).status).toBe(204);
    const second = await retake(s.t, s.elder.cookie, n.id);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: "not_found" });
  });

  describe("条件に合わなければ 404 で、行も録音も残る", () => {
    async function expectKept(s: Awaited<ReturnType<typeof setup>>, cookie: string, id: string) {
      const keysBefore = audioKeys(s.t, s.familyId);
      const res = await retake(s.t, cookie, id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(await narrationRow(id)).not.toBeNull();
      expect(audioKeys(s.t, s.familyId)).toEqual(keysBefore);
    }

    it("ほかの人の声", async () => {
      const s = await setup(3101);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await expectKept(s, s.gc.cookie, n.id);
    });

    it("ほかの家族の人", async () => {
      const s = await setup(3102);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const other = await createFamily(s.t);
      const stranger = await addMember(s.t, other.cookie, { calledAs: "架空のよその人" });
      await expectKept(s, stranger.cookie, n.id);
    });

    it("文字の語り", async () => {
      const s = await setup(3103);
      const n = await postText(s.t, s.elder.cookie, s.photoId);
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("送って 10 分 1 秒後", async () => {
      const s = await setup(3104);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      s.t.setNow(new Date(NOW.getTime() + RETAKE_WINDOW_MS + 1000));
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("ないもの", async () => {
      const s = await setup(3105);
      const res = await retake(s.t, s.elder.cookie, "no-such-narration");
      expect(res.status).toBe(404);
    });

    it("返事が付いている", async () => {
      const s = await setup(3106);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await postText(s.t, s.gc.cookie, s.photoId, { replyToId: n.id });
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("入り口に引用されている", async () => {
      const s = await setup(3107);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await d1
        .prepare("INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, quote_narration_id, kind, created_at) VALUES (?, ?, ?, '2026-11-03', ?, ?, 'fixed', 1)")
        .bind(crypto.randomUUID(), s.familyId, s.gc.id, s.photoId, n.id)
        .run();
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("入り口の入力（input_narration_ids）にある", async () => {
      const s = await setup(3108);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await d1
        .prepare(
          "INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, question, kind, model, prompt_version, input_narration_ids, created_at) VALUES (?, ?, ?, '2026-11-03', ?, '架空の問い', 'claude', 'm', 'v', ?, 1)",
        )
        .bind(crypto.randomUUID(), s.familyId, s.gc.id, s.photoId, JSON.stringify(["other-narration", n.id]))
        .run();
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("記録（records）が指している（外部キーの違反で 500 にならない）", async () => {
      const s = await setup(3109);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await d1
        .prepare("INSERT INTO records (id, family_id, photo_id, kind, value, origin, told_by_member_id, narration_id, created_at) VALUES (?, ?, ?, 'place', '架空', 'told', ?, ?, 1)")
        .bind(crypto.randomUUID(), s.familyId, s.photoId, s.elder.id, n.id)
        .run();
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("記録の取り出し（record_extractions）が指している", async () => {
      const s = await setup(3110);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      await d1
        .prepare(
          "INSERT INTO record_extractions (narration_id, family_id, prompt_version, model, state, attempts, input_tokens, output_tokens, created_at) VALUES (?, ?, 'extract_records/v1', 'm', 'done', 1, 1, 1, 1)",
        )
        .bind(n.id, s.familyId)
        .run();
      await expectKept(s, s.elder.cookie, n.id);
    });

    it("むすびの根拠（musubi_photos.evidence_narration_id）が指している", async () => {
      const s = await setup(3111);
      const n = await postVoice(s.t, s.elder.cookie, s.photoId);
      await s.t.flush();
      const mu = crypto.randomUUID();
      await d1.prepare("INSERT INTO musubi (id, family_id, created_by, created_at) VALUES (?, ?, 'family', 1)").bind(mu, s.familyId).run();
      await d1
        .prepare(
          "INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, evidence_narration_id, decided_by_member_id, decided_at, created_at) VALUES (?, ?, ?, 'confirmed', ?, ?, 1, 1)",
        )
        .bind(mu, s.photoId, s.familyId, n.id, s.gc.id)
        .run();
      await expectKept(s, s.elder.cookie, n.id);
    });
  });

  it("文字起こしが消した後に終わっても、行は戻らず例外にならない", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = fakeTranscriber(() => ({ ok: true, text: SECRET_TEXT }));
    const transcriber = { ...inner, transcribe: async (input: TranscribeInput) => (await gate, inner.transcribe(input)) };
    const s = await setup(3201, { transcriber });
    const n = await postVoice(s.t, s.elder.cookie, s.photoId);
    expect((await retake(s.t, s.elder.cookie, n.id)).status).toBe(204);
    release();
    await expect(s.t.flush()).resolves.toBeUndefined();
    expect(inner.calls).toHaveLength(1);
    expect(await narrationRow(n.id)).toBeNull();
  });

  it("整形が消した後に終わっても、行は戻らず例外にならない", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const cleaning = new Promise<void>((r) => (entered = r));
    const fc = fakeClaude({ replies: [{ kind: "json", value: { marked: SECRET_TEXT }, model: "claude-haiku-5-5" }] });
    const inner = onlyPurpose(fc.claude, "clean_transcript");
    const claude: ClaudeClient = {
      ...inner,
      call: async (req) => {
        if (req.prompt.purpose === "clean_transcript") {
          entered();
          await gate;
        }
        return inner.call(req);
      },
    };
    const s = await setup(3202, { claude, transcriber: fakeTranscriber(() => ({ ok: true, text: SECRET_TEXT })) });
    const n = await postVoice(s.t, s.elder.cookie, s.photoId);
    await cleaning; // 文字起こしは済み、整形の呼び出しを待っている
    expect((await narrationRow(n.id))!.transcript).toBe(SECRET_TEXT);
    expect((await retake(s.t, s.elder.cookie, n.id)).status).toBe(204);
    release();
    await expect(s.t.flush()).resolves.toBeUndefined();
    expect(fc.requests).toHaveLength(1);
    expect(await narrationRow(n.id)).toBeNull();
  });

  it("録音のファイルが消せなくても 204（語りはもう消えている）。ログは種類だけ", async () => {
    const s = await setup(3301);
    const n = await postVoice(s.t, s.elder.cookie, s.photoId);
    await s.t.flush();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    const store = s.t.deps.photos;
    s.t.deps.photos = { ...store, delete: async () => Promise.reject(new TypeError(`r2 down families/${s.familyId}/audio/${n.id}`)) };
    expect((await retake(s.t, s.elder.cookie, n.id)).status).toBe(204);
    expect(await narrationRow(n.id)).toBeNull();
    const failed = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "narration_retake_audio_delete_failed");
    expect(failed).toEqual({ event: "narration_retake_audio_delete_failed", familyId: s.familyId, narrationId: n.id, errorType: "TypeError" });
    expect(lines.join("\n")).not.toContain("/audio/");
  });

  it("ログ narration_retaken は ID と数だけ（本文・録音のキー・URL を出さない）", async () => {
    const s = await setup(3401, { transcriber: fakeTranscriber(() => ({ ok: true, text: SECRET_TEXT })) });
    const n = await postVoice(s.t, s.elder.cookie, s.photoId);
    await s.t.flush();
    expect((await narrationRow(n.id))!.transcript).toBe(SECRET_TEXT);
    s.t.setNow(new Date(NOW.getTime() + 90_000));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    expect((await retake(s.t, s.elder.cookie, n.id)).status).toBe(204);
    const logs = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logs.filter((l) => l.event === "narration_retaken")).toEqual([
      { event: "narration_retaken", familyId: s.familyId, narrationId: n.id, speakerMemberId: s.elder.id, kind: "voice", ageMs: 90_000, hadAudio: true },
    ]);
    const all = lines.join("\n");
    expect(all).not.toContain(SECRET_TEXT);
    expect(all).not.toContain("families/");
    expect(all).not.toContain("/api/");
  });
});
