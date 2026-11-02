#!/usr/bin/env node
// deploy の直前に、ビルドの出力が、意図した環境（production / preview）のものかを確かめる。
//
// なぜ要るか: Vite プラグインでは、環境はビルドのとき（CLOUDFLARE_ENV）に決まる。
// その後の `wrangler deploy` は、ビルドが出力した設定（.wrangler/deploy/config.json の先）を読み、
// `--env preview` を付けても黙って無視する（wrangler 4.156 で確かめた）。
// 取り違えると、プレビューの Worker が本番の D1・R2 につながる。docs/decisions/0005-separate-preview-worker.md
//
// 使い方: node scripts/assert-build-env.mjs <production|preview>
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { unstable_readConfig } from "wrangler";

const target = process.argv[2];
if (target !== "production" && target !== "preview") {
  console.error("使い方: node scripts/assert-build-env.mjs <production|preview>");
  process.exit(2);
}

const fail = (msg) => {
  console.error(`✗ deploy を止めました: ${msg}`);
  process.exit(1);
};

// unstable_readConfig は env を省くと CLOUDFLARE_ENV を見る。本番の設定を読むときに preview にならないよう、外す。
// （ビルドの環境は、すでに出力の設定に入っている。ここでは引数の target だけを信じる）
delete process.env.CLOUDFLARE_ENV;

// 元の設定（wrangler.jsonc）から、その環境で期待する値を読む
const expected = unstable_readConfig(
  { config: "wrangler.jsonc", env: target === "preview" ? "preview" : undefined },
  { hideWarnings: true },
);

// ビルドの出力の設定を読む
const deployConfigPath = resolve(".wrangler/deploy/config.json");
let built;
try {
  const { configPath } = JSON.parse(readFileSync(deployConfigPath, "utf8"));
  built = JSON.parse(readFileSync(resolve(dirname(deployConfigPath), configPath), "utf8"));
} catch (e) {
  fail(`ビルドの出力の設定が読めません（先に vite build を実行する）: ${e.message}`);
}

const pick = (c) => ({
  name: c.name,
  APP_ENV: c.vars?.APP_ENV,
  d1: (c.d1_databases ?? []).map((d) => `${d.binding}=${d.database_name}/${d.database_id}`).sort(),
  r2: (c.r2_buckets ?? []).map((b) => `${b.binding}=${b.bucket_name}`).sort(),
  crons: [...(c.triggers?.crons ?? [])].sort(),
});
const want = pick(expected);
const got = pick(built);

// 本番とプレビューが、同じ D1・R2・Worker を指していないか（database_id とバケット名で比べる）
const otherConfig = unstable_readConfig(
  { config: "wrangler.jsonc", env: target === "preview" ? undefined : "preview" },
  { hideWarnings: true },
);
const resources = (c) => [
  `Worker=${c.name}`,
  ...(c.d1_databases ?? []).map((d) => `D1=${d.database_id}`),
  ...(c.r2_buckets ?? []).map((b) => `R2=${b.bucket_name}`),
];
const shared = resources(expected).filter((x) => resources(otherConfig).includes(x));
if (shared.length > 0) fail(`本番とプレビューが同じものを指しています: ${shared.join(", ")}`);

if (want.APP_ENV !== target) fail(`wrangler.jsonc の ${target} の vars.APP_ENV が "${want.APP_ENV}" です`);
if (JSON.stringify(want) !== JSON.stringify(got)) {
  fail(
    `ビルドの出力が ${target} のものではありません。` +
      `${target === "preview" ? "CLOUDFLARE_ENV=preview " : ""}vite build でビルドし直してください。\n` +
      `  期待: ${JSON.stringify(want)}\n  実際: ${JSON.stringify(got)}`,
  );
}
if (got.d1.some((d) => d.includes("REPLACE_WITH_"))) {
  fail("D1 の database_id が仮の値のままです。`wrangler d1 create` の結果で wrangler.jsonc を書き換えてください");
}

// Workers Builds は、つないだ Worker の名前を WRANGLER_CI_OVERRIDE_NAME で渡し、name を上書きする。
// 本番の Worker に preview のビルドを（またはその逆を）上げないよう、名前が合っているかも確かめる。
const ciName = process.env.WRANGLER_CI_OVERRIDE_NAME;
if (ciName && ciName !== got.name) {
  fail(`Workers Builds の Worker（${ciName}）と、ビルドの出力の名前（${got.name}）が合いません`);
}

console.log(`✓ ${target} のビルドです（Worker: ${got.name}、D1: ${got.d1.join(", ")}、R2: ${got.r2.join(", ")}）`);
