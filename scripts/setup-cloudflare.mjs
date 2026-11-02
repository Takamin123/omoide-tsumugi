#!/usr/bin/env node
// clone した人が、自分の Cloudflare アカウントに D1 と R2 を用意し、wrangler.jsonc の database_id を自分のものに書き換える。
// docs/decisions/0006-cloudflare-ids-in-repo.md
//
// - 名前は wrangler.jsonc（トップレベルと env.* の d1_databases / r2_buckets）から読む。名前を変えたいときは wrangler.jsonc を直してから実行する
// - すでにあるものは作らない。何度実行しても同じ結果になる（ID が合っていれば、wrangler.jsonc も書き換えない）
// - wrangler.jsonc は database_id の値の部分だけを置き換える。コメントや並びはそのまま
//
// 使い方: node scripts/setup-cloudflare.mjs [--dry-run]
//   --dry-run  何を作り、何を書き換えるかを表示するだけ（Cloudflare では読み取りだけをする）
//
// テストのため、OMOIDE_SETUP_WRANGLER で wrangler の代わりに実行するものを指定できる。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve("wrangler.jsonc");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
if (args.some((a) => a !== "--dry-run")) {
  console.error("使い方: node scripts/setup-cloudflare.mjs [--dry-run]");
  process.exit(2);
}

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

// ---- wrangler.jsonc を読む（値の位置を覚える、小さな JSONC の読み手） ----

/** JSONC を読み、値の木を返す。文字列の値は、元の文字列の中の位置（start, end）を持つ。 */
function parseJsonc(text) {
  let i = 0;
  const err = (m) => {
    const line = text.slice(0, i).split("\n").length;
    throw new Error(`wrangler.jsonc の ${line} 行目が読めません: ${m}`);
  };
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith("//", i)) {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (text.startsWith("/*", i)) {
        const e = text.indexOf("*/", i + 2);
        if (e < 0) err("コメントが閉じていません");
        i = e + 2;
      } else return;
    }
  };
  const str = () => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      if (text[i] === "\n") err("文字列が閉じていません");
      i++;
    }
    if (i >= text.length) err("文字列が閉じていません");
    i++;
    return { type: "string", value: JSON.parse(text.slice(start, i)), start, end: i };
  };
  const value = () => {
    skip();
    const c = text[i];
    if (c === "{") {
      i++;
      const props = new Map();
      for (;;) {
        skip();
        if (text[i] === "}") break;
        if (text[i] !== '"') err("キーがありません");
        const key = str().value;
        skip();
        if (text[i] !== ":") err("「:」がありません");
        i++;
        props.set(key, value());
        skip();
        if (text[i] === ",") i++;
        else if (text[i] !== "}") err("「,」か「}」がありません");
      }
      i++;
      return { type: "object", props };
    }
    if (c === "[") {
      i++;
      const items = [];
      for (;;) {
        skip();
        if (text[i] === "]") break;
        items.push(value());
        skip();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") err("「,」か「]」がありません");
      }
      i++;
      return { type: "array", items };
    }
    if (c === '"') return str();
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) err("値が読めません");
    i += m[0].length;
    return { type: "other", value: JSON.parse(m[0]) };
  };
  const root = value();
  skip();
  if (i < text.length) err("余分な文字があります");
  if (root.type !== "object") err("一番外が { } ではありません");
  return root;
}

const get = (node, key) => (node?.type === "object" ? node.props.get(key) : undefined);
const strOf = (node) => (node?.type === "string" ? node.value : undefined);

/** 環境ごとの D1・R2 を取り出す。トップレベルが本番、env.<名前> がそれぞれの環境。 */
function readResources(root) {
  const envs = [{ env: undefined, label: "本番（トップレベル）", node: root }];
  const envNode = get(root, "env");
  if (envNode?.type === "object") {
    for (const [name, node] of envNode.props) envs.push({ env: name, label: `env.${name}`, node });
  }
  const topName = strOf(get(root, "name"));
  return envs.map(({ env, label, node }) => {
    const d1 = (get(node, "d1_databases")?.items ?? []).map((d) => {
      const name = strOf(get(d, "database_name"));
      const idNode = get(d, "database_id");
      if (!name) throw new Error(`${label} の d1_databases に database_name がありません`);
      if (idNode?.type !== "string") {
        throw new Error(`${label} の D1「${name}」に database_id がありません。"database_id": "" を足してから実行してください`);
      }
      return { name, id: idNode.value, idNode };
    });
    const r2 = (get(node, "r2_buckets")?.items ?? []).map((b) => {
      const name = strOf(get(b, "bucket_name"));
      if (!name) throw new Error(`${label} の r2_buckets に bucket_name がありません`);
      return name;
    });
    const worker = strOf(get(node, "name")) ?? (env ? `${topName}-${env}` : topName);
    return { env, label, worker, d1, r2 };
  });
}

