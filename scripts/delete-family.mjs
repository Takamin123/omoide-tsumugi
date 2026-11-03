#!/usr/bin/env node
// 家族の場をまるごと消す（docs/decisions/0027 の消す約束、0031）。手順は .claude/skills/delete-family/SKILL.md
//
// 使い方:
//   node scripts/delete-family.mjs <local|preview|production> <家族 ID>                                  数えるだけ
//   node scripts/delete-family.mjs <local|preview|production> <家族 ID> --delete --confirm <家族 ID>     消す
//   --allow-demo        デモの家族も消す（ふだんデモは /demo-reset で扱う）
//   --persist-to <dir>  local のときの保存先（既定は .wrangler/state。開発サーバーと同じ場所）
//
// - アプリには消す入り口を作らない。wrangler の getPlatformProxy でバインディング（DB、BUCKET）を得る。
//   preview / production は remote: true の一時の設定を作り、運営の手元の wrangler のログインで本物の D1・R2 に触れる
// - 消すもの: D1 のその家族の全部の行（全部の表に family_id がある。子から順に、一つの batch で）と、
//   R2 の接頭 families/<id>/ の全部のファイル（接頭で list するので、D1 の行が指していないファイルも消える）
// - 出すのは、環境・家族 ID・デモかどうか・件数だけ。家族の名前、語りの本文、R2 のキー、URL は出さない
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 消す順（外部キーの子から）。families だけは id で引く。schema.ts の表を全部含む（test/delete-family.test.ts が確かめる） */
export const FAMILY_TABLES = [
  "records",
  "record_extractions",
  "musubi_photos",
  "musubi",
  "musubi_guess_runs",
  "photo_guess_requests",
  "photo_guesses",
  "narrations",
  "entrances",
  "photos",
  "invite_links",
  "members",
  "families",
];

