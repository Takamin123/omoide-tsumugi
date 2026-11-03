// 部品の描き方（react-dom/server で文字列にして確かめる。DOM なし）と、ソースの決まりごとの確かめ。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { EntranceView } = await load("../../src/client/parts/EntranceView");
const { DemoBar } = await load("../../src/client/parts/DemoBar");
const { MemberForm } = await load("../../src/client/parts/MemberForm");
const { FamilySetup } = await load("../../src/client/screens/FamilySetup");
const { words } = await load("../../src/client/words");
const { AUDIO_FILE_ACCEPT } = await load("../../src/client/lib/voice");

const members = [
  { id: "m-grandma", calledAs: "ばあば", relation: "祖母", role: "elder" },
  { id: "m-mother", calledAs: "おかあさん", relation: "母", role: "family" },
];
const photo = { id: "p-1", ownerMemberId: "m-grandma", width: 1600, height: 1200, takenAt: null, hasLocation: false, imageUrl: "/api/photos/p-1/image" };
const entrance = (over: Record<string, unknown>) => ({ id: "e-1", photo, quote: null, question: null, focus: null, ...over });

describe("入り口の表示", () => {
  it("問いかけが null なら固定の一文を出す", () => {
    const html = renderToStaticMarkup(h(EntranceView, { entrance: entrance({}), members, variant: "elder" }));
    expect(words.fixedQuestion).toBe("この写真のころのこと、聞かせてください");
    expect(html).toContain(words.fixedQuestion);
  });
  it("問いかけがあればそれだけを出し、固定の一文は出さない", () => {
    const html = renderToStaticMarkup(h(EntranceView, { entrance: entrance({ question: "この浜には誰と行きましたか" }), members, variant: "family" }));
    expect(html).toContain("この浜には誰と行きましたか");
    expect(html).not.toContain(words.fixedQuestion);
  });
  it("添える家族の言葉は、話者の呼ばれ方つき", () => {
    const html = renderToStaticMarkup(
      h(EntranceView, { entrance: entrance({ quote: { narrationId: "n-1", speakerMemberId: "m-grandma", text: "あん頃は、よう海に行ったもんじゃ" } }), members, variant: "family" }),
    );
    expect(html).toContain("あん頃は、よう海に行ったもんじゃ");
    expect(html).toContain("ばあば");
  });
});

