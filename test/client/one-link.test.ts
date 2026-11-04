// 一人ずつのリンク（0036）の画面: 端末の人はサーバーの view.me。「あなたはどなたですか」と「ほかの人にかわる」はない。
// react-dom/server で文字列にして確かめる（DOM なし）。架空の家族だけを使う。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

// 作ったばかりのリンクは useMemberLinks が持つ。ここでは「ばあばのリンクを作った後」に差し替えて描く
const linkState = vi.hoisted(() => ({ links: {} as Record<string, string>, error: null as null | { memberId: string; text: string } }));
vi.mock("../../src/client/lib/useMemberLinks", () => ({
  useMemberLinks: () => ({ links: linkState.links, error: linkState.error, busy: false, make: async () => {} }),
}));

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { FamilySetup } = await load("../../src/client/screens/FamilySetup");
const { FirstPerson } = await load("../../src/client/screens/FirstPerson");
const { Elder } = await load("../../src/client/screens/Elder");
const { Start } = await load("../../src/client/screens/Start");
const { screenFor } = await load("../../src/client/lib/pure");
const { joinErrorText } = await load("../../src/client/lib/errors");
const { ApiError } = await load("../../src/client/lib/api");
const { words } = await load("../../src/client/words");

const grandma = { id: "m-grandma", role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "鹿児島", setUpByMemberId: "m-mother", hasLink: false };
const grandpa = { id: "m-grandpa", role: "elder", relation: "祖父", calledAs: "じいじ", speechStyle: "standard", dialectRegion: null, setUpByMemberId: "m-mother", hasLink: true };
const mother = { id: "m-mother", role: "family", relation: "母", calledAs: "おかあさん", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null, hasLink: true };
const family = { id: "f", isDemo: true, clock: { date: "2026-11-03", slot: "morning" }, canAdvanceClock: false };
const view = { family, members: [grandma, grandpa, mother], me: mother };

const ORIGIN = "https://omoide.example";
beforeAll(() => vi.stubGlobal("location", { origin: ORIGIN }));
afterAll(() => vi.unstubAllGlobals());

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;
const clientDir = path.join(repoRoot, "src/client");
function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
/** 家族に見せる画面のソース（開発用の check/ と運営の ops/ を除く） */
const familySources = () =>
  listFiles(clientDir).filter((f) => !f.startsWith(path.join(clientDir, "check")) && !f.startsWith(path.join(clientDir, "ops")));

describe("出す画面は端末の人（view.me）で決まる", () => {
  it("me がなく、家族に誰もいない: 最初の人の欄。誰かいる: リンクを開きなおしてもらう", () => {
    expect(screenFor(null, 0, "/")).toBe("first-person");
    expect(screenFor(null, 0, "/family")).toBe("first-person");
    expect(screenFor(null, 1, "/")).toBe("no-session");
  });
  it("祖父母の画面の人は、どの道でも祖父母の画面（/family、/photos を出さない）", () => {
    for (const p of ["/", "/family", "/photos", "/nowhere"]) expect(screenFor({ role: "elder" }, 3, p)).toBe("elder");
  });
  it("家族の画面の人は、道で分ける", () => {
    expect(screenFor({ role: "family" }, 3, "/")).toBe("home");
    expect(screenFor({ role: "family" }, 3, "/family")).toBe("family-setup");
    expect(screenFor({ role: "family" }, 3, "/photos")).toBe("photos");
  });
  it("App は端末に人を覚えない（localStorage の omoide.me と lib/me.ts はない）", () => {
    expect(fs.existsSync(path.join(clientDir, "lib/me.ts"))).toBe(false);
    expect(fs.existsSync(path.join(clientDir, "screens/WhoAreYou.tsx"))).toBe(false);
    for (const f of familySources()) expect(fs.readFileSync(f, "utf8")).not.toContain("omoide.me");
    expect(read("src/client/App.tsx")).toContain("view.me");
  });
});

