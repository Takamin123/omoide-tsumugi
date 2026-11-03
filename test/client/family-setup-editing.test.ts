// 家族のこと（/family）で、ある人を直している間の描き方。useMemberEditor を「ばあばを開いている」に差し替えて描く
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

const editing = vi.hoisted(() => ({ id: "m-grandma" }));
vi.mock("../../src/client/lib/useMemberEditor", () => ({
  useMemberEditor: () => ({ editingId: editing.id, open: () => {}, close: () => {}, save: async () => ({}) }),
}));

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { FamilySetup } = await load("../../src/client/screens/FamilySetup");
const { words } = await load("../../src/client/words");

const grandma = { id: "m-grandma", role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "鹿児島", setUpByMemberId: "m-mother", hasLink: true };
const mother = { id: "m-mother", role: "family", relation: "母", calledAs: "おかあさん", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null, hasLink: true };
const view = { family: { id: "f", isDemo: true, clock: { date: "2026-11-03", slot: "morning" }, canAdvanceClock: true }, members: [grandma, mother], me: mother };

describe("家族のこと: 一人を直している間", () => {
  const html = renderToStaticMarkup(h(FamilySetup, { view, me: mother, reload: async () => {} })) as string;

  // 「家族を足す」の節は外さずに隠す（入れかけの内容を残す）。見えている部分だけで確かめる
  const visible = html.replace(/<section[^>]*hidden[^>]*>[\s\S]*?<\/section>/, "");

  it("「家族を足す」の節は hidden で隠す（外さない）", () => {
    expect(html).toMatch(new RegExp(`<section[^>]*hidden=""[^>]*><h2>${words.member.addTitle}</h2>`));
  });
  it("見えている入力欄は直している人の一つだけで、今の内容が入っている", () => {
    expect(visible.match(/<form/g)).toHaveLength(1);
    expect(html).toContain('value="ばあば"');
    expect(html).toContain('value="鹿児島"');
  });
  it("「家族を足す」は隠し、ほかの人の「直す」も出さない（「直す」は送るボタンの一つだけ）", () => {
    expect(visible).not.toContain(words.member.addTitle);
    expect(visible.match(new RegExp(`>${words.member.edit}</button>`, "g"))).toHaveLength(1);
    expect(html).toMatch(/<button type="submit"[^>]*>直す<\/button>/);
    expect(html).toContain(`>${words.home.cancel}</button>`);
  });
});

describe("家族のこと: 直している間のリンクのボタンと、自分を直すとき（0036）", () => {
  it("直している間は、どのカードにも「リンクを作る」「リンクを作り直す」を出さない", () => {
    editing.id = "m-grandma";
    const html = renderToStaticMarkup(h(FamilySetup, { view, me: mother, reload: async () => {} })) as string;
    expect(html).not.toContain(words.family.makeLink);
    expect(html).not.toContain(words.family.remakeLink);
  });
  it("ほかの人を直すときは「画面」の欄を出す", () => {
    editing.id = "m-grandma";
    const html = renderToStaticMarkup(h(FamilySetup, { view, me: mother, reload: async () => {} })) as string;
    const visible = html.replace(/<section[^>]*hidden[^>]*>[\s\S]*?<\/section>/, "");
    expect(visible).toContain(`<legend>${words.member.role}</legend>`);
  });
  it("自分を直すときは「画面」の欄を出さない（自分の画面は自分で直せない）。ほかの欄は出す", () => {
    editing.id = "m-mother";
    const html = renderToStaticMarkup(h(FamilySetup, { view, me: mother, reload: async () => {} })) as string;
    const visible = html.replace(/<section[^>]*hidden[^>]*>[\s\S]*?<\/section>/, "");
    expect(visible.match(/<form/g)).toHaveLength(1);
    expect(visible).toContain('value="おかあさん"');
    expect(visible).not.toContain(`<legend>${words.member.role}</legend>`);
    expect(visible).not.toContain('name="role"');
    expect(visible).toContain(`<legend>${words.member.speech}</legend>`);
  });
});
