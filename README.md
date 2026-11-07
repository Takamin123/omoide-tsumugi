# おもいでつむぎ

思い出を、家族で少しずつ紡ぐ。

地方で暮らす年老いた親と、都会で暮らす子や孫。離れて暮らす家族が、思い出を語り合う機会をなくしている。

- スマホのおかげで、写真は昔よりずっと手軽になった。けれど、写真を囲んで語り合う場は減った。同じ日の写真が、家族一人ひとりのスマホにばらばらに眠っている
- 離れた親との電話は、近況と用件で終わりがちだ
- 日本の家族は、思っていることをなかなか口にしない。親に「昔の話を聞かせて」と頼むのは、どこか照れくさい

おもいでつむぎは、離れて暮らす家族が、写真を囲んで思い出を語り合える場です。毎朝、Claude が家族一人ひとりに、思い出話のきっかけとして、写真を一枚と、問いかけを一つ届けます。

- 写真は、家族がそれぞれのスマホから選んで入れる。Claude はその中から一枚を選び、家族の言葉を添える
- 問いかけには、声でも文字でも答えられる。届いた後は、家族同士が直接やり取りする。AI は割り込まず、黙って語りを記録して翌日の問いかけに活かす
- 語りが積み重なると、深さを持ったアルバムになる。家族それぞれの記憶にある思い出が、少しずつつむぎあい、また新しい思い出になる

## デモ動画

準備中（動画に登場する家族は架空の設定で、声は作者によるものです）

## 使われ方の例

架空の家族の例です。

1. お母さんが、2019 年の伊勢の旅で撮った大きな木の写真に書き込む。「二日目の朝、大きな木の前で長いこと手を合わせてた父に、何をお願いしたのか聞いたら、内緒って笑ってた。」
2. 翌朝、じいちゃんのタブレットに、その写真と、お母さんの言葉と、Claude が作った問いかけが届く
3. じいちゃんが声で答える。「あのときお願いしたのはな、みんなが元気で、また一緒に旅行できますように、って。今だから言うけど」
4. お母さんのスマホの「返事」に、じいちゃんの声と文字が届く

7 年間の「内緒」が、写真一枚と、お母さんの一言でほどけます。

## できること

- **写真を入れる**: スマホのブラウザから登録する。ブラウザ側で縮小し、撮影日と位置情報を読み取って、写真に「三重県伊勢市あたり」のように添える
- **写真と問いかけが届く**: 毎朝 3:00（日本時間）の定期処理で、一人ひとりに、写真、写真のどこから見せるか、添える家族の言葉、問いかけを用意する
- **声か文字で答える**: 声は文字に起こし、話す人ごとの話し方や方言を考慮して整える。話した声は、声と文字の両方で家族に届く
- **問いかけを聞く**: 問いかけを AI の声で読み上げる
- **家族同士でやり取りする**: 自分の語りへの返事や、自分の写真に寄せられた語りが「返事」のタブに届く
- **アルバムで振り返る**: 家族の言葉を読み進めると、写真も一緒にめくれていく。写真を眺めるだけでなく、家族の言葉と一緒に思い出をたどれる
- **一人ずつのリンクで入る**: 招待のリンクを開くと、その人として使える。祖父母のタブレットなどには、文字の大きな画面を用意している

## Claude の役割

Claude が手伝うのは、写真を選んで、届ける相手を決めて、家族の言葉と問いかけを添えるところまでです。話すのは、家族です。

| 仕事 | モデル | 内容 |
|---|---|---|
| 写真と問いかけづくり | Claude Sonnet 5.5 | 誰に、どの写真を、どの言葉を添えて届けるかを決め、問いかけを作る |
| むすびの推測 | Claude Sonnet 5.5 | 同じ出来事の写真どうしのつながりを推測する。写真と問いかけを選ぶ材料にする |
| 写真の整理 | Claude Haiku 5.5 | 写真の内容の短い説明を作る。家族には見せず、写真と問いかけを選ぶ材料にする |
| 文字起こしの整形 | Claude Haiku 5.5 | 文字起こしを読みやすく整える |
| 記録の取り出し | Claude Haiku 5.5 | 語りから、人・場所・時期・出来事を指す部分を取り出す |

Claude は、写真と問いかけを選んだ理由も書きます。理由は運営の記録の画面（`/ops/record`）に残し、家族には見せません。

文字起こしには OpenAI の `gpt-transcribe`、読み上げには `gpt-4o-mini-tts` を使います。

## 守っていること

