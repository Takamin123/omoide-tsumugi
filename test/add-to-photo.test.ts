// 「この写真に追加する」（0048）のサーバー側: POST /api/photos の meta.withPhotoId、はずす（DELETE /api/musubi/:musubiId/photos/:photoId）、
// /api/feed の addedPhotos、入り口 v3 と musubi_guess での家族の手のむすびの扱い、冪等。Claude は偽物。家族はすべて架空。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UploadPhotoResult } from "../src/shared/api";
import { notConfiguredClaude } from "../src/server/core/claude";
import { ensureMorningEntrance, sameEventLinks } from "../src/server/core/entrance-claude";
import { dropOverlapping } from "../src/server/core/musubi-guess";
import type { ClaudeCallRequest, ClaudeCallResult, ClaudeClient } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, hashOf, makeTestApp, onlyPurpose, photoForm, postForm, startD1, tinyJpeg, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const NOW = new Date("2026-11-02T00:00:00Z");

async function upload(t: TestApp, cookie: string, n: number, withPhotoId?: string): Promise<Response> {
  const meta: Record<string, unknown> = { contentHash: hashOf(n), width: 10, height: 10, takenAt: null, latitude: null, longitude: null };
  if (withPhotoId !== undefined) meta.withPhotoId = withPhotoId;
  return postForm(t, "/api/photos", photoForm(meta, tinyJpeg(n)), cookie);
}
const body = async (res: Response) => (await res.json()) as UploadPhotoResult;

async function postText(t: TestApp, cookie: string, photoId: string, text: string): Promise<string> {
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId, entranceId: null, replyToId: null, text }));
  const res = await postForm(t, "/api/narrations", form, cookie);
  return ((await res.json()) as { narration: { id: string } }).narration.id;
}

async function musubiRows(familyId: string) {
  return (await d1.prepare("SELECT * FROM musubi WHERE family_id = ? ORDER BY created_at, id").bind(familyId).all<Record<string, unknown>>()).results;
}
async function musubiPhotoRows(musubiId: string) {
  return (
    await d1.prepare("SELECT * FROM musubi_photos WHERE musubi_id = ? ORDER BY created_at, photo_id").bind(musubiId).all<Record<string, unknown>>()
  ).results;
}
async function countPhotos(familyId: string) {
  return (await d1.prepare("SELECT count(*) AS n FROM photos WHERE family_id = ?").bind(familyId).first<{ n: number }>())!.n;
}

async function insertGuessed(familyId: string, id: string, photoIds: string[]) {
  await d1
    .prepare("INSERT INTO musubi (id, family_id, created_by, guessed_reason, guessed_evidence_record_ids, model, prompt_version, created_at) VALUES (?, ?, 'guessed', '架空', '[]', 'm', 'musubi_guess/v1', 1)")
    .bind(id, familyId)
    .run();
  for (const p of photoIds) {
    await d1.prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES (?, ?, ?, 'guessed', 1)").bind(id, p, familyId).run();
  }
}

/** 孫とおば（どちらも家族の画面）、祖母。孫の写真 X */
async function setup(n0: number) {
  const t = makeTestApp(d1, { now: NOW });
  const f = await createFamily(t);
  const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
  const aunt = await addMember(t, gc.cookie, { relation: "おば", calledAs: "架空のおば" });
  const elder = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
  const x = await addPhoto(t, gc.cookie, n0);
  return { t, familyId: f.familyId, gc, aunt, elder, x: x.id };
}