describe("最初の人の欄", () => {
  const html = renderToStaticMarkup(h(FirstPerson, { onDone: () => {} })) as string;
  it("見出しは「まず、あなたのことを入れてください」", () => {
    expect(html).toContain(`<h1>${words.firstPerson.title}</h1>`);
    expect(words.firstPerson.title).toBe("まず、あなたのことを入れてください");
  });
  it("「画面」の欄は出さない（最初の人は家族の画面に決まっている）。ほかの欄は出す", () => {
    expect(html).not.toContain(`<legend>${words.member.role}</legend>`);
    expect(html).not.toContain('name="role"');
    expect(html).toContain(words.member.calledAs);
    expect(html).toContain(`<legend>${words.member.speech}</legend>`);
    expect(html).toMatch(/<button type="submit"[^>]*>足す<\/button>/);
  });
  it("選ぶ並び（あなたはどなたですか、この中にいません）はない", () => {
    expect(html).not.toContain("あなたはどなたですか");
    expect(html).not.toContain("この中にいません");
  });
});

describe("「ほかの人にかわる」はどこにもない", () => {
  it("家族に見せる画面のソースに「ほかの人にかわる」「あなたはどなたですか」がなく、words にも切り替えの言葉がない", () => {
    for (const f of familySources()) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toContain("ほかの人にかわる");
      expect(src, f).not.toContain("あなたはどなたですか");
      expect(src, f).not.toMatch(/switchUser|onSwitch/);
    }
    expect(words.home).not.toHaveProperty("switchUser");
    expect(words).not.toHaveProperty("who");
    expect(words.family).not.toHaveProperty("invite");
    expect(words.family).not.toHaveProperty("regenerate");
    expect(words.family).not.toHaveProperty("regenerateNote");
  });
  it("祖父母の画面: 祖父母が二人いても話者の並びを出さない。呼ばれ方は出す", () => {
    const html = renderToStaticMarkup(h(Elder, { view: { ...view, me: grandma }, me: grandma, demo: null })) as string;
    expect(html).toContain(`<p class="elder-name">${grandma.calledAs}</p>`);
    expect(html).not.toContain(grandpa.calledAs);
    expect(html).not.toContain("speakers");
    expect(html).not.toContain("aria-pressed=\"true\"");
  });
});

describe("家族のこと: 一人ひとりのリンク", () => {
  const render = () => renderToStaticMarkup(h(FamilySetup, { view, me: mother, reload: async () => {} })) as string;

  it("一人ひとりのカードに、リンクがなければ「リンクを作る」、あれば「リンクを作り直す」。自分のカードにも出す", () => {
    linkState.links = {};
    const html = render();
    expect(words.family.makeLink).toBe("リンクを作る");
    expect(words.family.remakeLink).toBe("リンクを作り直す");
    expect(html.match(new RegExp(`>${words.family.makeLink}</button>`, "g"))).toHaveLength(1); // ばあば
    expect(html.match(new RegExp(`>${words.family.remakeLink}</button>`, "g"))).toHaveLength(2); // じいじと自分
    // 「直す」と同じ列（補助の大きさ）
    expect(html).toContain(
      `<div class="row card-actions"><button type="button" class="aux">${words.family.makeLink}</button><button type="button" class="aux">${words.member.edit}</button></div>`,
    );
  });
  it("家族全体の「家族に送るリンク」の節と「作り直す」はない。「家族の番号」はある", () => {
    linkState.links = {};
    const html = render();
    expect(html).not.toContain("家族に送るリンク");
    expect(html).not.toMatch(/>作り直す<\/button>/);
    expect(html).toContain(words.family.familyIdLabel);
    expect(html).not.toContain(words.family.inviteHidden); // 作る前は出さない
  });
  it("作ったら、そのカードの中に「{呼ばれ方}に送るリンク」、URL と「コピー」、「リンクは作ったときにだけ出ます」", () => {
    const token = "tok-".padEnd(43, "b");
    linkState.links = { "m-grandma": token };
    const html = render();
    const card = html.slice(html.indexOf(words.member.summary("ばあば", "祖母")), html.indexOf(words.member.summary("じいじ", "祖父")));
    expect(card).toContain(`<p>${words.family.linkFor("ばあば")}</p>`);
    expect(words.family.linkFor("ばあば")).toBe("ばあばに送るリンク");
    expect(card).toContain(`<p class="invite-url">${ORIGIN}/join/${token}</p>`);
    expect(card).toContain(`>${words.family.copy}</button>`);
    expect(card).toContain(`<p class="sub">${words.family.inviteHidden}</p>`);
    // ほかのカードには出さない
    expect(html.match(/class="invite-url"/g)).toHaveLength(1);
  });
  it("作れなかったら、その人のカードに文を出す", () => {
    linkState.links = {};
    linkState.error = { memberId: "m-grandpa", text: words.errors.internal };
    const html = render();
    const card = html.slice(html.indexOf(words.member.summary("じいじ", "祖父")), html.indexOf(words.member.summary("おかあさん", "母")));
    expect(card).toContain(words.errors.internal);
    linkState.error = null;
  });
  it("自分のカードの「直す」では「画面」の欄を出さない（FamilySetup が自分のときだけ fixedRole を渡す）", () => {
    expect(read("src/client/screens/FamilySetup.tsx")).toContain("fixedRole={m.id === me.id ? m.role : undefined}");
  });
});

