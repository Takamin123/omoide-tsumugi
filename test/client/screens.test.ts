// 部品の描き方（react-dom/server で文字列にして確かめる。DOM なし）と、ソースの決まりごとの確かめ。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { EntranceView } = await load("../../src/client/parts/EntranceView");
const { DemoBar } = await load("../../src/client/parts/DemoBar");
const { words } = await load("../../src/client/words");

const members = [
  { id: "m-grandma", calledAs: "ばあば", relation: "祖母", role: "elder" },
  { id: "m-mother", calledAs: "おかあさん", relation: "母", role: "family" },
];
const photo = { id: "p-1", ownerMemberId: "m-grandma", width: 1600, height: 1200, takenAt: null, hasLocation: false, imageUrl: "/api/photos/p-1/image" };
const entrance = (over: Record<string, unknown>) => ({ id: "e-1", photo, quote: null, question: null, focus: null, ...over });

describe("入り口の表示", () => {
  it("問いかけが null なら固定の一文を出す", () => {
    const html = renderToStaticMarkup(h(EntranceView, { entrance: entrance({}), members }));
    expect(words.fixedQuestion).toBe("この写真のころのこと、聞かせてください");
    expect(html).toContain(words.fixedQuestion);
  });
  it("問いかけがあればそれだけを出し、固定の一文は出さない", () => {
    const html = renderToStaticMarkup(h(EntranceView, { entrance: entrance({ question: "この浜には誰と行きましたか" }), members }));
    expect(html).toContain("この浜には誰と行きましたか");
    expect(html).not.toContain(words.fixedQuestion);
  });
  it("添える家族の言葉は、話者の呼ばれ方つき", () => {
    const html = renderToStaticMarkup(
      h(EntranceView, { entrance: entrance({ quote: { narrationId: "n-1", speakerMemberId: "m-grandma", text: "あん頃は、よう海に行ったもんじゃ" } }), members }),
    );
    expect(html).toContain("あん頃は、よう海に行ったもんじゃ");
    expect(html).toContain("ばあば");
  });
});

describe("デモの帯", () => {
  const clock = { date: "2026-11-02", slot: "morning" };
  it("録音済みファイルの入口は onAudioFile を渡したときだけ", () => {
    const without = renderToStaticMarkup(h(DemoBar, { clock, onAdvanced: () => {} }));
    expect(without).toContain(words.demo.advance);
    expect(without).not.toContain(words.demo.sendFile);
    const withFile = renderToStaticMarkup(h(DemoBar, { clock, onAdvanced: () => {}, onAudioFile: () => {} }));
    expect(withFile).toContain(words.demo.sendFile);
    expect(withFile).toContain('accept="audio/*"');
    expect(withFile).not.toMatch(/<input[^>]*disabled/);
  });
  it("送っている間は、録音済みファイルを選べない", () => {
    const html = renderToStaticMarkup(h(DemoBar, { clock, onAdvanced: () => {}, onAudioFile: () => {}, audioDisabled: true }));
    expect(html).toMatch(/<input[^>]*type="file"[^>]*disabled=""|<input[^>]*disabled=""[^>]*type="file"/);
  });
  it("祖父母の画面は、送っている間 audioDisabled を立てる", () => {
    expect(stripComments(read("src/client/screens/Elder.tsx"))).toContain('audioDisabled={sender.state === "sending"}');
  });
});

// ---- ソースの決まりごと ----
const clientDir = path.join(repoRoot, "src/client");
function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
/** コメントを取り除く（文字列の中の // は考えない程度の簡単なもの。URL は "//" を含まない前提） */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;

/** 開発用の確かめページ（/check）。家族に見せないので、言葉をこの中に置いてよい */
const checkDir = path.join(clientDir, "check");

