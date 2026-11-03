#!/usr/bin/env node
// 市区町村の代表点の一覧（src/server/core/places-data.ts）を作る。0047
//
// 元のデータ: Geolonia 住所データ（japanese-addresses-v2）の api/ja.json
//   https://japanese-addresses-v2.geoloniamaps.com/api/ja.json
//   「アドレス・ベース・レジストリ」（デジタル庁）をもとに株式会社 Geolonia が作成。CC BY 4.0
//   https://github.com/geolonia/japanese-addresses-v2
//
// 使い方（ダウンロードしたファイルは作業ツリーの外に置く。リポジトリには入れない）:
//   curl -sS -o <置き場所>/ja.json https://japanese-addresses-v2.geoloniamaps.com/api/ja.json
//   node scripts/build-places.mjs <置き場所>/ja.json
//
// 出すのは、都道府県の名前・市区町村の名前・政令市の区の名前・代表点（小数第 3 位、約 100 m に丸める）だけ。
// 読み仮名、ローマ字、コードは捨てる（バンドルを小さくするため）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/build-places.mjs <ja.json>");
  process.exit(2);
}
const out = fileURLToPath(new URL("../src/server/core/places-data.ts", import.meta.url));

const json = JSON.parse(readFileSync(src, "utf8"));
const prefs = [];
const rows = [];
/** 1 行に一つ: 都道府県の番号|市区町村|区|緯度×1000|経度×1000。区がなければ空 */
const clean = (s) => {
  if (typeof s !== "string" || /[|\n]/.test(s)) throw new Error(`bad name: ${s}`);
  return s;
};
for (const p of json.data) {
  const pi = prefs.push(clean(p.pref)) - 1;
  for (const c of p.cities) {
    const [lng, lat] = c.point ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`no point: ${p.pref}${c.city}`);
    rows.push([pi, clean(c.city), c.ward ? clean(c.ward) : "", Math.round(lat * 1000), Math.round(lng * 1000)].join("|"));
  }
}
const updated = new Date(json.meta.updated * 1000).toISOString().slice(0, 10);

const ts = `// このファイルは scripts/build-places.mjs が作る。手で直さない。0047
//
// 市区町村（政令市は区ごと）の代表点の一覧。地名をサーバーで引くためだけに使い、Claude には渡さない。
// 出典: Geolonia 住所データ（https://github.com/geolonia/japanese-addresses-v2）。
//   「アドレス・ベース・レジストリ」（デジタル庁）をもとに株式会社 Geolonia が作成したもの。CC BY 4.0
//   （https://creativecommons.org/licenses/by/4.0/deed.ja）。
//   変更: 読み仮名・ローマ字・コードを除き、代表点を小数第 3 位に丸め、一行の形に並べ替えた。
// 元のデータの更新日: ${updated}（${rows.length} 件）

export const PLACES_UPDATED = ${JSON.stringify(updated)};

export const PREFECTURES: readonly string[] = ${JSON.stringify(prefs)};

/** 1 行に一つ: 都道府県の番号|市区町村|区（政令市のときだけ）|緯度×1000|経度×1000 */
export const PLACES_TSV = ${JSON.stringify(rows.join("\n"))};
`;
writeFileSync(out, ts);
console.log(`wrote ${out}: ${prefs.length} prefectures, ${rows.length} places, ${Buffer.byteLength(ts)} bytes`);