/** D1 の行が R2 のキーを持つ列 */
const KEY_COLUMNS = [
  ["photos", "storage_key"],
  ["narrations", "audio_key"],
  ["entrances", "question_audio_key"],
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isFamilyId = (s) => typeof s === "string" && UUID.test(s);
/** R2 の接頭。必ず末尾のスラッシュ込みで、形の合う ID のときだけ作る（families/ だけで list して全家族を消す誤りを防ぐ） */
export function familyPrefix(id) {
  if (!isFamilyId(id)) throw new Error("家族 ID の形が違います（UUID の小文字）");
  return `families/${id}/`;
}

const idColumn = (table) => (table === "families" ? "id" : "family_id");

async function countR2(bucket, prefix) {
  let n = 0;
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    n += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}

/**
 * その家族の件数を数える。返すのは件数と種類だけ（名前・本文・キーは返さない）。
 * keysOutsidePrefix: D1 の行が指す R2 のキーのうち、families/<id>/ の外のものの数（0 のはず）
 * othersInPrefix: ほかの家族の行が、この家族の接頭の下のキーを指している数（0 のはず）
 */
export async function countFamily(env, familyId) {
  if (!isFamilyId(familyId)) throw new Error("家族 ID の形が違います（UUID の小文字）");
  // 表があるかを先に見る。families がないデータベースで families を引くと、wrangler の生のエラーで落ちる
  const missing = await missingTables(env);
  const fam = await env.DB.prepare("SELECT id, is_demo FROM families WHERE id = ?").bind(familyId).first();
  const tables = {};
  for (const t of FAMILY_TABLES) {
    // まだマイグレーションで作られていない表（例: 0004・0005 の前の本番）は 0 件として数える
    if (missing.includes(t)) {
      tables[t] = 0;
      continue;
    }
    const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${t} WHERE ${idColumn(t)} = ?`).bind(familyId).first();
    tables[t] = Number(row?.n ?? 0);
  }
  const prefix = familyPrefix(familyId);
  let referencedKeys = 0;
  let keysOutsidePrefix = 0;
  let othersInPrefix = 0;
  for (const [t, col] of KEY_COLUMNS) {
    const other = await env.DB.prepare(`SELECT count(*) AS n FROM ${t} WHERE family_id <> ? AND substr(${col}, 1, ?) = ?`)
      .bind(familyId, prefix.length, prefix)
      .first();
    othersInPrefix += Number(other?.n ?? 0);
    const { results } = await env.DB.prepare(`SELECT ${col} AS k FROM ${t} WHERE family_id = ? AND ${col} IS NOT NULL`).bind(familyId).all();
    for (const r of results) {
      referencedKeys++;
      if (typeof r.k !== "string" || !r.k.startsWith(prefix)) keysOutsidePrefix++;
    }
  }
  return {
    familyId,
    exists: fam !== null,
    isDemo: fam ? Boolean(fam.is_demo) : null,
    tables,
    referencedKeys,
    keysOutsidePrefix,
    othersInPrefix,
    r2Objects: await countR2(env.BUCKET, prefix),
    ...(missing.length > 0 ? { missingTables: missing } : {}),
  };
}

/**
 * FAMILY_TABLES のうち、そのデータベースにまだない表。後から足した表（LATER_TABLES）だけは、
 * マイグレーションを当てる前の環境でも消せるように飛ばす（人間の決定 2026-11-04: 本番の既存の家族は 0005 の前に消す）。
 * ほかの表がなければ、つなぐ先の取り違えかマイグレーションの当て忘れなので止める
 */
async function missingTables(env) {
  const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const have = new Set(results.map((r) => r.name));
  const missing = FAMILY_TABLES.filter((t) => !have.has(t));
  const base = missing.filter((t) => !LATER_TABLES.includes(t));
  if (base.length > 0) throw new Error(`土台の表がありません（${base.join(", ")}）。つなぐ先を確かめてください`);
  return missing;
}

/** 0000 の後のマイグレーションで足した表（0001・0004・0005）。これだけは、まだなくても飛ばしてよい */
const LATER_TABLES = ["photo_guess_requests", "record_extractions", "musubi_guess_runs"];

export const isEmpty = (c) => !c.exists && Object.values(c.tables).every((n) => n === 0) && c.r2Objects === 0;

/**
 * 家族の場をまるごと消す。D1 を先に（families が消えると合言葉が通らなくなり、新しい書き込みが止まる）、R2 を後に接頭で掃く。
 * 途中で落ちても、もう一度呼べば続きから消える。D1 の行が接頭の外のキーを指していたら、何も消さずに止める。
 */
export async function deleteFamily(env, familyId, { log = () => {}, allowDemo = false } = {}) {
  const before = await countFamily(env, familyId);
  // デモの家族は demo-reset の道で扱う。実際の家族と道を混ぜない（明示のときだけ通す）
  if (before.isDemo && !allowDemo) throw new Error("デモの家族です。デモは /demo-reset で扱います（消すなら --allow-demo）");
  if (before.keysOutsidePrefix > 0) {
    throw new Error(`D1 の行が families/<id>/ の外のキーを ${before.keysOutsidePrefix} 件指しています。消さずに止めました`);
  }
  if (before.othersInPrefix > 0) {
    throw new Error(`ほかの家族の行が、この家族の接頭の下のキーを ${before.othersInPrefix} 件指しています。消さずに止めました`);
  }
  const present = FAMILY_TABLES.filter((t) => !(before.missingTables ?? []).includes(t));
  await env.DB.batch(present.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE ${idColumn(t)} = ?`).bind(familyId)));
  log(`D1: ${Object.values(before.tables).reduce((a, b) => a + b, 0)} 行を消しました`);

  const prefix = familyPrefix(familyId);
  let deleted = 0;
  const seen = new Set();
  for (;;) {
    // 消しながら list するので、毎回先頭から取る
    const page = await env.BUCKET.list({ prefix, limit: 1000 });
    const keys = page.objects.map((o) => o.key).filter((k) => k.startsWith(prefix));
    if (keys.length === 0) break;
    // 消したはずのキーがまた出たら、delete が効いていない。回り続けずに止める（もう一度打てば続きから）
    if (keys.some((k) => seen.has(k))) throw new Error(`R2: 消したはずのファイルが残っています（${deleted} 件を消した後）。止めました`);
    keys.forEach((k) => seen.add(k));
    await env.BUCKET.delete(keys);
    deleted += keys.length;
    log(`R2: ${deleted} 件を消しました`);
  }
  const after = await countFamily(env, familyId);
  return { before, after, r2Deleted: deleted };
}

