---
name: d1-migrate
description: D1 のマイグレーションを、手元 → プレビュー → 本番の順に適用する。drizzle のスキーマを変えたときに使う。本番に適用する前には、必ず人間の確認を取る。
argument-hint: "[local|preview|production]"
---

# D1 のマイグレーション

データベースの変更は取り返しがつきません。順番を飛ばさないでください。

## 前提

- 環境の名前、データベースの名前、マイグレーションのフォルダは、`wrangler.jsonc` と `drizzle.config.ts` を正とします。以下の `<DB>` と `--env` の値は、そこに書かれた値に読み替えてください
- 以下の手順は、プレビューを `--env preview`、本番を環境の指定なし（トップレベル）とする想定で書いています。違っていたら、wrangler.jsonc に合わせてください
- **注意**: プレビューと本番が同じ D1 を指していないか、最初に wrangler.jsonc で確かめてください。同じなら、プレビューへの適用が本番への適用になります。その場合は止めて、人間に知らせてください

## 1. マイグレーションのファイルを作る

```bash
npx drizzle-kit generate
```

- 作られた SQL を読む。`DROP`、列の削除、型の変更、`NOT NULL` の追加があれば、データが消えないかを確かめる
- データが消える変更なら、ここで止めて人間に知らせる

## 2. 手元に適用する

```bash
npx wrangler d1 migrations apply <DB> --local
```

- 手元で開発サーバーを動かして、関係する画面と API を確かめる
- テストを通す

## 3. プレビューに適用する

```bash
npx wrangler d1 migrations list <DB> --env preview --remote   # 未適用のものを確かめる
npx wrangler d1 migrations apply <DB> --env preview --remote
```

- develop をプッシュしてプレビューにデプロイされたら、`/verify-deploy preview` で確かめる

## 4. 本番に適用する（必ず人間の確認を取る）

**ここから先は、人間の確認なしに進めてはいけません。**

1. 次のことを人間に示して、適用してよいかを聞く
   - 適用するマイグレーションのファイル名と、SQL の中身
   - データが消える変更があるかどうか
   - プレビューで確かめた結果
2. 了解をもらってから実行する

```bash
npx wrangler d1 migrations list <DB> --remote
npx wrangler d1 migrations apply <DB> --remote
```

- コマンドを実行すると、Claude Code のフックが確認の画面を出します。それとは別に、上の1で必ず先に聞いてください
- サブエージェントとして動いている場合は、本番には適用しないでください。プレビューまでで止め、「本番への適用を人間に頼む必要がある」と報告して返してください
- 適用したら、main をデプロイした後に `/verify-deploy production` で確かめる

## うまくいかなかったとき

- D1 の Time Travel で、過去の時点に戻せます（`npx wrangler d1 time-travel info <DB>`、`restore`）。本番を戻すときも、人間の確認を取ってから行ってください
