# 基本仕様

骨格だけを書く。詳細はソースを正とする。

## 技術構成

| 役割 | 使うもの | 理由 |
|---|---|---|
| 実行環境 | Cloudflare Workers | [0002](decisions/0002-cloudflare-workers.md) |
| バックエンド | Hono | |
| フロントエンド | React（スマホ向け Web アプリ） | |
| データベース | Cloudflare D1 + drizzle-orm | |
| 写真と録音 | Cloudflare R2（非公開） | |
| 定期処理 | Cron Triggers（毎朝の今日の一枚） | |
| 写真の縮小 | ブラウザ側で縮小してから送る。撮影日と位置情報は縮小の前に exifr で読む | [0003](decisions/0003-browser-side-resize.md) |
| 文字起こし | OpenAI gpt-transcribe（話す人ごとの方言を prompt に入れる） | |
| Claude | 整理と整形は Haiku 5.5。入り口づくりなどの判断は Sonnet 5.5（必要なら Opus 5.5） | |

## 構造の約束

- データベースと写真の保存は、差し替えられる形（インターフェースの背後）にする。さくらの VPS（Node.js、better-sqlite3、ローカルのファイル保存）に切り替えられるようにするため。→ [0002](decisions/0002-cloudflare-workers.md)
- 写真と録音は、署名付き URL で返すか、Workers が合言葉を確かめてから返す
- 毎朝の処理とデモ用ボタンは、同じ関数を呼ぶ
- デモの家族は、実際の家族とは別の家族として持つ

## ブランチとデプロイ

- GitHub とつないで自動でデプロイする。`develop` はプレビュー、`main` は本番
- 作業は `develop` で行う。区切りの良いところで `main` に取り込む。Pull Request は使わない
- 秘密の値は Workers の secret に登録する。リポジトリには入れない
- 手元の秘密の値は `.dev.vars` に置く。このファイルは git の管理から外してある