// ---- コマンド ----

const ENVS = ["local", "preview", "production"];

function formatCount(env, c) {
  const kind = !c.exists ? "（families に行がありません）" : c.isDemo ? "デモの家族" : "実際の家族（デモではない）";
  const t = c.tables;
  return [
    `環境: ${env}`,
    `家族 ID: ${c.familyId}`,
    `種類: ${kind}`,
    `人: ${t.members}  写真: ${t.photos}  語り: ${t.narrations}  入り口: ${t.entrances}  R2 のファイル: ${c.r2Objects}`,
    `表ごとの行数: ${FAMILY_TABLES.map((name) => `${name}=${t[name]}`).join(" ")}`,
    ...(c.missingTables ? [`まだない表（マイグレーションの前。0 件として数えた）: ${c.missingTables.join(" ")}`] : []),
    `D1 が指す R2 のキー: ${c.referencedKeys}（接頭の外: ${c.keysOutsidePrefix}、ほかの家族の行がこの接頭を指す: ${c.othersInPrefix}）`,
  ].join("\n");
}

async function readTargets(wrangler, env) {
  const read = (e) =>
    wrangler.unstable_readConfig({ config: join(repoRoot, "wrangler.jsonc"), env: e }, { hideWarnings: true });
  const pick = (cfg) => ({
    db: cfg.d1_databases.find((d) => d.binding === "DB"),
    bucket: cfg.r2_buckets.find((b) => b.binding === "BUCKET"),
  });
  const prod = pick(read(undefined));
  const prev = pick(read("preview"));
  if (!prod.db || !prod.bucket || !prev.db || !prev.bucket) throw new Error("wrangler.jsonc に DB か BUCKET のバインディングがありません");
  // プレビューと本番が同じものを指していたら、プレビューのつもりで本番を消しうる（d1-migrate と同じ注意）
  if (prod.db.database_id === prev.db.database_id || prod.bucket.bucket_name === prev.bucket.bucket_name) {
    throw new Error("wrangler.jsonc で、プレビューと本番が同じ D1 か R2 を指しています。止めました");
  }
  return env === "production" ? prod : prev;
}

