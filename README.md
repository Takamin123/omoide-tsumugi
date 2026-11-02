# おもいでつむぎ

離れて暮らす家族が、アルバムを囲むように思い出を語り合える場。

- 家族それぞれのスマホに眠っている写真の中から、Claude が一人ひとりのために「今日の入り口」を作る
- 入り口を開いた後は、家族同士が直接やり取りする。AI は割り込まない
- AI は黙って語りを記録し、翌日の入り口に活かす
- 語りが積み重なると、思いの重さで編まれた「深さを持ったアルバム」になる

ドキュメント

- 要件と守る方針: [docs/requirements.md](docs/requirements.md)
- 基本仕様: [docs/spec.md](docs/spec.md)
- なぜそう決めたか: [docs/decisions/](docs/decisions/)

## 自分で動かす

自分の Cloudflare アカウントに、本番（`main`）とプレビュー（`develop`）の二つの Worker を作ります（[0005](docs/decisions/0005-separate-preview-worker.md)）。

### 必要なもの

- Node.js 22 以上
- Cloudflare のアカウント（R2 は、ダッシュボードの R2 の画面で使い始める手続きをしておく）
- Anthropic の API キー、OpenAI の API キー

### 1. 準備

```bash
npm install
git config core.hooksPath .githooks   # コミット前の検査（写真・録音・秘密の値を止める）
npx wrangler login
```

### 2. D1 と R2 を作り、wrangler.jsonc を自分のものにする

```bash
npm run setup:cloudflare -- --dry-run   # 何を作り、何を書き換えるかを見るだけ
npm run setup:cloudflare
```

- wrangler.jsonc に書かれた名前で、D1 と R2 を作ります。すでにあれば、それを使います。何度実行しても同じ結果になります
- wrangler.jsonc の `database_id` が、自分の D1 のものに書き換わります。これを自分のリポジトリにコミットしてください（秘密の値ではありません。[0006](docs/decisions/0006-cloudflare-ids-in-repo.md)）
- 名前を変えたいときは、先に wrangler.jsonc の `name`、`database_name`、`bucket_name` を直してから実行します
- アカウントが複数あるときは、`CLOUDFLARE_ACCOUNT_ID=<ID> npm run setup:cloudflare` のように指定します

### 3. 秘密の値を登録する

名前の一覧は [.dev.vars.example](.dev.vars.example) です。値はリポジトリに入れません。

```bash
cp .dev.vars.example .dev.vars              # 手元用。エディタで値を書く
npx wrangler secret put ANTHROPIC_API_KEY --env preview   # プレビュー。値は対話の画面で入力する
npx wrangler secret put ANTHROPIC_API_KEY                 # 本番
```

- ほかの名前も同じように登録します。プレビューと本番では、できれば別のキーを使います
- Worker がまだないときは、作るかを聞かれます。作ってください

### 4. D1 のマイグレーションを適用する

```bash
npx wrangler d1 migrations apply DB --env preview --remote   # プレビュー
npx wrangler d1 migrations apply DB --remote                 # 本番
```

### 5. 最初の deploy

```bash
npm run deploy:preview
npm run deploy:production
```

`wrangler deploy --env preview` は使わないでください。この構成では `--env` が効かず、本番に上がります（[0005](docs/decisions/0005-separate-preview-worker.md)）。

### 6. GitHub からの自動デプロイ（Workers Builds）

ダッシュボードで、二つの Worker のそれぞれに、同じリポジトリをつなぎます。

| Worker | 本番のブランチ | デプロイのコマンド |
|---|---|---|
| `omoide-tsumugi` | `main` | `npm run deploy:production` |
| `omoide-tsumugi-preview` | `develop` | `npm run deploy:preview` |

- どちらも「Enable Preview Builds」は切ります
- 名前を変えたときは、Worker の名前も wrangler.jsonc に合わせて読み替えてください
