---
name: d1-migrate
description: D1 のマイグレーションを、手元 → プレビュー → 本番の順に適用する。drizzle のスキーマを変えたときに使う。本番に適用する前には、必ず人間の確認を取る。
argument-hint: "[local|preview|production]"
---

# D1 のマイグレーション

データベースの変更は取り返しがつきません。順番を飛ばさないでください。

## 前提

- 環境の名前、データベースの名前、マイグレーションのフォルダは、`wrangler.jsonc` と `drizzle.config.ts` を正とします。以下の `<DB>` と `--env` の値は、そこに書かれた値に読み替えてください
- プレビューは `--env preview`、本番は環境の指定なし（トップレベル）です。`<DB>` には、どちらの環境でも同じバインディングの名前 `DB` を使えます（データベースの名前は環境ごとに違う: `omoide-tsumugi-preview` / `omoide-tsumugi`）
- `wrangler d1 …` は、元の `wrangler.jsonc` を読み、`--env` に従います（ビルドの出力の設定は読みません）。一方、ビルドの後の `wrangler deploy` は `--env` を無視するので、デプロイには `npm run deploy:preview` / `npm run deploy:production` を使ってください（`docs/decisions/0005`）
- **注意**: プレビューと本番が同じ D1 を指していないか、最初に wrangler.jsonc で確かめてください（`database_id` が違うこと）。同じなら、プレビューへの適用が本番への適用になります。その場合は止めて、人間に知らせてください

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
   - 0003（`0003_member_links.sql`）を含むとき: 本番の有効なリンクがすべて取り消されること（`docs/decisions/0036`。開いている端末は新しいリンクで開き直しになる）
   - 先に `npx wrangler d1 execute <DB> --remote --command "SELECT id, is_demo, created_at FROM families"` で、本番の既存の家族を数えた結果（名前は出さない）
   - 本番の既存の家族は消す（人間の決定、2026-11-04）。消すのは 0005（`0005_musubi_guess.sql`）を適用する前。一つずつ `/delete-family production <家族 ID>`（デモの家族なら `--allow-demo`）で、人間が自分の端末で打つ。段取りの全体は `/parent-trial`
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