async function openEnv(env, persistTo) {
  const wrangler = await import("wrangler");
  if (env === "local") {
    // local のつもりで本物に触れないよう、wrangler.jsonc に remote のバインディングがあれば止める
    const cfg = wrangler.unstable_readConfig({ config: join(repoRoot, "wrangler.jsonc") }, { hideWarnings: true });
    if ([...cfg.d1_databases, ...cfg.r2_buckets].some((b) => b.remote)) {
      throw new Error("wrangler.jsonc に remote のバインディングがあります。local では使えません。止めました");
    }
    const proxy = await wrangler.getPlatformProxy({
      configPath: join(repoRoot, "wrangler.jsonc"),
      persist: { path: join(resolve(persistTo ?? join(repoRoot, ".wrangler/state")), "v3") },
    });
    return { env: proxy.env, dispose: () => proxy.dispose() };
  }
  const { db, bucket } = await readTargets(wrangler, env);
  const dir = mkdtempSync(join(tmpdir(), "omoide-delete-family-"));
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "omoide-tsumugi-delete-family",
      compatibility_date: "2026-11-01",
      d1_databases: [{ binding: "DB", database_name: db.database_name, database_id: db.database_id, remote: true }],
      r2_buckets: [{ binding: "BUCKET", bucket_name: bucket.bucket_name, remote: true }],
    }),
  );
  try {
    const proxy = await wrangler.getPlatformProxy({ configPath, persist: false });
    return {
      env: proxy.env,
      dispose: async () => {
        await proxy.dispose();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function parseArgs(argv) {
  const usage =
    "使い方: node scripts/delete-family.mjs <local|preview|production> <家族 ID> [--delete --confirm <家族 ID>] [--allow-demo] [--persist-to <dir>]";
  const [env, familyId, ...rest] = argv;
  const opts = { env, familyId, delete: false, confirm: null, persistTo: null, allowDemo: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--delete") opts.delete = true;
    else if (a === "--confirm") opts.confirm = rest[++i] ?? "";
    else if (a === "--persist-to") opts.persistTo = rest[++i] ?? "";
    else if (a === "--allow-demo") opts.allowDemo = true;
    else return { error: `知らない引数があります\n${usage}` };
  }
  if (!ENVS.includes(env)) return { error: `環境は local / preview / production のどれかです\n${usage}` };
  if (!isFamilyId(familyId)) return { error: `家族 ID の形が違います（UUID の小文字）\n${usage}` };
  if (opts.persistTo !== null && env !== "local") return { error: "--persist-to は local のときだけ使えます" };
  if (opts.delete && opts.confirm !== familyId) {
    return { error: "消すときは、--confirm に同じ家族 ID をもう一度、完全に同じ形で書いてください" };
  }
  if (!opts.delete && opts.confirm !== null) return { error: "--confirm は --delete と一緒に使います" };
  return { opts };
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(parsed.error);
    return 2;
  }
  const { opts } = parsed;
  // 本番で消すのは、人間が自分の端末で打ったときだけ（Claude やサブエージェントからは、端末がないので止まる）
  const productionDelete = opts.env === "production" && opts.delete;
  if (productionDelete && !(process.stdin.isTTY && process.stdout.isTTY)) {
    console.error("本番で消すのは、人間が自分の端末で打つときだけです（端末からの入力がないので止めました）。数えるだけなら --delete を外してください");
    return 2;
  }
  const { env, dispose } = await openEnv(opts.env, opts.persistTo);
  try {
    const before = await countFamily(env, opts.familyId);
    console.log(formatCount(opts.env, before));
    if (!opts.delete) {
      if (isEmpty(before)) console.log("この家族の行もファイルもありません（ID の打ち間違いか、もう消えています）");
      return 0;
    }
    if (isEmpty(before)) {
      console.log("消すものがありません。何もしませんでした");
      return 0;
    }
    if (before.isDemo && !opts.allowDemo) {
      console.error("✗ デモの家族です。デモは /demo-reset で扱います（消すなら --allow-demo）");
      return 1;
    }
    if (productionDelete) {
      const typed = await ask("本番で消します。もう一度、家族 ID を打ってください: ");
      if (typed.trim() !== opts.familyId) {
        console.error("家族 ID が合いません。何も消していません");
        return 1;
      }
    }
    if (opts.env !== "local") console.log(`消し始める時刻（D1 の Time Travel の目安）: ${new Date().toISOString()}`);
    const r = await deleteFamily(env, opts.familyId, { log: (m) => console.log(m), allowDemo: opts.allowDemo });
    console.log("---- 消した後 ----");
    console.log(formatCount(opts.env, r.after));
    if (!isEmpty(r.after)) {
      console.error("✗ まだ残っています。もう一度同じコマンドを実行してください");
      return 1;
    }
    console.log("✓ D1 の行も R2 のファイルも 0 件になりました");
    if (before.isDemo === false) {
      console.log("残りの作業: 秘密の値 OPS_RECORD_FAMILIES からこの家族 ID を外す（人間が wrangler secret put で入れ直す）");
    }
    if (opts.env !== "local") {
      console.log("注意: D1 は Time Travel の保持期間のあいだ、過去の時点に戻せる状態が残ります。R2 は戻せません");
    }
    return 0;
  } finally {
    await dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      // メッセージだけを出す（行の中身は出さない）
      console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
