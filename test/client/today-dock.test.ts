// 今日のタブの「声で」「文字で」を、スクロールする欄の外（タブのすぐ上の段）に置く（0034）。ボタンは一つのまま、置き場所だけを移す。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { answerPlace } = await load("../../src/client/lib/pure");

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("answerPlace: 今日の答えのボタンを置く所", () => {
  it("答える前は下の段", () => {
    expect(answerPlace(true, false, false)).toBe("dock");
  });
  it("答えた後は問いかけの下の流れに戻す（下には留めない。もう一度答えられる）", () => {
    expect(answerPlace(true, true, false)).toBe("flow");
    expect(answerPlace(true, true, true)).toBe("flow");
  });
  it("ほかの入力欄（語りへの返事）が開いている間は描かない。入り口がなければ置かない", () => {
    expect(answerPlace(true, false, true)).toBe("none");
    expect(answerPlace(false, false, false)).toBe("none");
  });
});

describe("Home の組み立て", () => {
  const home = code("src/client/screens/Home.tsx");
  it("段はスクロールする欄とタブの間に置く（欄の中を隠さない）", () => {
    expect(home).toMatch(/\{body\}\s*\{dock\}\s*<TabBar/);
    expect(home).toContain('<div className="home-dock">');
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\.home-dock \{[^}]*flex: none;/);
    expect(css).not.toMatch(/\.answer\.sticky/);
  });
  it("段の中の自分の入力の間は段を残し、ほかの入力欄（返事はボタンを選ぶ前から）の間は描かない", () => {
    expect(home).toContain("answerPlace(!!entrance, answered, !dockComposing && (composing || openReplyId !== null))");
    expect(home).toContain("onComposing={setDockComposing}");
  });
  it("今日の入り口の答えの ReplyBox は、段か流れのどちらか一つだけ（ボタンを複製しない）", () => {
    expect(home).toMatch(/place === "dock" && answerTarget/);
    expect(home).toMatch(/place === "flow" && answerTarget/);
    expect(home.match(/<ReplyBox target=\{answerTarget\}/g)).toHaveLength(2);
  });
  it("段を閉じた後の「送りました」は問いかけの下に出す", () => {
    expect(home).toMatch(/<div aria-live="polite"(?: ref=\{noticeRef\})?>\s*\{showAnswerNotice && <p className="done">\{w\.sent\}<\/p>\}/);
  });
  it("アルバムと語りへの返事には段を置かない（祖父母の画面は Home と同じ段を使う。0043）", () => {
    for (const f of ["src/client/parts/Album.tsx", "src/client/parts/Narrations.tsx"]) {
      expect(read(f)).not.toContain("home-dock");
    }
  });
  it("段に見出しや案内、placeholder を足さない", () => {
    expect(read("src/client/parts/ReplyBox.tsx")).not.toContain("placeholder");
  });
});
