// 一人ずつのリンク（0036）。リンクを開いた端末は最初からその人。書き込みは cookie の人に結びつく。
// 架空の家族と架空の値だけを使う。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changesOwnRole } from "../src/server/routes/members";
import type { MemberRow } from "../src/server/core/ports";
import {
  addMember,
  addPhoto,
  cookieOf,
  createFamily,
  defaultMember,
  hashOf,
  inviteCookieFrom,
  makeTestApp,
  memberLinkCookie,
  photoForm,
  postForm,
  startD1,
  tinyJpeg,
  type TestApp,
} from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  t = makeTestApp(d1);
}, 60_000);
afterAll(() => dispose());

const get = (path: string, cookie: string) => t.app.request(path, { headers: { Cookie: cookie } });
const send = (method: string, path: string, cookie: string, body?: unknown) =>
  t.app.request(path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const elderInput = { role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "鹿児島", setUpByMemberId: null };

type View = { me: { id: string; role: string } | null; members: { id: string; hasLink: boolean }[] };
const viewOf = async (cookie: string) => (await (await get("/api/family", cookie)).json()) as View;

/** 家族の人（作った人）と祖母。どちらもリンクを持つ */
async function family() {
  const f = await createFamily(t);
  const mom = await addMember(t, f.cookie);
  const grandma = await addMember(t, mom.cookie, elderInput);
  return { f, mom, grandma };
}

describe("最初の人のリンク", () => {
  it("家族の様子は見られる（me は null）。ほかの入り口は 403 で、cookie は消さない", async () => {
    const f = await createFamily(t);
    expect((await viewOf(f.cookie)).me).toBeNull();
    for (const [method, path] of [
      ["GET", "/api/feed"],
      ["GET", "/api/photos"],
      ["GET", "/api/entrances/today"],
      ["POST", "/api/demo/clock/advance"],
      ["POST", "/api/members/x/link"],
      ["PATCH", "/api/members/x"],
    ] as const) {
      const res = await send(method, path, f.cookie);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
      expect(res.headers.get("set-cookie"), `${method} ${path}`).toBeNull();
    }
    // 語りも写真も送れない
    expect((await postForm(t, "/api/photos", photoForm({ contentHash: hashOf(1), width: 1, height: 1, takenAt: null, latitude: null, longitude: null }), f.cookie)).status).toBe(403);
  });

  it("最初の一人は家族の画面の人だけ（elder や代わりの設定は 400）", async () => {
    const f = await createFamily(t);
    expect((await send("POST", "/api/members", f.cookie, elderInput)).status).toBe(400);
    expect((await send("POST", "/api/members", f.cookie, { ...defaultMember, setUpByMemberId: "x" })).status).toBe(400);
    // まだ使える
    expect((await viewOf(f.cookie)).me).toBeNull();
  });

  it("一度きり: 自分を入れると、その人のリンクが cookie に置かれ（本文には返さない）、最初の人のリンクは使えなくなる", async () => {
    const f = await createFamily(t);
    const res = await send("POST", "/api/members", f.cookie, defaultMember);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ role: "family", hasLink: true });
    expect(body).not.toHaveProperty("token");
    const own = inviteCookieFrom(res)!;
    expect(own).not.toBe(f.cookie);
    expect(own).toMatch(/omoide_invite=[A-Za-z0-9_-]{43}$/);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/);

    const view = await viewOf(own);
    expect(view.me?.id).toBe(body.id);
    expect(view.members).toEqual([expect.objectContaining({ id: body.id, hasLink: true })]);

    // 最初の人のリンクは、もう誰も使えない（もう一人入れることもできない）
    expect((await get("/api/family", f.cookie)).status).toBe(401);
    expect((await send("POST", "/api/members", f.cookie, defaultMember)).status).toBe(401);
    expect((await t.app.request("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: f.token }) })).status).toBe(401);
  });

  it("家族にもう人がいれば、最初の人のリンクでは入れない（403）", async () => {
    const f = await createFamily(t);
    // 運営の作業などで人だけが先に入った状態（架空）
    await d1
      .prepare("INSERT INTO members (id, family_id, role, relation, called_as, speech_style, created_at) VALUES (?, ?, 'family', '母', 'おかあさん', 'standard', 0)")
      .bind(crypto.randomUUID(), f.familyId)
      .run();
    const res = await send("POST", "/api/members", f.cookie, defaultMember);
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("二つの端末が同時に最初の人になろうとしても、入るのは一人だけ", async () => {
    const f = await createFamily(t);
    const results = await Promise.all([
      send("POST", "/api/members", f.cookie, { ...defaultMember, calledAs: "ひとり" }),
      send("POST", "/api/members", f.cookie, { ...defaultMember, calledAs: "ふたり" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([401, 403]).toContain(statuses[1]);
    const count = await d1.prepare("SELECT count(*) AS n FROM members WHERE family_id = ?").bind(f.familyId).first<{ n: number }>();
    expect(count?.n).toBe(1);
    const links = await d1
      .prepare("SELECT count(*) AS n FROM invite_links WHERE family_id = ? AND revoked_at IS NULL")
      .bind(f.familyId)
      .first<{ n: number }>();
    expect(links?.n).toBe(1);
  });
});

describe("その人のリンクを作る（POST /api/members/:id/link）", () => {
  it("作り直すと、その人の前のリンクだけが使えなくなる", async () => {
    const { f, mom, grandma } = await family();
    const grandpa = await addMember(t, mom.cookie, { ...elderInput, relation: "祖父", calledAs: "じいじ" });
    const again = await send("POST", `/api/members/${grandma.id}/link`, mom.cookie);
    expect(again.status).toBe(200);
    const { token } = (await again.json()) as { token: string };
    // 自分ではない人のリンクなので、この端末の cookie は替えない
    expect(again.headers.get("set-cookie")).toBeNull();

    expect((await get("/api/family", grandma.cookie)).status).toBe(401);
    expect((await viewOf(cookieOf(token))).me?.id).toBe(grandma.id);
    expect((await viewOf(mom.cookie)).me?.id).toBe(mom.id);
    expect((await viewOf(grandpa.cookie)).me?.id).toBe(grandpa.id);

    const rows = await d1
      .prepare("SELECT member_id, count(*) AS n FROM invite_links WHERE family_id = ? AND revoked_at IS NULL GROUP BY member_id")
      .bind(f.familyId)
      .all<{ member_id: string; n: number }>();
    expect(rows.results.map((r) => [r.member_id, r.n]).sort()).toEqual([[grandma.id, 1], [grandpa.id, 1], [mom.id, 1]].sort());
  });

  it("自分のリンクを作り直すと、この端末の cookie も新しいものに替わる", async () => {
    const { mom } = await family();
    const res = await send("POST", `/api/members/${mom.id}/link`, mom.cookie);
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(inviteCookieFrom(res)).toBe(cookieOf(token));
    expect((await get("/api/family", mom.cookie)).status).toBe(401);
    expect((await viewOf(cookieOf(token))).me?.id).toBe(mom.id);
  });

  it("ほかの家族の人・いない人のリンクは作れない（404）", async () => {
    const a = await family();
    const b = await family();
    expect((await send("POST", `/api/members/${b.grandma.id}/link`, a.mom.cookie)).status).toBe(404);
    expect((await send("POST", "/api/members/nobody/link", a.mom.cookie)).status).toBe(404);
    // b の祖母のリンクはそのまま
    expect((await viewOf(b.grandma.cookie)).me?.id).toBe(b.grandma.id);
  });

  it("hasLink: 足しただけの人は false、リンクを作ると true", async () => {
    const { mom } = await family();
    const res = await send("POST", "/api/members", mom.cookie, { ...defaultMember, relation: "孫", calledAs: "けん" });
    expect(res.status).toBe(201);
    const ken = (await res.json()) as { id: string; hasLink: boolean };
    expect(ken.hasLink).toBe(false);
    expect((await viewOf(mom.cookie)).members.find((m) => m.id === ken.id)?.hasLink).toBe(false);
    await memberLinkCookie(t, mom.cookie, ken.id);
    expect((await viewOf(mom.cookie)).members.find((m) => m.id === ken.id)?.hasLink).toBe(true);
  });
});

describe("祖父母の画面の人の端末", () => {
  it("家族のこと（人を足す・直す・リンクを作る）は 403。cookie は消さない", async () => {
    const { mom, grandma } = await family();
    for (const res of [
      await send("POST", "/api/members", grandma.cookie, { ...defaultMember, relation: "孫", calledAs: "けん" }),
      await send("PATCH", `/api/members/${mom.id}`, grandma.cookie, { ...defaultMember, calledAs: "x" }),
      await send("PATCH", `/api/members/${grandma.id}`, grandma.cookie, { ...elderInput, calledAs: "x" }),
      await send("POST", `/api/members/${grandma.id}/link`, grandma.cookie),
      await send("POST", `/api/members/${mom.id}/link`, grandma.cookie),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    // 見ることはできる
    const view = await viewOf(grandma.cookie);
    expect(view.me).toMatchObject({ id: grandma.id, role: "elder" });
    expect((await get("/api/feed", grandma.cookie)).status).toBe(200);
  });
});

describe("自分の role は直せない", () => {
  it("自分の role を変えると 403。ほかの欄は自分でも直せる。ほかの人の role は直せる", async () => {
    const { mom, grandma } = await family();
    const own = await send("PATCH", `/api/members/${mom.id}`, mom.cookie, { ...defaultMember, role: "elder" });
    expect(own.status).toBe(403);
    expect((await viewOf(mom.cookie)).me?.role).toBe("family");

    const rename = await send("PATCH", `/api/members/${mom.id}`, mom.cookie, { ...defaultMember, calledAs: "ママ" });
    expect(rename.status).toBe(200);
    expect(await rename.json()).toMatchObject({ calledAs: "ママ", role: "family", hasLink: true });

    const other = await send("PATCH", `/api/members/${grandma.id}`, mom.cookie, { ...elderInput, role: "family" });
    expect(other.status).toBe(200);
  });

  it("changesOwnRole: 自分で、かつ role が変わるときだけ", () => {
    const me = { id: "m", role: "family" } as MemberRow;
    const input = { ...defaultMember } as unknown as Parameters<typeof changesOwnRole>[2];
    expect(changesOwnRole(me, "m", { ...input, role: "elder" })).toBe(true);
    expect(changesOwnRole(me, "m", { ...input, role: "family" })).toBe(false);
    expect(changesOwnRole(me, "other", { ...input, role: "elder" })).toBe(false);
  });
});

describe("書き込みは cookie の人に結びつく", () => {
  it("写真の持ち主は cookie の人（meta に別の人を書いても使わない）", async () => {
    const { mom, grandma } = await family();
    const meta = { ownerMemberId: mom.id, contentHash: hashOf(7), width: 10, height: 10, takenAt: null, latitude: null, longitude: null };
    const res = await postForm(t, "/api/photos", photoForm(meta, tinyJpeg(7)), grandma.cookie);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { photo: { ownerMemberId: string } }).photo.ownerMemberId).toBe(grandma.id);
  });

  it("語りの話者は cookie の人（meta に別の人を書いても使わない）", async () => {
    const { mom, grandma } = await family();
    const photo = await addPhoto(t, mom.cookie, 8);
    const form = new FormData();
    form.append(
      "meta",
      JSON.stringify({ kind: "text", speakerMemberId: mom.id, photoId: photo.id, entranceId: null, replyToId: null, text: "架空の語り" }),
    );
    const res = await postForm(t, "/api/narrations", form, grandma.cookie);
    expect(res.status).toBe(202);
    expect(((await res.json()) as { narration: { speakerMemberId: string } }).narration.speakerMemberId).toBe(grandma.id);
  });

  it("今日の入り口は cookie の人のもの（memberId のクエリは使わない）", async () => {
    const { mom, grandma } = await family();
    await addPhoto(t, mom.cookie, 9);
    const res = await get(`/api/entrances/today?memberId=${encodeURIComponent(mom.id)}`, grandma.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { entrance: { memberId: string } }).entrance.memberId).toBe(grandma.id);
    const momRes = await get("/api/entrances/today", mom.cookie);
    expect(((await momRes.json()) as { entrance: { memberId: string } }).entrance.memberId).toBe(mom.id);
  });
});
