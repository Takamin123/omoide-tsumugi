// 審査員の案内から作った家族（0062 の 2026-11-07 の追記）の守りの穴を、別の目で確かめる。架空の値だけを使う。
// 実装側の test/demo-guide.test.ts にない組み合わせ: 審査員の家族どうし、ほかの鍵の入り口、印を画面に返さないこと、語りの日付。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_GUIDE_FAMILY_NAME } from "../src/server/routes/demo";
import { SEED_MEMBERS } from "../src/server/demo/seed";
import { addMember, addPhoto, createFamily, defaultMember, inviteCookieFrom, makeTestApp, startD1, type TestApp } from "./helpers";

const KEY = "k".repeat(40);

let d1: D1Database;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  t = makeTestApp(d1);
  const links = Object.fromEntries(SEED_MEMBERS.map((m) => [m.calledAs, "t".repeat(30)]));
  (t.deps.config as { demoGuideKey: string | null }).demoGuideKey = KEY;
  (t.deps.config as { demoGuideLinks: string | null }).demoGuideLinks = JSON.stringify(links);
}, 60_000);
afterAll(() => dispose());

const json = { "Content-Type": "application/json" };
const send = (method: string, path: string, cookie: string, body?: unknown) =>
  t.app.request(path, { method, headers: { Cookie: cookie, ...json }, body: body === undefined ? undefined : JSON.stringify(body) });
const judgeFamilies = async () =>
  (await d1.prepare("SELECT count(*) AS n FROM families WHERE name = ?").bind(DEMO_GUIDE_FAMILY_NAME).first<{ n: number }>())!.n;

/** 案内から家族を作り、最初の人を入れる */
async function judgeFamily(calledAs: string) {
  const res = await t.app.request("/api/demo/guide/families", { method: "POST", headers: json, body: JSON.stringify({ key: KEY }) });
  expect(res.status).toBe(204);
  const first = await send("POST", "/api/members", inviteCookieFrom(res)!, { ...defaultMember, calledAs });
  expect(first.status).toBe(201);
  return { me: (await first.json()) as { id: string }, cookie: inviteCookieFrom(first)! };
}

describe("審査員の家族どうし", () => {
  it("甲の cookie で乙の人・写真は触れない（404）", async () => {
    const a = await judgeFamily("架空のこうさん");
    const b = await judgeFamily("架空のおつさん");
    const photo = await addPhoto(t, b.cookie, 91);
    expect((await send("PATCH", `/api/members/${b.me.id}`, a.cookie, { ...defaultMember, calledAs: "架空のおつさん改" })).status).toBe(404);
    expect((await send("POST", `/api/members/${b.me.id}/link`, a.cookie)).status).toBe(404);
    expect((await send("GET", `/api/photos/${photo.id}/image`, a.cookie)).status).toBe(404);
    expect((await (await send("GET", `/api/family`, a.cookie)).json()) as { members: unknown[] }).toMatchObject({ members: [{ calledAs: "架空のこうさん" }] });
  });

  it("最初の人を入れた後、作ったときの cookie はもう使えない", async () => {
    const res = await t.app.request("/api/demo/guide/families", { method: "POST", headers: json, body: JSON.stringify({ key: KEY }) });
    const firstLink = inviteCookieFrom(res)!;
    await send("POST", "/api/members", firstLink, { ...defaultMember, calledAs: "架空のひと" });
    expect((await send("GET", "/api/family", firstLink)).status).toBe(401);
  });

  it("印（families.name）を家族の画面に返さない", async () => {
    const a = await judgeFamily("架空のいんさん");
    expect(await (await send("GET", "/api/family", a.cookie)).text()).not.toContain(DEMO_GUIDE_FAMILY_NAME);
  });
});

describe("案内の鍵で、ほかの入り口は開かない", () => {
  it("初期化と運営の記録は 401。審査員の家族の cookie でも同じ", async () => {
    const a = await judgeFamily("架空のかぎさん");
    const familyId = ((await (await send("GET", "/api/family", a.cookie)).json()) as { family: { id: string } }).family.id;
    const bearer = { Authorization: `Bearer ${KEY}`, ...json };
    for (const headers of [bearer, { Cookie: a.cookie, ...json }]) {
      expect((await t.app.request(`/api/demo/families/${familyId}/reset`, { method: "POST", headers })).status).toBe(401);
      expect((await t.app.request(`/api/ops/families/${familyId}/record`, { headers })).status).toBe(401);
    }
  });

  it.each([
    ["検索語の鍵", `/api/demo/guide/families?key=${KEY}`, {}, {}],
    ["Bearer の鍵", "/api/demo/guide/families", { Authorization: `Bearer ${KEY}` }, {}],
    ["大文字の道で誤った鍵", "/API/DEMO/GUIDE/FAMILIES", {}, { key: "x".repeat(40) }],
  ])("%s では作らない", async (_name, path, headers, body) => {
    const before = await judgeFamilies();
    const res = await t.app.request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });
    expect(res.status).toBe(404);
    expect(inviteCookieFrom(res)).toBeNull();
    expect(await judgeFamilies()).toBe(before);
  });

  it("印のない実際の家族は、鍵があっても守りの対象にならない", async () => {
    const real = await createFamily(t, false);
    const first = await addMember(t, real.cookie, { calledAs: "架空のじっさい" });
    const added = await send("POST", "/api/members", first.cookie, { ...defaultMember, calledAs: "架空のじっさい二" });
    expect(added.status).toBe(201);
  });
});

describe("次の日へ（時計の日付と語り）", () => {
  it("祖父母の画面の人も押せる。日付は一日ずつ、語りの日は時計の日。from が古ければ動かない", async () => {
    const a = await judgeFamily("架空のかあさん");
    const elder = await addMember(t, a.cookie, { ...defaultMember, role: "elder", calledAs: "架空のそぼ" });
    const familyOf = async () => ((await (await send("GET", "/api/family", a.cookie)).json()) as { family: { clock: { date: string; slot: string } } }).family.clock;
    const start = await familyOf();
    expect(start.slot).toBe("morning");

    const first = (await (await send("POST", "/api/demo/clock/advance", elder.cookie, { from: start.date })).json()) as { clock: { date: string; slot: string } };
    expect(first.clock.slot).toBe("morning");
    expect(first.clock.date > start.date).toBe(true);

    // 同じ from の二度目は何もしない
    expect(((await (await send("POST", "/api/demo/clock/advance", a.cookie, { from: start.date })).json()) as { clock: unknown }).clock).toEqual(first.clock);
    expect(await familyOf()).toEqual(first.clock);

    // 語りの日は、進めた時計の日
    const photo = await addPhoto(t, a.cookie, 92);
    const form = new FormData();
    form.append("meta", JSON.stringify({ kind: "text", photoId: photo.id, entranceId: null, replyToId: null, text: "架空の語り" }));
    const req = new Request("http://localhost/api/narrations", { method: "POST", body: form });
    const body = await req.arrayBuffer();
    const said = await t.app.request("/api/narrations", {
      method: "POST",
      body,
      headers: { Cookie: a.cookie, "Content-Type": req.headers.get("content-type")!, "Content-Length": String(body.byteLength) },
    });
    expect(said.status).toBe(202);
    const row = await d1.prepare("SELECT for_date FROM narrations WHERE photo_id = ?").bind(photo.id).first<{ for_date: string }>();
    expect(row!.for_date).toBe(first.clock.date);
  });
});