describe("/start と /join", () => {
  it("/start: 作った後の見出しは「最初の人に送るリンク」", () => {
    expect(words.start.firstLink).toBe("最初の人に送るリンク");
    expect(read("src/client/screens/Start.tsx")).toContain("<h1>{words.start.firstLink}</h1>");
    // 作る前の画面
    const html = renderToStaticMarkup(h(Start, { onCreated: () => {} })) as string;
    expect(html).toContain(`<h1>${words.start.title}</h1>`);
  });
  it("/join: 使えないリンクは「このリンクは使えません。家族に知らせてください」。つながらないなどは、ほかと同じ文", () => {
    expect(words.join.invalid).toBe("このリンクは使えません。家族に知らせてください");
    expect(joinErrorText(new ApiError("unauthorized", 401))).toBe(words.join.invalid);
    expect(joinErrorText(new ApiError("invalid_request", 400))).toBe(words.join.invalid);
    expect(joinErrorText(new ApiError("internal", 500))).toBe(words.errors.internal);
    expect(joinErrorText(new Error("x"))).toBe(words.errors.internal);
  });
  it("/join は人を選ばせない（Join に人の一覧や確かめはない）", () => {
    const src = read("src/client/screens/Join.tsx");
    expect(src).not.toMatch(/members|confirm\(/);
  });
});

describe("人の ID を送らない（サーバーが端末の人に決める）", () => {
  it("語りの送る先（VoiceTarget）に話した人がない。画面のどこでも speakerMemberId を組み立てない", () => {
    expect(read("src/client/lib/voice.ts")).not.toMatch(/speakerMemberId/);
    for (const f of familySources()) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/speakerMemberId\s*:/);
  });
  it("写真の meta に持ち主を入れない", () => {
    expect(read("src/client/lib/photos.ts")).not.toMatch(/ownerMemberId/);
    expect(read("src/client/lib/upload.ts")).not.toMatch(/ownerMemberId/);
    // 写真を共有する画面が自分の ID を使うのは、共有した写真の一覧を読むときだけ（0053）。送るときには渡さない
    const addPhotos = read("src/client/screens/AddPhotos.tsx");
    expect(addPhotos).not.toMatch(/ownerMemberId/);
    expect(addPhotos).toMatch(/uploadOne\(file, undefined\)/);
    expect(addPhotos.match(/me\.id/g)).toEqual(["me.id"]);
    expect(addPhotos).toContain("useMyPhotos(me.id)");
  });
  it("今日の入り口は人を指定せずに読む", () => {
    expect(read("src/client/lib/api.ts")).toContain('"/api/entrances/today"');
    expect(read("src/client/lib/api.ts")).not.toMatch(/entrances\/today\?/);
  });
});
