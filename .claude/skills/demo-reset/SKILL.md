---
name: demo-reset
description: デモの家族（架空の三世代）を、デモ用の写真と録音済みの声を登録した状態に戻す。撮影の前や、デモで状態が変わった後に使う。実際の家族のデータには触れない。
argument-hint: "[local|preview|production]"
---

# デモの初期化

対象: `$ARGUMENTS`（指定がなければ local）

## 約束

- デモの家族は、実際の家族とは**別の家族**として持つ。初期化で消して作り直すのは、デモの家族のデータだけ
- デモ用の写真と録音は、リポジトリに入れない（`docs/decisions/0004`）。R2 の `demo/seed/` に置き、初期化のたびにそこから写す
- アプリの画面の「デモを初期化」ボタンも、このスキルも、**同じ API を呼ぶ**。処理を二つに分けない

## アプリ側に必要なもの（なければ backend-developer に作ってもらう）

- `POST /api/demo/reset`（名前は実装を正とする）
  - デモ用の秘密の値で守る
  - デモの家族の ID が決め打ちであることを確かめてから、その家族の語り・入り口・アルバム・R2 のファイルを消す
  - `demo/seed/` の写真と録音を、デモの家族の場所に写す。架空の三世代の家族、写真、録音済みの語りを登録する
  - 最後に、毎朝の処理と同じ関数を呼んで、今日の入り口を作る
- デモ用の家族の中身（人物、語りの文字）は、架空のものとしてソースに置いてよい。写真と録音のファイルだけは R2 に置く

## 手順

### 1. 素材が R2 にあるか確かめる（初回と、素材を替えたとき）

- 素材の元のファイルは、リポジトリの**外**に置く（例: `~/omoide-demo-seed/`）。場所は人間に聞く
- アップロードする

```bash
npx wrangler r2 object put <BUCKET>/demo/seed/<ファイル名> --file ~/omoide-demo-seed/<ファイル名>        # 本番
npx wrangler r2 object put <BUCKET>/demo/seed/<ファイル名> --file ~/omoide-demo-seed/<ファイル名> --local # 手元
```

- `<BUCKET>` は wrangler.jsonc を正とする。preview では `--env preview` を付ける

### 2. 初期化を呼ぶ

```bash
# local（開発サーバーを動かしておく）
curl -sS -X POST http://localhost:8787/api/demo/reset -H "Authorization: Bearer $DEMO_RESET_TOKEN"

# preview / production
curl -sS -X POST <URL>/api/demo/reset -H "Authorization: Bearer $DEMO_RESET_TOKEN"
```

- `DEMO_RESET_TOKEN` の値は、`/setup-secrets` で登録したもの。会話の中に値を貼らない。人間に `! ` を付けて実行してもらうか、手元の `.dev.vars` から読む
- production では、デモの家族だけが消えることを、実行の前に人間に確かめてもらう

### 3. 確かめる

- デモの家族の合言葉で開いて、家族の三世代、写真、録音済みの語り、今日の入り口が出ていることを確かめる
- 実際の家族の数とデータが変わっていないことを確かめる（初期化の前と後で、家族の一覧の件数を比べる）