describe("添える家族の言葉の声と、問いかけの読み上げ", () => {
  const voiceQuote = (durationMs: number | null) => ({
    narrationId: "n-1",
    speakerMemberId: "m-mother",
    text: "この浜には毎年行っていました",
    audioUrl: "/api/narrations/n-1/audio",
    durationMs,
  });
  const render = (over: Record<string, unknown>, variant: "elder" | "family") =>
    renderToStaticMarkup(h(EntranceView, { entrance: entrance(over), members, variant })) as string;

  it("文字の語りの引用には、聞くボタンを出さない", () => {
    const html = render({ quote: { ...voiceQuote(null), audioUrl: null } }, "family");
    expect(html).not.toContain("<button");
  });
  it("家族の画面: 「{呼ばれ方}の声で聞く（13秒）」。長さが分からなければ秒を出さない", () => {
    expect(render({ quote: voiceQuote(13_400) }, "family")).toContain("おかあさんの声で聞く（13秒）");
    const unknown = render({ quote: voiceQuote(null) }, "family");
    expect(unknown).toContain("おかあさんの声で聞く");
    expect(unknown).not.toContain("秒");
    expect(render({ quote: voiceQuote(80_000) }, "family")).toContain("（1分20秒）");
  });
  it("祖父母の画面: ボタンは「こえを きく」、誰の声かと長さはそばの補助の文", () => {
    const html = render({ quote: voiceQuote(13_400) }, "elder");
    expect(html).toMatch(/<button[^>]*>.*こえを きく<\/button>/);
    expect(html).toContain("おかあさんの声（13秒）");
  });
  it("読み上げは questionAudioUrl があるときだけ、祖父母の画面だけ。そばに「AI の声で読みます」", () => {
    for (const over of [{}, { questionAudioUrl: null }]) {
      const html = render({ question: "q", ...over }, "elder");
      expect(html).not.toContain(words.elder.readAloud);
      expect(html).not.toContain(words.elder.readAloudNote);
    }
    const html = render({ question: "q", questionAudioUrl: "/api/x" }, "elder");
    expect(html).toContain(words.elder.readAloud);
    expect(words.elder.readAloudNote).toBe("AI の声で読みます");
    expect(html).toContain(words.elder.readAloudNote);
    expect(render({ question: "q", questionAudioUrl: "/api/x" }, "family")).not.toContain(words.elder.readAloud);
  });
  it("自動では流さない（audio 要素も autoplay も描かない）", () => {
    const html = render({ question: "q", questionAudioUrl: "/api/x", quote: voiceQuote(1000) }, "elder");
    expect(html).not.toMatch(/<audio|autoplay/i);
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
    expect(withFile).toContain(`accept="${AUDIO_FILE_ACCEPT}"`);
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

describe("家族のこと: 一人ひとりを直す", () => {
  const grandma = {
    id: "m-grandma",
    role: "elder",
    relation: "祖母",
    calledAs: "ばあば",
    speechStyle: "dialect",
    dialectRegion: "鹿児島",
    setUpByMemberId: "m-mother",
  };
  it("一覧の一人ひとりに「直す」があり、閉じているときは入力欄を出さない", () => {
    const mother = { id: "m-mother", role: "family", relation: "母", calledAs: "おかあさん", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null };
    const view = { family: { id: "f", isDemo: true, clock: { date: "2026-11-03", slot: "morning" }, canAdvanceClock: true }, members: [grandma, mother] };
    const html = renderToStaticMarkup(
      h(FamilySetup, { view, me: mother, reload: async () => {}, inviteToken: null, onInviteToken: () => {} }),
    ) as string;
    expect(words.member.edit).toBe("直す");
    expect(html.match(new RegExp(`<button[^>]*>${words.member.edit}</button>`, "g"))).toHaveLength(2);
    // 入力欄は「足す」の一つだけ（直す欄は閉じている）
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).not.toContain(`value="ばあば"`);
  });
  it("直す入力欄は、その人の今の内容が入り、送るボタンは「直す」、閉じるボタンは「やめる」", () => {
    const html = renderToStaticMarkup(
      h(MemberForm, { initial: grandma, setUpByMemberId: grandma.setUpByMemberId, submitLabel: words.member.edit, send: async () => grandma, onCancel: () => {} }),
    ) as string;
    expect(html).toContain('value="祖母"');
    expect(html).toContain('value="ばあば"');
    expect(html).toContain('value="鹿児島"');
    expect(html).toMatch(/<input type="radio" name="role" checked=""[^>]*\/>声で答える/);
    expect(html).toMatch(/<input type="radio" name="speech" checked=""[^>]*\/>方言/);
    expect(html).toMatch(/<button type="submit"[^>]*>直す<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>やめる<\/button>/);
  });
  it("足すときは空の欄で、「やめる」は onCancel を渡したときだけ", () => {
    const html = renderToStaticMarkup(h(MemberForm, { setUpByMemberId: null })) as string;
    expect(html).not.toContain('value="ばあば"');
    expect(html).toMatch(/<button type="submit"[^>]*>足す<\/button>/);
    expect(html).not.toContain(words.home.cancel);
  });
  it("一番下に「家族の番号」と家族 ID を、補助の文字で出す（長押しで全部選べる。ボタンは付けない。0033）", () => {
    const mother = { id: "m-mother", role: "family", relation: "母", calledAs: "おかあさん", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null };
    const familyId = "00000000-0000-4000-8000-000000000abc";
    const view = { family: { id: familyId, isDemo: true, clock: { date: "2026-11-03", slot: "morning" }, canAdvanceClock: true }, members: [grandma, mother] };
    const html = renderToStaticMarkup(
      h(FamilySetup, { view, me: mother, reload: async () => {}, inviteToken: null, onInviteToken: () => {} }),
    ) as string;
    expect(words.family.familyIdLabel).toBe("家族の番号");
    const block = `<p class="sub family-id">${words.family.familyIdLabel}<br/><span class="invite-url">${familyId}</span></p>`;
    expect(html).toContain(block);
    // 画面の最後の要素（招待の節より下）
    expect(html.endsWith(`${block}</main>`)).toBe(true);
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\.invite-url \{[^}]*user-select: all;[^}]*\}/);
    expect(css).toMatch(/\.invite-url \{[^}]*word-break: break-all;[^}]*\}/);
  });
  it("祖父母の画面とその部品には、/family への道がない（/family へ動かすのは家族の画面だけ）", () => {
    const callers = listFiles(clientDir).filter((f) => /navigate\(\s*["']\/family/.test(fs.readFileSync(f, "utf8")));
    expect(callers.map((f) => path.relative(clientDir, f))).toEqual([path.join("screens", "Home.tsx")]);
    expect(stripComments(read("src/client/screens/Elder.tsx"))).not.toContain("/family");
  });
  it("直すときは、代わりに設定した人を今の値のまま送る", () => {
    expect(stripComments(read("src/client/screens/FamilySetup.tsx"))).toContain("setUpByMemberId={m.setUpByMemberId}");
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
/** 運営の記録の画面（/ops/record、0025）。家族に見せないので、言葉をこの中に置いてよい */
const opsDir = path.join(clientDir, "ops");

describe("家族に見せる日本語は words.ts にだけある", () => {
  it("words.ts 以外の src/client に、コメント以外の日本語がない（開発用の check/ と ops/ を除く）", () => {
    const jp = /[぀-ヿ㐀-鿿！-｠]/;
    const offenders: string[] = [];
    for (const file of listFiles(clientDir)) {
      if (file.endsWith(`${path.sep}words.ts`)) continue;
      if (file.startsWith(`${checkDir}${path.sep}`)) continue;
      if (file.startsWith(`${opsDir}${path.sep}`)) continue;
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

  it("ops/ のファイルも、先頭で開発用と断っている。家族の画面からは読み込まない（App の lazy だけ）", () => {
    const files = listFiles(opsDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.readFileSync(f, "utf8").split("\n")[0]).toMatch(/開発用/);
    const importers = listFiles(clientDir).filter(
      (f) => !f.startsWith(`${opsDir}${path.sep}`) && /["']\.{1,2}\/(?:\.\.\/)*ops\//.test(fs.readFileSync(f, "utf8")),
    );
    expect(importers.map((f) => path.relative(repoRoot, f))).toEqual(["src/client/App.tsx"]);
    expect(read("src/client/App.tsx")).toMatch(/lazy\(\(\) => import\("\.\/ops\/RecordPage"\)\)/);
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
    expect(elder).toContain("onBlob: sender.sendVoice");
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
