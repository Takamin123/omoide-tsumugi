# 基本仕様

骨格だけを書く。詳細はソースを正とする。

## 技術構成

| 役割 | 使うもの | 理由 |
|---|---|---|
| 実行環境 | Cloudflare Workers（有料プラン前提。一回の処理で外へ出せるリクエストが 10,000 まで。無料の 50 では毎朝の処理が収まらない。2026-11-03 人間が決定） | [0002](decisions/0002-cloudflare-workers.md) |
| バックエンド | Hono | |
| フロントエンド | React（スマホ向け Web アプリ） | |
| データベース | Cloudflare D1 + drizzle-orm | |
| 写真と録音 | Cloudflare R2（非公開） | |
| 定期処理 | Cron Triggers（毎朝 3:00（日本時間）に今日の一枚を作る。本番もプレビューも `0 18 * * *`） | [0027](decisions/0027-parent-trial-lines.md) |
| 写真の縮小 | ブラウザ側で縮小してから送る。撮影日と位置情報は縮小の前に exifr で読む | [0003](decisions/0003-browser-side-resize.md) |
| 文字起こし | OpenAI gpt-transcribe（話す人ごとの方言を prompt に入れる） | |
| 問いかけの読み上げ | OpenAI gpt-4o-mini-tts（試しの段階。毎朝の処理で作って R2 に置き、押して聞く） | [0019](decisions/0019-read-question-aloud-trial.md)、[0029](decisions/0029-question-speech-in-morning.md) |
| Claude | 整理と整形は Haiku 5.5。入り口づくりなどの判断は Sonnet 5.5（必要なら Opus 5.5） | |

## 構造の約束

- データベースと写真の保存は、差し替えられる形（インターフェースの背後）にする。さくらの VPS（Node.js、better-sqlite3、ローカルのファイル保存）に切り替えられるようにするため。→ [0002](decisions/0002-cloudflare-workers.md)
- 写真と録音は、署名付き URL で返すか、Workers が合言葉を確かめてから返す
- 毎朝の処理とデモ用ボタンは、同じ関数を呼ぶ
- デモの家族は、実際の家族とは別の家族として持つ

## ブランチとデプロイ

- GitHub とつないで自動でデプロイする。`develop` はプレビュー、`main` は本番
- プレビューと本番は別の Worker にし、D1・R2 も環境ごとに別のものを使う（`wrangler.jsonc` の `env.preview` とトップレベル）。デプロイは `npm run deploy:preview` / `npm run deploy:production` で行う → [0005](decisions/0005-separate-preview-worker.md)
- clone した人は、`npm run setup:cloudflare` で自分のアカウントに D1・R2 を作り、wrangler.jsonc の `database_id` を自分のものに書き換える → [0006](decisions/0006-cloudflare-ids-in-repo.md)
- 作業は `develop` で行う。区切りの良いところで `main` に取り込む。Pull Request は使わない
- 秘密の値は Workers の secret に登録する。リポジトリには入れない
- 手元の秘密の値は `.dev.vars` に置く。このファイルは git の管理から外してある
