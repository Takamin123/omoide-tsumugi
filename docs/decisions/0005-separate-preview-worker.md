# 0005 プレビューと本番で Worker・D1・R2 を分ける

- 日付: 2026-11-02
- 状態: 採用
- 決めた人: 人間

## 決めたこと

- プレビュー（develop）と本番（main）は、別の Worker にする。D1 と R2 も、それぞれ別のものを使う
  - 本番: wrangler.jsonc のトップレベル。Worker `omoide-tsumugi`、D1 `omoide-tsumugi`、R2 `omoide-tsumugi`
  - プレビュー: wrangler.jsonc の `env.preview`。Worker `omoide-tsumugi-preview`、D1 `omoide-tsumugi-preview`、R2 `omoide-tsumugi-preview`
- Workers Builds では、二つの Worker のそれぞれに、同じリポジトリをつなぐ
  - `omoide-tsumugi`: 本番のブランチは `main`。デプロイのコマンドは `npm run deploy:production`
  - `omoide-tsumugi-preview`: 本番のブランチは `develop`。デプロイのコマンドは `npm run deploy:preview`
  - どちらも「Enable Preview Builds」（本番以外のブランチのビルド）は切る
- deploy の直前に `scripts/assert-build-env.mjs` で、ビルドの出力が意図した環境のものかを確かめる。食い違ったら止める（実装の判断。下の「気をつけること」を参照）

## 理由

- develop の自動デプロイが、本番のデータ（実際の家族の写真・声・語り）に触れないようにするため

## 気をつけること（確かめて分かったこと）

- Vite の Cloudflare プラグインを使うので、環境は**ビルドのとき**に `CLOUDFLARE_ENV` で決まる。ビルドは、その環境に平らにした設定を `dist/` に書き、`.wrangler/deploy/config.json` からそこへ向ける
- `wrangler deploy`、`versions upload`、`versions deploy`、`triggers deploy`、`preview` は、この出力の設定を読み、**`--env preview` を付けても黙って無視する**。本番用のビルドの後に `wrangler deploy --env preview` を実行すると、本番の Worker・D1・R2 のまま上がる（wrangler 4.156.1 の `--dry-run` で確かめた）
  - このため、ビルドとデプロイを `npm run deploy:<環境>` の一つにまとめた。間に `scripts/assert-build-env.mjs` を挟み、次の場合に止める
    - ビルドの出力が wrangler.jsonc のその環境と違う
    - database_id が仮の値のまま
    - 本番とプレビューが、同じ Worker、D1、R2 を指している
    - Workers Builds が渡す Worker の名前（`WRANGLER_CI_OVERRIDE_NAME`）が、ビルドの出力と違う
- `wrangler d1 …`、`wrangler secret …`、`wrangler r2 …`、`wrangler deployments list` は、元の wrangler.jsonc を読み、`--env preview` に従う（d1 で確かめた。ほかは wrangler のソースで確かめた）

## 退けた案とその理由

- Worker を一つにして、develop を Workers Builds の「プレビューのバージョン」（Preview や Version URL）として上げる: バージョンは、その Worker のバージョンの設定とリソースを使い、ブランチごとに別のリソースを作らない。そのため、本番と同じ D1・R2 につながる恐れがある。また、Workers Previews の前から Builds につないでいた Worker は、本番の設定を使う古い形のままになる
- `wrangler deploy --env preview` をデプロイのコマンドにする（wrangler だけでビルドする場合の、ふつうのやり方）: Vite プラグインを使う構成では `--env` が効かない。上に書いたとおり

## 根拠にしたもの

- Wrangler の environments。環境ごとに `<name>-<env>` という別の Worker になり、bindings と vars は引き継がれない: https://developers.cloudflare.com/workers/wrangler/environments/
- Workers Builds の設定。環境の Worker のデプロイのコマンドには `--env` を付ける。Preview command、Version URL はその Worker のリソースを使う: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- 環境ごとの Worker に、リポジトリをそれぞれつなぐ: https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/
- 本番のブランチの設定と「Enable Preview Builds」: https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
- Worker の名前は wrangler の `name` と合わせる。`-<env>` の付いた名前なら環境の Worker として扱う。`WRANGLER_CI_OVERRIDE_NAME`: https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/
- Version URL はそのバージョンの設定とリソースを使う: https://developers.cloudflare.com/workers/configuration/previews/
- Vite プラグインでは、環境は `CLOUDFLARE_ENV` でビルドのときに選ぶ。`wrangler deploy` のときに指定しても効かない: https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/
- 手元での確かめ: `npm run build` の後の `npx wrangler deploy --dry-run --env preview` で、バインディングが `omoide-tsumugi`（本番）と表示された

## 見直す条件

- Vite プラグインか wrangler が、出力の設定に対して `--env` を受け付ける（または食い違いを止める）ようになったとき
- Workers Builds のブランチごとの設定で、ブランチごとに別のバインディングを、確実に持てるようになったとき
