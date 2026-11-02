// scripts/setup-cloudflare.mjs が、D1・R2 を足りないものだけ作り、wrangler.jsonc の database_id だけを書き換えるかを確かめる。
// docs/decisions/0006-cloudflare-ids-in-repo.md
//
// Cloudflare には触れない。偽の wrangler（OMOIDE_SETUP_WRANGLER）が、アカウントの状態を JSON のファイルで持つ。
// リポジトリの wrangler.jsonc は書き換えない。一時ディレクトリの写しに対して実行する。
import { afterAll, describe, expect, it } from "vitest";
import { childProcess, fs, os, path, processEnv, repoRoot } from "./node";

const script = path.join(repoRoot, "scripts/setup-cloudflare.mjs");
const repoJsonc: string = fs.readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8");
const OLD_IDS: string[] = [...repoJsonc.matchAll(/"database_id"\s*:\s*"([^"]*)"/g)].map((m) => m[1] as string);
const OLD_PROD_ID = OLD_IDS[0] as string;
const OLD_PREVIEW_ID = OLD_IDS[1] as string;

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "omoide-setup-test-"));
  tmpDirs.push(d);
  return d;
}

type State = {
  loggedIn: boolean;
  accounts: Array<{ id: string; name: string }>;
  d1: Array<{ name: string; uuid: string }>;
  r2: string[];
  r2ListFails?: boolean;
};
type Call = { args: string[]; cwd: string; accountId?: string };

// 偽の wrangler。呼ばれた引数を log に書き、state を読み書きする
const fakeWrangler = `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.FAKE_STATE, logPath = process.env.FAKE_LOG;
const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
const a = process.argv.slice(2);
fs.appendFileSync(logPath, JSON.stringify({ args: a, cwd: process.cwd(), accountId: process.env.CLOUDFLARE_ACCOUNT_ID }) + "\\n");
const save = () => fs.writeFileSync(statePath, JSON.stringify(s));
const k = a.join(" ");
if (k === "whoami --json") {
  if (!s.loggedIn) { console.log(JSON.stringify({ loggedIn: false })); process.exit(1); }
  console.log(JSON.stringify({ loggedIn: true, authType: "OAuth Token", email: "someone@example.com", accounts: s.accounts }));
} else if (k === "d1 list --json") {
  console.log(JSON.stringify(s.d1.map((d) => ({ ...d, version: "production" })), null, 2));
} else if (k === "r2 bucket list") {
  if (s.r2ListFails) { console.error("Please enable R2 through the Cloudflare Dashboard. [code: 10042]"); process.exit(1); }
  console.log(" ⛅️ wrangler 4.156.1\\nListing buckets...\\n" + s.r2.map((n) => "name:           " + n + "\\ncreation_date:  2026-11-02T00:00:00.000Z\\n").join("\\n"));
} else if (a[0] === "d1" && a[1] === "create" && a.length === 3) {
  if (s.d1.some((d) => d.name === a[2])) { console.error("already exists"); process.exit(1); }
  s.d1.push({ name: a[2], uuid: "11111111-1111-4111-8111-" + String(s.d1.length + 1).padStart(12, "0") }); save();
  console.log("✅ Successfully created DB");
} else if (a[0] === "r2" && a[1] === "bucket" && a[2] === "create" && a.length === 4) {
  if (s.r2.includes(a[3])) { console.error("already exists"); process.exit(1); }
  s.r2.push(a[3]); save();
  console.log("✅ Created bucket");
} else { console.error("偽の wrangler が知らないコマンド: " + k); process.exit(9); }
`;

const ONE_ACCOUNT = [{ id: "acc1", name: "Someone's Account" }];
const fresh = (over: Partial<State> = {}): State => ({ loggedIn: true, accounts: ONE_ACCOUNT, d1: [], r2: [], ...over });
// 私たちのアカウント: wrangler.jsonc の名前と ID のとおりにそろっている
const ours = (): State =>
  fresh({
    d1: [
      { name: "omoide-tsumugi", uuid: OLD_PROD_ID },
      { name: "omoide-tsumugi-preview", uuid: OLD_PREVIEW_ID },
      { name: "something-else", uuid: "99999999-9999-4999-8999-999999999999" },
    ],
    r2: ["other-bucket", "omoide-tsumugi", "omoide-tsumugi-preview"],
  });

function setup(state: State, jsonc = repoJsonc) {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "wrangler.jsonc"), jsonc);
  fs.copyFileSync(path.join(repoRoot, ".dev.vars.example"), path.join(dir, ".dev.vars.example"));
  const bin = path.join(dir, "fake-wrangler.cjs");
  fs.writeFileSync(bin, fakeWrangler, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, "log.jsonl"), "");
  return dir;
}

