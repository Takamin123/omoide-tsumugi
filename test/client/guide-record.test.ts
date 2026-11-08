// 審査員が見る Claude の記録（/demo/<鍵>/record。0062 の追記）。運営の記録の画面を、案内の鍵で、台本の家族だけ・読み取りだけで開く。
// 運営の鍵の欄・鍵を消す操作・家族の ID の欄を出さないこと、運営の鍵（sessionStorage）に触れないこと、鍵をどこにも保存しないことを確かめる。
// react-dom/server で文字列にして確かめる（DOM なし。最初の描画は読み込み中）
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { default: RecordPage } = await load("../../src/client/ops/RecordPage");
const { guideWords } = await load("../../src/client/demo/guideWords");

const KEY = "a1".repeat(16);
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;

beforeAll(() => vi.stubGlobal("location", { search: "?family=other&view=photo", hash: "" }));
afterAll(() => vi.unstubAllGlobals());

describe("審査員の道の記録の画面", () => {
  it("運営の鍵の欄・鍵を消す操作・家族の ID の欄を出さず、審査員向けの文と案内に戻るリンクを出す", () => {
    const html = renderToStaticMarkup(h(RecordPage, { guideKey: KEY })) as string;
    expect(html).not.toContain("運営の鍵");
    expect(html).not.toContain("鍵を消す");
    expect(html).not.toContain("家族の ID");
    expect(html).not.toMatch(/<input/);
    expect(html).not.toMatch(/<form/);
    expect(html).toContain(guideWords.recordLead);
    expect(html).toContain(guideWords.recordScope);
    expect(html).toContain(`href="/demo/${KEY}"`);
    expect(html).toContain(guideWords.recordBack);
    expect(html).not.toContain("/ops/record");
  });

  it("運営の道（鍵なし）は今までどおり運営の鍵の欄を出す", () => {
    const html = renderToStaticMarkup(h(RecordPage, {})) as string;
    expect(html).toContain("運営の鍵");
    expect(html).not.toContain(guideWords.recordLead);
  });

  it("審査員の道のソースは、案内の鍵を保存しない（sessionStorage・localStorage に触れない）", () => {
    const src = read("src/client/ops/RecordPage.tsx");
    const guide = src.slice(src.indexOf("function GuideRecordPage"), src.indexOf("function OpsRecordPage"));
    expect(guide.length).toBeGreaterThan(0);
    expect(guide).not.toMatch(/sessionStorage|localStorage|saveOpsKey|loadOpsKey/);
    expect(guide).toContain("fetchGuideRecord(guideKey)");
    expect(guide).toContain("useGuideHead()");
  });

  it("案内ページに記録へのボタンと一行があり、注意に記録の画面の一文がある", () => {
    const src = read("src/client/demo/GuidePage.tsx");
    expect(src).toContain("href={`/demo/${guideKey}/record`}");
    expect(src).toContain("g.recordOpen");
    expect(src).toContain("g.recordOpenNote");
    expect(guideWords.recordOpen).toBe("Claude の記録を見る");
    expect(guideWords.notes.some((n: string) => n.includes("Claude の記録の画面にも、そのまま出ます。"))).toBe(true);
  });
});
