---
name: verify-deploy
description: GitHub からの自動デプロイの後に、プレビュー（develop）か本番（main）の URL で動作を確かめる。トップページ、写真の表示、Claude と文字起こしの呼び出しを確かめる。
argument-hint: "[preview|production]"
---

# デプロイ後の動作確認

対象: `$ARGUMENTS`（指定がなければ preview）

## 0. 準備

- URL は `wrangler.jsonc` と Cloudflare のダッシュボードを正とします。分からなければ人間に聞いてください
  - preview: develop のプレビューの URL
  - production: 本番の URL
- デプロイが終わっているかを確かめる。終わっていなければ、終わるまで待つ
  - `npx wrangler deployments list`（preview のときは `--env preview`）で、最新のデプロイが今のコミットであることを確かめる
  - 本番の確かめでは、書き込みをしない。読み取りと、ヘルスチェックだけにする

## 1. 確かめること

それぞれ、結果（通った／落ちた、ステータスコード、かかった時間）を記録します。

| # | 確かめること | やり方 |
|---|---|---|
| 1 | トップページが開く | `curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' <URL>/` が 200 |
| 2 | 合言葉なしでは写真が取れない | デモの家族の写真の URL を合言葉なしで開くと 401 か 403 |
| 3 | 写真が表示される | デモの家族の合言葉で、写真が 200 で返り、`content-type` が `image/*` |
| 4 | Claude の呼び出しが通る | ヘルスチェックの API（例: `/api/health/deep`）で、Claude が応答する |
| 5 | 文字起こしの呼び出しが通る | 同じヘルスチェックで、OpenAI の文字起こしが応答する |
| 6 | 毎朝の処理が登録されている | `wrangler.jsonc` の `triggers.crons` があり、ダッシュボードの Cron Triggers に出ている |

- 2 と 3 は、デモの家族で確かめます。実際の家族の合言葉は使いません
- 4 と 5 のヘルスチェックの API がまだない場合は、backend-developer に作ってもらいます。そのときの約束は次のとおりです
  - ヘルスチェック用の秘密の値で守る（誰でも呼べると費用がかかるため）
  - Claude には、とても短い入力で、Haiku を1回だけ呼ぶ
  - 文字起こしには、デモ用の短い録音（R2 の demo/ にあるもの）を1回だけ送る
  - 返すのは、通ったかどうかと、かかった時間だけ。キーや応答の中身は返さない
- 画面の見た目も確かめたい場合は、Playwright でスマホの画面の大きさで開いて、スクリーンショットを撮る

## 2. 報告

```
対象: preview / production（URL、コミットのハッシュ）
1 トップページ: OK 200 0.21s
2 合言葉なし: OK 403
…
落ちたもの: …（ログは `npx wrangler tail` で見る）
```

本番で落ちたものがあれば、すぐに人間に知らせてください。
