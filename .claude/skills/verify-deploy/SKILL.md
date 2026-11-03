---
name: verify-deploy
description: GitHub からの自動デプロイの後に、プレビュー（develop）か本番（main）の URL で動作を確かめる。トップページ、写真の表示、Claude と文字起こしの呼び出しを確かめる。
argument-hint: "[preview|production]"
---

# デプロイ後の動作確認

対象: `$ARGUMENTS`（指定がなければ preview）

## 0. 準備

- URL は `wrangler.jsonc` と Cloudflare のダッシュボードを正とします。分からなければ人間に聞いてください
  - preview: develop をデプロイした Worker `omoide-tsumugi-preview` の URL
  - production: main をデプロイした Worker `omoide-tsumugi` の URL
  - プレビューと本番は別の Worker で、D1・R2 も別（`docs/decisions/0005`）
- デプロイが終わっているかを確かめる。終わっていなければ、終わるまで待つ
  - `npx wrangler deployments list`（preview のときは `--env preview`）で、最新のデプロイが今のコミットであることを確かめる
  - 本番の確かめでは、書き込みをしない。読み取りと、ヘルスチェックだけにする

## 1. 確かめること

それぞれ、結果（通った／落ちた、ステータスコード、かかった時間）を記録します。

| # | 確かめること | やり方 |
|---|---|---|
| 1 | トップページが開く | `curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' <URL>/` が 200 |
| 2 | 合言葉なしでは写真が取れない（preview だけ） | デモの家族の写真の URL を合言葉なしで開くと 401 か 403 |
| 3 | 写真が表示される（preview だけ） | デモの家族の合言葉で、写真が 200 で返り、`content-type` が `image/*` |
| 4 | Claude の呼び出しが通る | 毎朝の処理のログ `morning_done` で `byClaude` が 1 以上（下の「Claude と読み上げの確かめ」） |
| 5 | 読み上げ（OpenAI）の呼び出しが通る | 同じ `morning_done` で `speech.made` が 1 以上 |
| 6 | 毎朝の処理が登録されている | `wrangler.jsonc` の `triggers.crons` があり、ダッシュボードの Cron Triggers に出ている |
| 7 | 環境を取り違えていない | ダッシュボードで、その Worker のバインディングの D1・R2 が、その環境のもの（preview なら `omoide-tsumugi-preview`）になっている |

- 2 と 3 は、デモの家族で確かめます。実際の家族の合言葉は使いません。本番にはデモの家族を置かない（人間の決定、2026-11-04）ので、本番では 1・6・7 と、下の翌朝のログだけを確かめます

### Claude と読み上げの確かめ（4 と 5）

Claude や文字起こしを呼んで確かめる専用の入り口（ヘルスチェックの奥の段）は作っていません。`GET /api/health` は、通ったことだけを返します。代わりに、毎朝の処理のログで確かめます。

- preview: デモの家族の時計を進めて（デモの帯の時計のボタンを、翌朝になるまで押す）、毎朝の処理を走らせる。ダッシュボードの Workers Logs か `npx wrangler tail --env preview` で `morning_done` を探し、`byClaude` が 1 以上、`speech.made` が 1 以上であることを見る。`fallbacks` に `not_configured` があればキーがない
  - 本物の Claude と読み上げを呼ぶ（費用がかかる）。一度で足りる
- production: 書き込みをしないので、時計は進めない。日本時間 3:00 の Cron の `morning_done` を、ダッシュボードの Workers Logs で見る
  - 家族がいない朝や、家族を作った初日（全員が固定の入り口）は、`byClaude` も `speech.made` も 0 になる（`speech.made` は Claude の入り口にだけ数える）。それは失敗ではない。その間は、`morning_done` が出ていること、`families` の数、`fallbacks` の理由に `not_configured` がないことだけを見る
  - 4・5 を見るのは、語りのある家族ができた後の朝（親の試しでは、作り手が写真を入れて語りを一つ残した翌朝以降）
- 文字起こしは、声の語りを一つ送ると背景で走る。preview で確かめるときは、デモの家族で声を一つ送り、アルバムに文字が出ることを見る（本番では送らない）
- 画面の見た目も確かめたい場合は、Playwright でスマホの画面の大きさで開いて、スクリーンショットを撮る

## 2. 報告

```
対象: preview / production（URL、コミットのハッシュ）
1 トップページ: OK 200 0.21s
2 合言葉なし: OK 403（production では「対象外」と書く。3 も同じ）
…
落ちたもの: …（ログは `npx wrangler tail` で見る）
```

本番で落ちたものがあれば、すぐに人間に知らせてください。