function run(dir: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  const env = processEnv();
  delete env.CLOUDFLARE_ACCOUNT_ID;
  delete env.CLOUDFLARE_ENV;
  const r = childProcess.spawnSync((globalThis as any).process.execPath, [script, ...args], { // eslint-disable-line @typescript-eslint/no-explicit-any
    cwd: dir,
    encoding: "utf8",
    env: {
      ...env,
      OMOIDE_SETUP_WRANGLER: path.join(dir, "fake-wrangler.cjs"),
      FAKE_STATE: path.join(dir, "state.json"),
      FAKE_LOG: path.join(dir, "log.jsonl"),
      ...extraEnv,
    },
  });
  const calls: Call[] = fs
    .readFileSync(path.join(dir, "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l: string) => JSON.parse(l));
  fs.writeFileSync(path.join(dir, "log.jsonl"), "");
  return {
    status: r.status as number,
    out: `${r.stdout}${r.stderr}` as string,
    calls,
    creates: calls.filter((c) => c.args.includes("create")).map((c) => c.args.join(" ")),
    jsonc: fs.readFileSync(path.join(dir, "wrangler.jsonc"), "utf8") as string,
    state: JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")) as State,
  };
}

/** wrangler 自身に wrangler.jsonc を読ませ、環境ごとの D1 の ID を取り出す。 */
function idsByWrangler(dir: string) {
  const code = `
    import { unstable_readConfig } from ${JSON.stringify(path.join(repoRoot, "node_modules/wrangler/wrangler-dist/cli.js"))};
    const ids = (env) => unstable_readConfig({ config: "wrangler.jsonc", env }, { hideWarnings: true }).d1_databases.map((d) => d.database_id);
    console.log(JSON.stringify({ production: ids(undefined), preview: ids("preview") }));`;
  const env = processEnv();
  delete env.CLOUDFLARE_ENV;
  const r = childProcess.spawnSync((globalThis as any).process.execPath, ["--input-type=module", "-e", code], { cwd: dir, encoding: "utf8", env }); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout.trim().split("\n").pop() as string);
}

describe("setup-cloudflare.mjs（偽の wrangler で）", () => {
  it("リポジトリの wrangler.jsonc には database_id が2つある（テストの前提）", () => {
    expect(OLD_IDS).toHaveLength(2);
  });

  it("私たちのアカウントでは、--dry-run も本番の実行も、何も作らず wrangler.jsonc も変えない", () => {
    const dir = setup(ours());
    for (const args of [["--dry-run"], []]) {
      const r = run(dir, args);
      expect(r.status, r.out).toBe(0);
      expect(r.creates, args.join(" ")).toEqual([]);
      expect(r.jsonc).toBe(repoJsonc);
      expect(r.out).toContain("ID は合っています");
    }
  });

  it("空のアカウントで --dry-run なら、作るものを表示するだけで、作らず書き換えない", () => {
    const dir = setup(fresh());
    const r = run(dir, ["--dry-run"]);
    expect(r.status, r.out).toBe(0);
    expect(r.creates).toEqual([]);
    expect(r.state).toEqual(fresh());
    expect(r.jsonc).toBe(repoJsonc);
    expect(r.out).toContain("D1 omoide-tsumugi-preview: ありません → 作ります");
    expect(r.out).toContain("R2 omoide-tsumugi: ありません → 作ります");
    expect(r.out).toContain("作るもの 4 個、書き換える ID 2 個");
  });

  it("空のアカウントでは、D1 と R2 を2つずつ作り、database_id だけを書き換える。2回目は何もしない", () => {
    const dir = setup(fresh());
    const r = run(dir);
    expect(r.status, r.out).toBe(0);
    expect(r.creates.sort()).toEqual(
      ["d1 create omoide-tsumugi", "d1 create omoide-tsumugi-preview", "r2 bucket create omoide-tsumugi", "r2 bucket create omoide-tsumugi-preview"].sort(),
    );
    const prodId = r.state.d1.find((d) => d.name === "omoide-tsumugi")!.uuid;
    const previewId = r.state.d1.find((d) => d.name === "omoide-tsumugi-preview")!.uuid;
    // ID のところ以外は1文字も変わらない（コメントと並びを保つ）
    expect(r.jsonc).toBe(repoJsonc.replace(OLD_PROD_ID, prodId).replace(OLD_PREVIEW_ID, previewId));
    expect(idsByWrangler(dir)).toEqual({ production: [prodId], preview: [previewId] });
    expect(r.out).toContain("次にやること");
    expect(r.out).toContain("npx wrangler secret put <名前> --env preview");
    expect(r.out).toContain("ANTHROPIC_API_KEY");
    expect(r.out).toContain("npx wrangler d1 migrations apply DB --env preview --remote");
    expect(r.out).toContain("Worker omoide-tsumugi-preview: ブランチ develop、デプロイのコマンド npm run deploy:preview");
    expect(r.out).toContain("Worker omoide-tsumugi: ブランチ main、デプロイのコマンド npm run deploy:production");
    expect(r.out).toContain("コミットする");

    const again = run(dir);
    expect(again.status, again.out).toBe(0);
    expect(again.creates).toEqual([]);
    expect(again.jsonc).toBe(r.jsonc);
    expect(again.out).toContain("そろっています");
  });

  it("同じ名前の D1・R2 がすでにあれば、作らずにその ID を使う", () => {
    const dir = setup(fresh({ d1: [{ name: "omoide-tsumugi-preview", uuid: "22222222-2222-4222-8222-222222222222" }], r2: ["omoide-tsumugi"] }));
    const r = run(dir);
    expect(r.status, r.out).toBe(0);
    expect(r.creates.sort()).toEqual(["d1 create omoide-tsumugi", "r2 bucket create omoide-tsumugi-preview"]);
    expect(idsByWrangler(dir).preview).toEqual(["22222222-2222-4222-8222-222222222222"]);
  });

  it("wrangler は、設定ファイルのない一時ディレクトリで呼ばれる（作ったものを設定に足させない）", () => {
    const dir = setup(fresh());
    const r = run(dir);
    expect(r.calls.length).toBeGreaterThan(0);
    for (const c of r.calls) {
      expect(path.resolve(c.cwd)).not.toBe(path.resolve(dir));
      expect(fs.existsSync(path.join(c.cwd, "wrangler.jsonc"))).toBe(false);
    }
  });

  it("ログインしていなければ止まり、何も調べず何も作らない", () => {
    const dir = setup(fresh({ loggedIn: false }));
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain("wrangler login");
    expect(r.calls.map((c) => c.args.join(" "))).toEqual(["whoami --json"]);
    expect(r.jsonc).toBe(repoJsonc);
  });

  it("アカウントが複数で CLOUDFLARE_ACCOUNT_ID がなければ止まる。指定すればそのアカウントで進む", () => {
    const accounts = [...ONE_ACCOUNT, { id: "acc2", name: "Team" }];
    const dir = setup(fresh({ accounts }));
    const bad = run(dir);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(bad.creates).toEqual([]);

    const ok = run(dir, ["--dry-run"], { CLOUDFLARE_ACCOUNT_ID: "acc2" });
    expect(ok.status, ok.out).toBe(0);
    expect(ok.out).toContain("Team (acc2)");
    expect(ok.calls.every((c) => c.accountId === "acc2")).toBe(true);
  });

  it("CLOUDFLARE_ACCOUNT_ID が、ログインしているアカウントの中になければ止まる", () => {
    const r = run(setup(fresh()), ["--dry-run"], { CLOUDFLARE_ACCOUNT_ID: "nope" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("ありません");
    expect(r.creates).toEqual([]);
  });

  it("wrangler.jsonc の account_id があれば、そのアカウントで wrangler を呼ぶ", () => {
    const jsonc = repoJsonc.replace('"main":', '"account_id": "acc2",\n  "main":');
    const dir = setup(fresh({ accounts: [...ONE_ACCOUNT, { id: "acc2", name: "Team" }] }), jsonc);
    const r = run(dir, ["--dry-run"]);
    expect(r.status, r.out).toBe(0);
    expect(r.calls.every((c) => c.accountId === "acc2")).toBe(true);
  });

  it("R2 の一覧が取れなければ（R2 を使い始めていない）、案内を出して止まり、何も作らない", () => {
    const dir = setup(fresh({ r2ListFails: true }));
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain("R2 の画面");
    expect(r.creates).toEqual([]);
    expect(r.jsonc).toBe(repoJsonc);
  });

  it("名前を変えた wrangler.jsonc では、その名前で作る", () => {
    const jsonc = repoJsonc.replaceAll('"omoide-tsumugi-preview"', '"my-album-preview"').replaceAll('"omoide-tsumugi"', '"my-album"');
    const dir = setup(fresh(), jsonc);
    const r = run(dir);
    expect(r.status, r.out).toBe(0);
    expect(r.creates.sort()).toEqual(["d1 create my-album", "d1 create my-album-preview", "r2 bucket create my-album", "r2 bucket create my-album-preview"]);
    expect(r.out).toContain("Worker my-album-preview: ブランチ develop");
  });

  it("database_id のない D1 があれば、案内を出して止まる", () => {
    const jsonc = repoJsonc.replace(/\s*"database_id"\s*:\s*"[^"]*",/, "");
    const r = run(setup(fresh(), jsonc));
    expect(r.status).toBe(1);
    expect(r.out).toContain("database_id がありません");
    expect(r.calls).toEqual([]);
  });

  // JSONC の読み手が、コメントや文字列の中の { } や "database_id" に惑わされず、行末のカンマや /* */ も読めるか
  const TRICKY_JSONC = [
    "// 先頭のコメント { \"database_id\": \"in-line-comment\" }",
    "/* ブロックのコメント",
    "   \"d1_databases\": [{ \"database_name\": \"fake\", \"database_id\": \"in-block-comment\" }] } ] {",
    "*/",
    "{",
    "  \"name\": \"tricky\", // 名前 { [",
    "  \"main\": \"./src/x.ts\",",
    "  \"compatibility_date\": \"2026-11-01\",",
    "  \"vars\": { \"NOTE\": \"文字列の中の // と /* と { \\\"database_id\\\": \\\"in-string\\\" } と \\\\\" },",
    "  \"d1_databases\": [",
    "    {",
    "      \"binding\": \"DB\",",
    "      \"database_name\": \"tricky-db\",",
    "      /* キーの前のコメント */ \"database_id\" /* キーと : の間 */ : /* : と値の間 */ \"old-prod\", // 行末",
    "      \"migrations_dir\": \"drizzle/migrations\",",
    "    },",
    "  ],",
    "  \"r2_buckets\": [{ \"binding\": \"BUCKET\", \"bucket_name\": \"tricky-bucket\", },],",
    "  \"env\": {",
    "    \"preview\": {",
    "      \"name\": \"tricky-preview\",",
    "      \"d1_databases\": [{ \"binding\": \"DB\", \"database_name\": \"tricky-db-preview\", \"database_id\": \"\" }],",
    "      \"r2_buckets\": [{ \"binding\": \"BUCKET\", \"bucket_name\": \"tricky-bucket-preview\" }],",
    "    },",
    "  },",
    "}",
    "",
  ].join("\n");

  it("JSONC: コメント・文字列の中の { } や database_id に惑わされず、行末のカンマと /* */ も読み、ID の値だけを書き換える", () => {
    const dir = setup(fresh(), TRICKY_JSONC);
    const r = run(dir);
    expect(r.status, r.out).toBe(0);
    expect(r.creates.sort()).toEqual(
      ["d1 create tricky-db", "d1 create tricky-db-preview", "r2 bucket create tricky-bucket", "r2 bucket create tricky-bucket-preview"].sort(),
    );
    const prodId = r.state.d1.find((d) => d.name === "tricky-db")!.uuid;
    const previewId = r.state.d1.find((d) => d.name === "tricky-db-preview")!.uuid;
    expect(r.jsonc).toBe(
      TRICKY_JSONC.replace('"old-prod"', JSON.stringify(prodId)).replace('"database_id": "" }', `"database_id": ${JSON.stringify(previewId)} }`),
    );
    expect(r.jsonc).toContain("in-line-comment");
    expect(r.jsonc).toContain("in-block-comment");
    expect(r.jsonc).toContain('\\"in-string\\"');
    expect(r.creates.join(" ")).not.toContain("fake");
    expect(idsByWrangler(dir)).toEqual({ production: [prodId], preview: [previewId] });
    const again = run(dir);
    expect(again.creates).toEqual([]);
    expect(again.jsonc).toBe(r.jsonc);
  });

  it("JSONC: 改行が CRLF でも読み、改行を変えない", () => {
    const crlf = TRICKY_JSONC.replaceAll("\n", "\r\n");
    const dir = setup(fresh(), crlf);
    const r = run(dir);
    expect(r.status, r.out).toBe(0);
    const prodId = r.state.d1.find((d) => d.name === "tricky-db")!.uuid;
    expect(r.jsonc).toContain(`"database_id" /* キーと : の間 */ : /* : と値の間 */ ${JSON.stringify(prodId)}, // 行末\r\n`);
    expect(r.jsonc.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("JSONC が壊れていれば（閉じないコメント・カンマ抜け）、wrangler を呼ばずに止まり、書き換えない", () => {
    for (const broken of [repoJsonc + "\n/* 閉じない", repoJsonc.replace('"main":', '"x": 1 "main":')]) {
      const dir = setup(fresh(), broken);
      const r = run(dir);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain("wrangler.jsonc の");
      expect(r.calls).toEqual([]);
      expect(r.jsonc).toBe(broken);
    }
  });

  it("知らない引数なら、使い方を出して止まる", () => {
    const r = run(setup(fresh()), ["--dryrun"]);
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });
});