describe("家族に見せる日本語は words.ts にだけある", () => {
  it("words.ts 以外の src/client に、コメント以外の日本語がない（開発用の check/ を除く）", () => {
    const jp = /[぀-ヿ㐀-鿿！-｠]/;
    const offenders: string[] = [];
    for (const file of listFiles(clientDir)) {
      if (file.endsWith(`${path.sep}words.ts`)) continue;
      if (file.startsWith(`${checkDir}${path.sep}`)) continue;
      stripComments(fs.readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line: string, i: number) => {
          if (jp.test(line)) offenders.push(`${path.relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("check/ のファイルは、先頭で開発用と断っている。家族の画面からは読み込まない（App の lazy だけ）", () => {
    const files = listFiles(checkDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.readFileSync(f, "utf8").split("\n")[0]).toMatch(/開発用/);
    const importers = listFiles(clientDir).filter(
      (f) => !f.startsWith(`${checkDir}${path.sep}`) && /["']\.{1,2}\/(?:\.\.\/)*check\//.test(fs.readFileSync(f, "utf8")),
    );
    expect(importers.map((f) => path.relative(repoRoot, f))).toEqual(["src/client/App.tsx"]);
    expect(read("src/client/App.tsx")).toMatch(/lazy\(\(\) => import\("\.\/check\/CheckPage"\)\)/);
  });
});

describe("デモの帯は canAdvanceClock が真のときだけ", () => {
  it("App は canAdvanceClock === true のときだけ demo を作る", () => {
    const app = stripComments(read("src/client/App.tsx"));
    expect(app).toMatch(/view\.family\.canAdvanceClock === true\s*\?/);
  });
  it("DemoBar を描く所は、すべて demo があるときだけ", () => {
    const uses: string[] = [];
    for (const file of listFiles(clientDir)) {
      if (file.endsWith(`DemoBar.tsx`)) continue;
      const src = stripComments(fs.readFileSync(file, "utf8"));
      // 「demo && (」と「<DemoBar」の間に、ほかの要素が一つ挟まる程度までを許す
      for (const m of src.matchAll(/<DemoBar\b/g)) uses.push(src.slice(Math.max(0, m.index! - 80), m.index! + 20));
    }
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/demo &&\s*(\(\s*<div[^>]*>\s*)?<DemoBar \{\.\.\.demo\}/);
  });
  it("祖父母の画面: 録音済みファイルは、マイクと同じ sender.sendVoice に入る", () => {
    const elder = stripComments(read("src/client/screens/Elder.tsx"));
    expect(elder).toContain("onAudioFile={sender.sendVoice}");
    expect(elder).toContain("onBlob={sender.sendVoice}");
  });
  it("語りの送信は voice.ts の外から api.sendNarration を呼ばない（流れは一つ）", () => {
    const callers = listFiles(clientDir).filter(
      (f) => !f.endsWith(`${path.sep}voice.ts`) && !f.endsWith(`${path.sep}api.ts`) && fs.readFileSync(f, "utf8").includes("sendNarration"),
    );
    expect(callers).toEqual([]);
  });
});

describe("位置の生の値を外に出さない", () => {
  it("exifr を使うのは photos.ts だけで、gps の値は roundLocation を通る", () => {
    const users = listFiles(clientDir).filter((f) => /from "exifr"/.test(fs.readFileSync(f, "utf8")));
    expect(users.map((f) => path.basename(f))).toEqual(["photos.ts"]);
    const src = stripComments(read("src/client/lib/photos.ts"));
    expect(src).toMatch(/roundLocation\(gps\?\.latitude, gps\?\.longitude\)/);
  });
});

describe("高齢の人の画面の最低ライン（styles.css の :root）", () => {
  const css = read("src/client/styles.css");
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const rem = (name: string): number => {
    const m = new RegExp(`--${name}:\\s*([\\d.]+)rem`).exec(root);
    if (!m) throw new Error(`--${name} が rem で定義されていない`);
    return Number(m[1]) * 16;
  };
  it.each([
    ["font-main", 20],
    ["font-sub", 16],
    ["tap-min", 48],
    ["tap-gap", 8],
    ["primary-height", 64],
  ])("--%s は %ipx 以上", (name, min) => {
    expect(rem(name as string)).toBeGreaterThanOrEqual(min as number);
  });
  it("行間は 1.5 以上", () => {
    expect(Number(/--line-height:\s*([\d.]+)/.exec(root)?.[1])).toBeGreaterThanOrEqual(1.5);
  });
  it("文字の大きさは :root の外で px 指定しない（ブラウザの設定を妨げない）", () => {
    expect(css).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };
  const color = (name: string) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root);
    if (!m) throw new Error(`--${name} がない`);
    return m[1]!;
  };
  it.each([
    ["text", "bg", 4.5],
    ["text", "surface", 4.5],
    ["text-sub", "bg", 4.5],
    ["text-sub", "surface", 4.5],
    ["accent-text", "accent", 4.5],
    ["accent-text", "recording", 4.5],
    ["border", "bg", 3],
    ["border", "surface", 3],
  ])("コントラスト: --%s と --%s は %s:1 以上", (fg, bg, min) => {
    expect(ratio(color(fg as string), color(bg as string))).toBeGreaterThanOrEqual(min as number);
  });
});