/** database_id の値を置き換えた文字列を返す。edits は [{ idNode, id }]。ほかの部分は1文字も変えない。 */
function applyIdEdits(text, edits) {
  let out = text;
  for (const { idNode, id } of [...edits].sort((a, b) => b.idNode.start - a.idNode.start)) {
    out = out.slice(0, idNode.start) + JSON.stringify(id) + out.slice(idNode.end);
  }
  return out;
}

// ---- wrangler を呼ぶ ----

// wrangler は、設定ファイルがあると、作ったものを設定に足そうとすることがある。空の一時ディレクトリで実行して避ける。
// そのぶん、wrangler.jsonc の account_id は、環境変数で渡す。
const workDir = mkdtempSync(join(tmpdir(), "omoide-setup-"));
process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));
const wranglerBin = process.env.OMOIDE_SETUP_WRANGLER || join(repoRoot, "node_modules/.bin/wrangler");
const wranglerEnv = { ...process.env };
delete wranglerEnv.CLOUDFLARE_ENV;

function wrangler(cmdArgs, { allowFail = false } = {}) {
  const r = spawnSync(wranglerBin, cmdArgs, { cwd: workDir, env: wranglerEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) fail(`wrangler を実行できません（npm install はしましたか）: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    fail(`wrangler ${cmdArgs.join(" ")} が失敗しました（原因を直してからもう一度実行すれば、作ったものは使い直します）\n${`${r.stdout}${r.stderr}`.trim()}`);
  }
  return r;
}

function parseJsonOutput(cmd, stdout) {
  // wrangler が JSON の前に何かを出しても読めるように、最初の [ か { から読む
  const start = stdout.search(/[[{]/);
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    fail(`wrangler ${cmd} の出力が読めません\n${stdout.trim()}`);
  }
}

const listD1 = () => {
  const list = parseJsonOutput("d1 list --json", wrangler(["d1", "list", "--json"]).stdout);
  return new Map(list.map((d) => [d.name, d.uuid]));
};
const listR2 = () => {
  const r = wrangler(["r2", "bucket", "list"], { allowFail: true });
  if (r.status !== 0) {
    fail(
      "R2 のバケットの一覧が取れません。R2 をまだ使ったことがなければ、ダッシュボードの R2 の画面で、使い始める手続き（無料枠あり）をしてください\n" +
        `${r.stdout}${r.stderr}`.trim(),
    );
  }
  return new Set([...r.stdout.matchAll(/^name:\s+(\S+)\s*$/gm)].map((m) => m[1]));
};

// ---- 本体 ----

if (!existsSync(configPath)) fail(`${configPath} がありません。リポジトリの根で実行してください`);
const original = readFileSync(configPath, "utf8");
let envs;
try {
  const root = parseJsonc(original);
  envs = readResources(root);
  const accountId = strOf(get(root, "account_id"));
  if (accountId && !wranglerEnv.CLOUDFLARE_ACCOUNT_ID) wranglerEnv.CLOUDFLARE_ACCOUNT_ID = accountId;
} catch (e) {
  fail(e.message);
}

console.log(dryRun ? "【確かめるだけ（--dry-run）】何も作らず、wrangler.jsonc も書き換えません\n" : "");

// 1. ログインしているか
const who = wrangler(["whoami", "--json"], { allowFail: true });
const whoJson = who.status === 0 ? parseJsonOutput("whoami --json", who.stdout) : undefined;
if (!whoJson?.loggedIn) fail("Cloudflare にログインしていません。先に npx wrangler login を実行してください");
const accounts = whoJson.accounts ?? [];
const chosenId = wranglerEnv.CLOUDFLARE_ACCOUNT_ID;
if (!chosenId && accounts.length > 1) {
  fail(
    "アカウントが複数あります。使うアカウントの ID を CLOUDFLARE_ACCOUNT_ID で指定してください\n" +
      accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n") +
      "\n  例: CLOUDFLARE_ACCOUNT_ID=<ID> npm run setup:cloudflare",
  );
}
if (chosenId && accounts.length > 0 && !accounts.some((a) => a.id === chosenId)) {
  fail(`アカウント ${chosenId} は、ログインしているアカウントの中にありません\n` + accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n"));
}
const account = chosenId ? accounts.find((a) => a.id === chosenId) ?? { id: chosenId, name: "" } : accounts[0];
console.log(`アカウント: ${account ? `${account.name} (${account.id})` : "（API トークンの権限で決まるアカウント）"}\n`);

// 2. 今あるものを調べる
let d1 = listD1();
const r2 = listR2();

// 3. 足りないものを作る（同じ名前は一度だけ）
const d1Names = [...new Set(envs.flatMap((e) => e.d1.map((d) => d.name)))];
const r2Names = [...new Set(envs.flatMap((e) => e.r2))];
const d1ToCreate = d1Names.filter((n) => !d1.has(n));
const r2ToCreate = r2Names.filter((n) => !r2.has(n));

for (const name of d1Names) console.log(`D1 ${name}: ${d1.has(name) ? `あります（${d1.get(name)}）` : "ありません → 作ります"}`);
for (const name of r2Names) console.log(`R2 ${name}: ${r2.has(name) ? "あります" : "ありません → 作ります"}`);
console.log("");

if (!dryRun) {
  for (const name of d1ToCreate) {
    console.log(`D1 ${name} を作っています…`);
    wrangler(["d1", "create", name]);
  }
  for (const name of r2ToCreate) {
    console.log(`R2 ${name} を作っています…`);
    wrangler(["r2", "bucket", "create", name]);
  }
  if (d1ToCreate.length > 0) {
    d1 = listD1();
    const missing = d1ToCreate.filter((n) => !d1.has(n));
    if (missing.length > 0) fail(`作ったはずの D1 が一覧にありません: ${missing.join(", ")}。少し待ってから、もう一度実行してください`);
  }
}

// 4. wrangler.jsonc の database_id を合わせる
const edits = [];
let pending = 0;
for (const e of envs) {
  for (const d of e.d1) {
    const newId = d1.get(d.name);
    if (newId === undefined) {
      pending++;
      console.log(`wrangler.jsonc ${e.label} の D1 ${d.name}: 作った後の ID に書き換えます（今は ${d.id || "空"}）`);
    } else if (newId === d.id) {
      console.log(`wrangler.jsonc ${e.label} の D1 ${d.name}: ID は合っています（そのまま）`);
    } else {
      console.log(`wrangler.jsonc ${e.label} の D1 ${d.name}: ID を ${d.id || "（空）"} → ${newId} に書き換え${dryRun ? "ます" : "ました"}`);
      edits.push({ idNode: d.idNode, id: newId });
    }
  }
}
if (!dryRun && edits.length > 0) writeFileSync(configPath, applyIdEdits(original, edits));

const created = d1ToCreate.length + r2ToCreate.length;
console.log("");
if (dryRun) {
  console.log(created === 0 && edits.length + pending === 0 ? "→ 作るものも、書き換えるものもありません" : `→ 作るもの ${created} 個、書き換える ID ${edits.length + pending} 個`);
  console.log("  実際に行うには: npm run setup:cloudflare");
  process.exit(0);
}
console.log(created === 0 && edits.length === 0 ? "→ 作ったものも、書き換えたものもありません（そろっています）" : `→ 作ったもの ${created} 個、書き換えた ID ${edits.length} 個`);

// 5. 次にやること
const envFlag = (e) => (e.env ? ` --env ${e.env}` : "");
const secretNames = (() => {
  try {
    return [...readFileSync(resolve(".dev.vars.example"), "utf8").matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
})();
// docs/decisions/0005-separate-preview-worker.md の、環境ごとのデプロイのコマンドとブランチ
const deployTable = { production: ["npm run deploy:production", "main"], preview: ["npm run deploy:preview", "develop"] };
const deployOf = (e) => deployTable[e.env ?? "production"];

console.log(`
次にやること（詳しくは README.md の「自分で動かす」）
${edits.length > 0 ? "\n0. 書き換えた wrangler.jsonc を、自分のリポジトリにコミットする（Workers Builds はリポジトリの wrangler.jsonc を読む）\n" : ""}
1. 秘密の値を登録する（値は対話の画面で入力する。名前の一覧は .dev.vars.example）
${envs.map((e) => `   ${e.label}: npx wrangler secret put <名前>${envFlag(e)}`).join("\n")}
   名前: ${secretNames.join(", ") || "（.dev.vars.example を参照）"}

2. D1 のマイグレーションを適用する
${envs.filter((e) => e.d1.length > 0).map((e) => `   ${e.label}: npx wrangler d1 migrations apply DB${envFlag(e)} --remote`).join("\n")}

3. 最初の deploy をする
${envs.filter((e) => deployOf(e)).map((e) => `   ${e.label}: ${deployOf(e)[0]}`).join("\n")}

4. Workers Builds を設定する（ダッシュボードの Worker ごとに、同じリポジトリをつなぐ。Enable Preview Builds は切る）
${envs.filter((e) => deployOf(e)).map((e) => `   Worker ${e.worker}: ブランチ ${deployOf(e)[1]}、デプロイのコマンド ${deployOf(e)[0]}`).join("\n")}

名前を変えたいときは、wrangler.jsonc の name、database_name、bucket_name を直してから、もう一度実行してください。`);