- AI は雑談や相づちをせず、家族同士の会話に割り込まない
- 写真を求めず、思い出を聞く。「覚えていますか」と試さず、正解のない問いかけにする
- 家族が語ったことと Claude の推測を分けて記録する。推測は問いかけの形でしか使わない
- 家族に見せる言葉は、家族が実際に語った言葉を中心にする
- 写真と録音は非公開で保存し、合言葉を確かめた家族にだけ返す
- 写真と語りは Claude API に、録音と家族の呼び名、読み上げる問いかけの文は OpenAI の API に送って処理する
- 実際の家族の写真・声・データはリポジトリに入れない。コミット前のフックでも止める
- メンタルケアや医療アドバイスに見える機能、治療や効果をうたう言葉は作らない

## 技術構成

| 役割 | 使うもの |
|---|---|
| 実行環境 | Cloudflare Workers、Cron Triggers |
| バックエンド | Hono |
| フロントエンド | React（スマホで開く Web アプリ） |
| データベース | Cloudflare D1、drizzle-orm |
| 写真と録音 | Cloudflare R2（非公開） |
| AI | Claude API、OpenAI API |

## 手元で動かす

必要なもの:

- Node.js 22.12 以上（22 系または 24 系）
- Anthropic の API キー、OpenAI の API キー

```bash
npm install
git config core.hooksPath .githooks   # コミット前の検査（写真・録音・秘密の値を止める）
cp .dev.vars.example .dev.vars        # エディタで値を書く
npx wrangler d1 migrations apply DB --local
npm run dev
```

`.dev.vars` には、少なくとも `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`CREATE_FAMILY_TOKEN` を書きます。値はリポジトリに入れません。

`http://localhost:5173/start` を開き、`CREATE_FAMILY_TOKEN` の値を入れて家族を作ります。最初の人のリンクは一度だけ表示されます。

デモの家族を初期状態に戻す機能には、リポジトリの外にある写真と録音を R2 の `demo/seed/` に置く必要があります。これらは公開していないので、clone しただけでは使えません。

### テスト

```bash
npm test
npm run typecheck
```

## 自分の Cloudflare に置く

本番（`main`）とプレビュー（`develop`）の二つの Worker を作ります（[0005](docs/decisions/0005-separate-preview-worker.md)）。

追加で必要なもの:

- Cloudflare の有料プラン（無料プランの外部リクエスト数では毎朝の処理が収まりません）
- R2 を使い始める手続き（ダッシュボードの R2 の画面から）

### 1. ログイン

```bash
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

名前の一覧は [.dev.vars.example](.dev.vars.example) です。

```bash
npx wrangler secret put ANTHROPIC_API_KEY --env preview   # プレビュー。値は対話の画面で入力する
npx wrangler secret put ANTHROPIC_API_KEY                 # 本番
```

- `OPENAI_API_KEY` と `CREATE_FAMILY_TOKEN` も同じように登録します。プレビューと本番では、できれば別のキーを使います
- デモ用の `DEMO_RESET_TOKEN`、`DEMO_GUIDE_KEY`、`DEMO_GUIDE_LINKS` は、本番には登録しません
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

`wrangler secret` と `wrangler d1` には `--env preview` が効きますが、`wrangler deploy --env preview` は効かず、本番に上がります。デプロイには必ず上のコマンドを使ってください（[0005](docs/decisions/0005-separate-preview-worker.md)）。

### 6. GitHub からの自動デプロイ（Workers Builds）

ダッシュボードで、二つの Worker のそれぞれに、同じリポジトリをつなぎます。

| Worker | 本番のブランチ | デプロイのコマンド |
|---|---|---|
| `omoide-tsumugi` | `main` | `npm run deploy:production` |
| `omoide-tsumugi-preview` | `develop` | `npm run deploy:preview` |

- どちらも「Enable Preview Builds」は切ります
- 名前を変えたときは、Worker の名前も wrangler.jsonc に合わせて読み替えてください

## これから

施設で暮らす祖父母と、離れて暮らす家族にも届けていきたいと考えています（まだ実現していません）。

## ドキュメント

- 要件と守る方針: [docs/requirements.md](docs/requirements.md)
- 基本仕様: [docs/spec.md](docs/spec.md)
- 実装の方針: [docs/implementation-policy.md](docs/implementation-policy.md)
- なぜそう決めたか: [docs/decisions/](docs/decisions/)
- プロンプトやモデルの出し比べの記録: [docs/evals/](docs/evals/)

## ライセンス

[MIT](LICENSE)

## 出典

写真の場所の名前（「三重県伊勢市あたり」）は、Geolonia 住所データ（[japanese-addresses-v2](https://github.com/geolonia/japanese-addresses-v2)）から引いています。このデータは「[アドレス・ベース・レジストリ](https://dataset.address-br.digital.go.jp)」（デジタル庁）をもとに株式会社 Geolonia が作成したもので、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja) で公開されています。データ自体はリポジトリに入れず、`npm install` の後とデプロイの前に取得して加工します。MIT ライセンスの対象には含まれません。詳しくは [0047](docs/decisions/0047-photo-date-place.md) を参照してください。