describe("POST /api/photos の withPhotoId（0048）", () => {
  it("新しい写真: 家族の手のむすび {X, Z} を作り、両方 confirmed（決めた人 = この端末の人、時刻 = 今）。推測の欄は null", async () => {
    const s = await setup(1001);
    const res = await upload(s.t, s.gc.cookie, 1002, s.x);
    expect(res.status).toBe(201);
    const b = await body(res);
    expect(b.duplicate).toBe(false);
    expect(b.link).toEqual({ musubiId: expect.any(String), linked: true });

    const ms = await musubiRows(s.familyId);
    expect(ms).toEqual([
      {
        id: b.link!.musubiId,
        family_id: s.familyId,
        created_by: "family",
        guessed_reason: null,
        guessed_evidence_record_ids: null,
        model: null,
        prompt_version: null,
        created_at: NOW.getTime(),
      },
    ]);
    const rows = await musubiPhotoRows(b.link!.musubiId);
    expect(rows.map((r) => r.photo_id).sort()).toEqual([s.x, b.photo.id].sort());
    for (const r of rows) {
      expect(r).toMatchObject({ family_id: s.familyId, status: "confirmed", decided_by_member_id: s.gc.id, decided_at: NOW.getTime(), evidence_narration_id: null });
    }
  });

  it("二枚目は同じむすびに入る。ほかの人が作った家族のむすびにも入る（決めた人はその人）", async () => {
    const s = await setup(1011);
    const first = await body(await upload(s.t, s.gc.cookie, 1012, s.x));
    s.t.setNow(new Date(NOW.getTime() + 1000));
    const second = await body(await upload(s.t, s.aunt.cookie, 1013, s.x));
    expect(second.link).toEqual({ musubiId: first.link!.musubiId, linked: true });
    expect(await musubiRows(s.familyId)).toHaveLength(1);
    const rows = await musubiPhotoRows(first.link!.musubiId);
    expect(rows.map((r) => [r.photo_id, r.decided_by_member_id])).toEqual([
      ...[
        [s.x, s.gc.id],
        [first.photo.id, s.gc.id],
      ].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
      [second.photo.id, s.aunt.id],
    ]);
  });

  it("X が推測のむすびにしかいなければ、推測のむすびには触らず、新しい家族のむすびを作る", async () => {
    const s = await setup(1021);
    const w = await addPhoto(s.t, s.gc.cookie, 1022);
    const guessedId = `mu-${crypto.randomUUID()}`;
    await insertGuessed(s.familyId, guessedId, [s.x, w.id]);
    const before = await musubiPhotoRows(guessedId);

    const b = await body(await upload(s.t, s.gc.cookie, 1023, s.x));
    expect(b.link!.musubiId).not.toBe(guessedId);
    expect(await musubiPhotoRows(guessedId)).toEqual(before);
    const ms = await musubiRows(s.familyId);
    expect(ms.map((m) => m.created_by).sort()).toEqual(["family", "guessed"]);
  });

  it("ほかの家族の写真・ない写真を指せば 404 で、保存先にもデータベースにも入れない", async () => {
    const s = await setup(1031);
    const g = await createFamily(s.t);
    const ga = await addMember(s.t, g.cookie, { calledAs: "架空のよそ" });
    const other = await addPhoto(s.t, ga.cookie, 1032);
    const keys = s.t.store.keys().length;
    const photos = await countPhotos(s.familyId);

    for (const target of [other.id, "no-such-photo"]) {
      const res = await upload(s.t, s.gc.cookie, 1033, target);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(s.t.store.keys().length).toBe(keys);
    expect(await countPhotos(s.familyId)).toBe(photos);
    expect(await musubiRows(s.familyId)).toEqual([]);
    expect(await musubiRows(g.familyId)).toEqual([]);
  });

  it("重複の写真でもつながりは作る。二度目は linked = false で、何も増えない（冪等）", async () => {
    const s = await setup(1041);
    const z = await addPhoto(s.t, s.gc.cookie, 1042);
    const keys = s.t.store.keys().length;

    const res1 = await upload(s.t, s.gc.cookie, 1042, s.x);
    expect(res1.status).toBe(200);
    const b1 = await body(res1);
    expect(b1).toMatchObject({ duplicate: true, photo: { id: z.id }, link: { linked: true } });

    const b2 = await body(await upload(s.t, s.gc.cookie, 1042, s.x));
    expect(b2).toMatchObject({ duplicate: true, link: { musubiId: b1.link!.musubiId, linked: false } });
    expect(await musubiRows(s.familyId)).toHaveLength(1);
    expect(await musubiPhotoRows(b1.link!.musubiId)).toHaveLength(2);
    expect(s.t.store.keys().length).toBe(keys);
  });

  it("送った写真が X そのものならつながない（link = null）。withPhotoId がなければ link = null", async () => {
    const s = await setup(1051);
    const same = await body(await upload(s.t, s.gc.cookie, 1051, s.x));
    expect(same).toMatchObject({ duplicate: true, photo: { id: s.x }, link: null });
    const plain = await upload(s.t, s.gc.cookie, 1052);
    expect(plain.status).toBe(201);
    expect((await body(plain)).link).toBeNull();
    expect(await musubiRows(s.familyId)).toEqual([]);
  });
});

describe("DELETE /api/musubi/:musubiId/photos/:photoId（はずす。0048）", () => {
  it("自分が決めた行だけ消せる。ほかの人・推測のむすび・ほかの家族・ないものは 404。写真は消さない", async () => {
    const s = await setup(1101);
    const b = await body(await upload(s.t, s.gc.cookie, 1102, s.x));
    const mu = b.link!.musubiId;
    const del = (cookie: string, musubiId: string, photoId: string) =>
      s.t.app.request(`/api/musubi/${encodeURIComponent(musubiId)}/photos/${encodeURIComponent(photoId)}`, { method: "DELETE", headers: { Cookie: cookie } });

    // ほかの人（同じ家族）
    expect((await del(s.aunt.cookie, mu, b.photo.id)).status).toBe(404);
    // 推測のむすび
    const w = await addPhoto(s.t, s.gc.cookie, 1103);
    const guessedId = `mu-${crypto.randomUUID()}`;
    await insertGuessed(s.familyId, guessedId, [s.x, w.id]);
    expect((await del(s.gc.cookie, guessedId, w.id)).status).toBe(404);
    expect(await musubiPhotoRows(guessedId)).toHaveLength(2);
    // ほかの家族の人
    const g = await createFamily(s.t);
    const ga = await addMember(s.t, g.cookie, { calledAs: "架空のよそ" });
    expect((await del(ga.cookie, mu, b.photo.id)).status).toBe(404);
    // ない
    expect((await del(s.gc.cookie, "no-such", b.photo.id)).status).toBe(404);
    expect(await musubiPhotoRows(mu)).toHaveLength(2);

    const res = await del(s.gc.cookie, mu, b.photo.id);
    expect(res.status).toBe(204);
    expect((await musubiPhotoRows(mu)).map((r) => r.photo_id)).toEqual([s.x]);
    // 写真は棚に残る
    expect(await s.t.deps.repos.photos.get(s.familyId, b.photo.id)).not.toBeNull();
    // 二度目は 404（冪等: 何も変わらない）
    expect((await del(s.gc.cookie, mu, b.photo.id)).status).toBe(404);

    // 消した後は、入り口のつながりにも出ない
    const all = await s.t.deps.repos.musubi.listByFamily(s.familyId);
    const ids = new Set((await s.t.deps.repos.photos.list(s.familyId)).map((p) => p.id));
    const links = sameEventLinks(all, ids);
    expect((links.get(s.x) ?? []).map((l) => l.withPhotoId)).not.toContain(b.photo.id);
    expect(links.get(b.photo.id)).toBeUndefined();
  });

  it("合言葉がなければ 401", async () => {
    const s = await setup(1111);
    const res = await s.t.app.request(`/api/musubi/x/photos/y`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

describe("/api/feed の addedPhotos（0048）", () => {
  it("家族の手のむすびの confirmed のほかの写真を、古く追加した順に Photo の形で。推測は出ない。ほかの家族は混ざらない", async () => {
    const s = await setup(1201);
    await postText(s.t, s.gc.cookie, s.x, "架空の海の話");
    const z1 = await body(await upload(s.t, s.gc.cookie, 1202, s.x));
    s.t.setNow(new Date(NOW.getTime() + 1000));
    const z2 = await body(await upload(s.t, s.aunt.cookie, 1203, s.x));
    // 推測のむすび {X, W}
    const w = await addPhoto(s.t, s.gc.cookie, 1204);
    await insertGuessed(s.familyId, `mu-${crypto.randomUUID()}`, [s.x, w.id]);
    // Z2 に語りがあれば、Z2 の item にも X と Z1 が出る
    await postText(s.t, s.aunt.cookie, z2.photo.id, "架空の砂浜の話");

    // ほかの家族にも家族の手のむすびがある
    const g = await createFamily(s.t);
    const ga = await addMember(s.t, g.cookie, { calledAs: "架空のよそ" });
    const gx = await addPhoto(s.t, ga.cookie, 1205);
    await postText(s.t, ga.cookie, gx.id, "架空のよその話");
    const gz = await body(await upload(s.t, ga.cookie, 1206, gx.id));

    const res = await s.t.app.request("/api/feed", { headers: { Cookie: s.gc.cookie } });
    const feed = (await res.json()) as { items: { photo: { id: string }; addedPhotos: Record<string, unknown>[] }[] };
    const item = (id: string) => feed.items.find((i) => i.photo.id === id)!;
    // 語りのない Z1 は item にならない
    expect(feed.items.map((i) => i.photo.id).sort()).toEqual([s.x, z2.photo.id].sort());
    expect(item(s.x).addedPhotos.map((p) => p.id)).toEqual([z1.photo.id, z2.photo.id]);
    expect(Object.keys(item(s.x).addedPhotos[0]!).sort()).toEqual(["hasLocation", "height", "id", "imageUrl", "ownerMemberId", "place", "takenAt", "width"]);
    // X と Z1 は同じ時刻に入った（同じ時刻なら ID の順）
    expect(item(z2.photo.id).addedPhotos.map((p) => p.id)).toEqual([s.x, z1.photo.id].sort());
    const text = JSON.stringify(feed);
    expect(text).not.toContain(w.id);
    expect(text).not.toContain(gx.id);
    expect(text).not.toContain(gz.photo.id);
    expect(text).not.toContain("musubi");

    // ほかの家族の feed にも、こちらの写真は出ない
    const other = await (await s.t.app.request("/api/feed", { headers: { Cookie: ga.cookie } })).json() as { items: { photo: { id: string }; addedPhotos: { id: string }[] }[] };
    expect(other.items.map((i) => [i.photo.id, i.addedPhotos.map((p) => p.id)])).toEqual([[gx.id, [gz.photo.id]]]);
  });

  it("むすびが読めなくても feed は開く（追加した写真が空になるだけ）", async () => {
    const s = await setup(1211);
    await postText(s.t, s.gc.cookie, s.x, "架空の話");
    await upload(s.t, s.gc.cookie, 1212, s.x);
    await d1.prepare("ALTER TABLE musubi RENAME TO musubi_hidden_feed").run();
    try {
      const res = await s.t.app.request("/api/feed", { headers: { Cookie: s.gc.cookie } });
      expect(res.status).toBe(200);
      const feed = (await res.json()) as { items: { addedPhotos: unknown[] }[] };
      expect(feed.items.map((i) => i.addedPhotos)).toEqual([[]]);
    } finally {
      await d1.prepare("ALTER TABLE musubi_hidden_feed RENAME TO musubi").run();
    }
  });
});

// ---- 入り口 v3 と musubi_guess（変えずに、家族の手のむすびを今のまま使う） ----

/** 渡された候補の先頭を選ぶ偽物。送った本文を記録する */
function recordingClaude() {
  const sent: string[] = [];
  const claude: ClaudeClient = {
    async call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>> {
      const text = req.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      sent.push(text);
      const candidates = [...text.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1]!);
      const value = { receiver_present: "no", reason: "架空の理由", photo_id: candidates[0]!, focus: null, quote: null, question: "この日のことを、聞かせてください" } as T;
      const meta = { purpose: req.prompt.purpose, model: "claude-fake", promptVersion: req.prompt.version, inputTokens: 1, outputTokens: 1, attempts: 1 };
      return { ok: true, value, meta };
    },
    createBatch: (req) => notConfiguredClaude.createBatch(req),
    getBatch: (id) => notConfiguredClaude.getBatch(id),
    getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
  };
  return { claude, sent };
}

describe("入り口 v3: 家族の手のむすびは confirmed のつながり", () => {
  it("g1a の先頭に来て（推測より先）、<same_event status=\"confirmed\"> で渡る", async () => {
    const fake = recordingClaude();
    const t = makeTestApp(d1, { claude: onlyPurpose(fake.claude, "entrance"), now: new Date("2026-11-02T10:00:00Z") });
    const f = await createFamily(t);
    const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
    const elder = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
    const x = await addPhoto(t, gc.cookie, 1301);
    const x2 = await addPhoto(t, gc.cookie, 1302);
    const w = await addPhoto(t, gc.cookie, 1303);
    // 祖母が X を語り、後で X2 を語った（推測のつながりの方が語りが新しい）
    await postText(t, elder.cookie, x.id, "架空の盆踊りの話");
    t.setNow(new Date("2026-11-02T11:00:00Z"));
    await postText(t, elder.cookie, x2.id, "架空の運動会の話");
    // 孫が X に Y を追加して語る。推測のむすび {X2, W} に孫の語り
    const y = await body(await upload(t, gc.cookie, 1304, x.id));
    await postText(t, gc.cookie, y.photo.id, "架空の夜店の話");
    await postText(t, gc.cookie, w.id, "架空の徒競走の話");
    await insertGuessed(f.familyId, `mu-${crypto.randomUUID()}`, [x2.id, w.id]);
    await t.flush();

    const NOW_MORNING = new Date("2026-11-02T21:00:00Z");
    const r = await ensureMorningEntrance(t.deps, { id: f.familyId }, { id: elder.id }, "2026-11-03", NOW_MORNING.getTime(), { useClaude: true, version: "v3" });
    expect(r.via).toBe("claude");
    const sent = fake.sent[0]!;
    const order = [...sent.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1]);
    expect(order.slice(0, 2)).toEqual([y.photo.id, w.id]);
    expect(sent).toContain(`<same_event with="${x.id}" status="confirmed"`);
  });
});

describe("musubi_guess: 家族の手のむすびと重なる推測は作らない", () => {
  it("dropOverlapping は家族の手のむすびの写真を既存として扱う", async () => {
    const s = await setup(1401);
    const z = await body(await upload(s.t, s.gc.cookie, 1402, s.x));
    const other = await addPhoto(s.t, s.gc.cookie, 1403);
    const more = await addPhoto(s.t, s.gc.cookie, 1404);
    const existing = await s.t.deps.repos.musubi.listByFamily(s.familyId);
    const r = (photoIds: string[]) => ({ photoIds, evidenceRecordIds: ["r"], reason: "架空" });
    expect(dropOverlapping([r([z.photo.id, other.id]), r([other.id, more.id])], existing)).toEqual({ kept: [r([other.id, more.id])], dropped: 1 });
  });
});

// ---- qa-engineer が足した境目（0048） ----

describe("境目: 人のいないリンク・祖父母の画面の人・同時に届いた写真（0048）", () => {
  it("最初の人のリンク（人を指さないリンク）では、はずすも withPhotoId 付きの登録も 403", async () => {
    const t = makeTestApp(d1, { now: NOW });
    const f = await createFamily(t);
    const res = await t.app.request(`/api/musubi/x/photos/y`, { method: "DELETE", headers: { Cookie: f.cookie } });
    expect(res.status).toBe(403);
    const up = await upload(t, f.cookie, 1501, "no-such-photo");
    expect(up.status).toBe(403);
    expect(t.store.keys()).toEqual([]);
  });

  it("祖父母の画面の人（role elder）でも、追加とはずすは同じに動く（決めた人 = その人）", async () => {
    const s = await setup(1511);
    const res = await upload(s.t, s.elder.cookie, 1512, s.x);
    expect(res.status).toBe(201);
    const b = await body(res);
    expect(b.link).toEqual({ musubiId: expect.any(String), linked: true });
    const rows = await musubiPhotoRows(b.link!.musubiId);
    expect(rows.map((r) => r.decided_by_member_id)).toEqual([s.elder.id, s.elder.id]);
    // 孫はおばあさんの行をはずせない。本人ははずせる
    const del = (cookie: string) =>
      s.t.app.request(`/api/musubi/${b.link!.musubiId}/photos/${b.photo.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect((await del(s.gc.cookie)).status).toBe(404);
    expect((await del(s.elder.cookie)).status).toBe(204);
  });

  it("同時に同じ写真が届いて insert が負けたら、こちらの保存は消し、勝った写真でつなぐ（X だけのむすびを残さない）", async () => {
    const s = await setup(1521);
    const winner = await addPhoto(s.t, s.gc.cookie, 1522);
    const keys = s.t.store.keys().sort();
    // 先に重複を確かめた時点では、まだ勝った方が見えていなかったことにする
    const repo = s.t.deps.repos.photos;
    const orig = repo.findByOwnerHash.bind(repo);
    let first = true;
    repo.findByOwnerHash = async (...a) => {
      if (first) {
        first = false;
        return null;
      }
      return orig(...a);
    };
    try {
      const res = await upload(s.t, s.gc.cookie, 1522, s.x);
      expect(res.status).toBe(200);
      const b = await body(res);
      expect(b).toMatchObject({ duplicate: true, photo: { id: winner.id }, link: { linked: true } });
      expect(s.t.store.keys().sort()).toEqual(keys);
      const ms = await musubiRows(s.familyId);
      expect(ms).toHaveLength(1);
      expect((await musubiPhotoRows(b.link!.musubiId)).map((r) => r.photo_id).sort()).toEqual([s.x, winner.id].sort());
    } finally {
      repo.findByOwnerHash = orig;
    }
  });

  it("X が二つの家族のむすびにいれば、いちばん古い方へ足す。はずした後にもう一度足せば、同じむすびへ戻る", async () => {
    const s = await setup(1531);
    const a = await body(await upload(s.t, s.gc.cookie, 1532, s.x));
    // もう一つの家族のむすび（X を含む）を、後の時刻で手で作る
    const later = `mu-${crypto.randomUUID()}`;
    await d1.prepare("INSERT INTO musubi (id, family_id, created_by, created_at) VALUES (?, ?, 'family', ?)").bind(later, s.familyId, NOW.getTime() + 5000).run();
    await d1
      .prepare(
        "INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, decided_by_member_id, decided_at, created_at) VALUES (?, ?, ?, 'confirmed', ?, ?, ?)",
      )
      .bind(later, s.x, s.familyId, s.aunt.id, NOW.getTime() + 5000, NOW.getTime() + 5000)
      .run();
    const b2 = await body(await upload(s.t, s.aunt.cookie, 1533, s.x));
    expect(b2.link!.musubiId).toBe(a.link!.musubiId);

    const del = await s.t.app.request(`/api/musubi/${a.link!.musubiId}/photos/${a.photo.id}`, { method: "DELETE", headers: { Cookie: s.gc.cookie } });
    expect(del.status).toBe(204);
    const again = await body(await upload(s.t, s.gc.cookie, 1532, s.x));
    expect(again).toMatchObject({ duplicate: true, link: { musubiId: a.link!.musubiId, linked: true } });
  });

  it("ほかの家族のむすびは、自分の cookie では消せない", async () => {
    const s = await setup(1541);
    const mine = await body(await upload(s.t, s.gc.cookie, 1542, s.x));
    const g = await createFamily(s.t);
    const ga = await addMember(s.t, g.cookie, { calledAs: "架空のよそ" });
    const gx = await addPhoto(s.t, ga.cookie, 1543);
    const theirs = await body(await upload(s.t, ga.cookie, 1544, gx.id));
    const del = (musubiId: string, photoId: string) =>
      s.t.app.request(`/api/musubi/${musubiId}/photos/${photoId}`, { method: "DELETE", headers: { Cookie: s.gc.cookie } });
    expect((await del(theirs.link!.musubiId, theirs.photo.id)).status).toBe(404);
    expect((await del(theirs.link!.musubiId, mine.photo.id)).status).toBe(404);
    expect(await musubiPhotoRows(theirs.link!.musubiId)).toHaveLength(2);
    expect(await musubiPhotoRows(mine.link!.musubiId)).toHaveLength(2);
  });
});
