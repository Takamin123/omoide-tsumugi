# 0006 D1 の database_id を wrangler.jsonc に入れたままにし、clone した人はスクリプトで書き換える

- 日付: 2026-11-02
- 状態: 採用
- 決めた人: 人間

## 決めたこと

- wrangler.jsonc には、私たちの本番・プレビューの D1 の `database_id` を入れたままにする（公開するリポジトリでも）
- clone した人のために、`npm run setup:cloudflare`（`scripts/setup-cloudflare.mjs`）を用意する
  - wrangler.jsonc に書かれた名前で、D1 と R2 を自分のアカウントに作る。すでにあれば作らずに、その ID を使う
  - wrangler.jsonc の `database_id` だけを書き換える（コメントと並びはそのまま）。何度実行しても同じ結果になる。私たちのアカウントでは何も作らず、何も書き換えない
  - `--dry-run` で、何を作り、何を書き換えるかだけを表示する
- 手順は README.md の「自分で動かす」に短く書く

## 理由

- `database_id` は秘密の値ではない。読み書きには、そのアカウントのログインか API トークンが要る
- wrangler.jsonc を一つのままにしておけば、手元の `wrangler d1 …` も、デプロイ前の検査（[0005](0005-separate-preview-worker.md) の `scripts/assert-build-env.mjs`）も、今のまま使える

## 退けた案とその理由

- B: wrangler.jsonc をひな形から生成し、ID はビルド用の変数で渡す
  - wrangler.jsonc の中で環境変数を展開する仕組みが、公式ドキュメントに見当たらない
  - 手元で `wrangler d1 …` を打つたびに生成が要る。0005 のデプロイ前の検査も作り直しになる。壊れる場所が増える
- C: 自動作成（automatic provisioning。`database_id` を省く）
  - 手元からの deploy では、ID が wrangler.jsonc に書き戻される（結局リポジトリのファイルに入る）
  - GitHub 経由の deploy では、ID がリポジトリに戻らず、ダッシュボードでしか分からない
  - 同じ名前の D1 がすでにあるとき、それを使い直すのか、新しく作るのかが書かれていない

## 根拠にしたもの

- Wrangler の設定の "Automatic provisioning" の節: https://developers.cloudflare.com/workers/wrangler/configuration/

## 見直す条件

- wrangler.jsonc の中で環境変数を展開できるようになったとき
- 自動作成が、ID をリポジトリに書き戻さずに済み、同じ名前のものを使い直すと明記されたとき
