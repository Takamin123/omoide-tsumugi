---
name: setup-secrets
description: Claude、OpenAI、R2 などのキーを、リポジトリに入れずに Workers に登録する（手元用・プレビュー用・本番用）。新しい秘密の値を足すとき、キーを取り替えるときに使う。
argument-hint: "[local|preview|production] [名前]"
---

# 秘密の値の設定

## 大事な約束

- **キーの値を、会話・コマンドの引数・ファイル（`.dev.vars` 以外）に書かない**
- 値は人間に入力してもらう。Claude は、人間が打つコマンドを示すだけにする。人間はプロンプトに `! ` を付けて実行すれば、その場で値を入力できる
- `.dev.vars` と `.env` は git の管理から外してあり、コミットのフックでも止まる

## 秘密の値の一覧

名前の一覧は `.dev.vars.example` を正とします（値は空）。新しい秘密の値を足すときは、まず `.dev.vars.example` に名前を足してください。

| 名前 | 使い道 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude の呼び出し |
| `OPENAI_API_KEY` | 文字起こし（gpt-transcribe） |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` | R2 の署名付き URL を作る（S3 互換の API）。Workers から合言葉を確かめて返すだけなら要らない |
| `DEMO_RESET_TOKEN` | デモの初期化の API を守る |
| `HEALTHCHECK_TOKEN` | デプロイ後の確かめの API を守る |

R2 のバケットそのものは、秘密の値ではなく、`wrangler.jsonc` の `r2_buckets` のバインディングでつなぎます。

## 手元（local）

```bash
cp .dev.vars.example .dev.vars
```

- 人間に、エディタで `.dev.vars` を開いて値を書いてもらう
- 手元とプレビューで値を分けたいときは、`.dev.vars.<環境名>` を使える（これも git の管理から外してある）

## プレビュー（preview）と本番（production）

人間に、次のコマンドを打ってもらいます。値は対話の画面で入力します。

```bash
! npx wrangler secret put ANTHROPIC_API_KEY --env preview   # プレビュー
! npx wrangler secret put ANTHROPIC_API_KEY                 # 本番（環境の指定なし）
```

- 環境の名前は `wrangler.jsonc` を正とします
- プレビューと本番では、できれば別のキーを使う。デモで使いすぎても、本番が止まらないようにするため
- 登録した後に、名前だけを確かめる（値は表示されない）

```bash
npx wrangler secret list --env preview
npx wrangler secret list
```

## GitHub からの自動デプロイ

- 実行時の秘密の値は、上の `wrangler secret put` で Workers 側に入っていれば足ります。GitHub のリポジトリには登録しません
- ビルドのときに値が要る場合だけ、Cloudflare のダッシュボードの Workers Builds の設定で、ビルド用の変数として登録します

## キーが漏れたかもしれないとき

1. すぐに、発行元（Anthropic Console、OpenAI、Cloudflare）でキーを無効にする
2. 新しいキーを作り、上の手順で登録し直す
3. 漏れたのがコミットの中なら、人間に知らせる。履歴の書き換えは、人間が判断する
