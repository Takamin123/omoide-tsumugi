---
name: demo-reset
description: デモの家族（架空の三世代）を、デモ用の写真と録音済みの声を登録した状態に戻す。撮影の前や、デモで状態が変わった後に使う。実際の家族のデータには触れない。
argument-hint: "[local|preview|production] <デモの家族の ID>"
---

# デモの初期化

対象: `$ARGUMENTS`（環境の指定がなければ local）。判断の理由は `docs/decisions/0038-demo-reset.md`

## 約束

- 戻すのは、運営が ID を明示した家族だけ。その家族の is_demo が偽なら、API は 404 を返して何も変えない（実際の家族には触れない）
- 残すもの: 家族の行、人（members）、リンク（invite_links）。戻すもの: 写真・語り・入り口・推測の表（photo_guesses など）と、それらが指す R2 の families/<id>/ の下のファイル
- デモ用の写真と録音は、リポジトリに入れない（`docs/decisions/0004`）。R2 の `demo/seed/` に置き、初期化のたびにそこから写す
- 画面（`/start` の「デモを最初の状態に戻す」）も、このスキルも、**同じ API を呼ぶ**。処理を二つに分けない
- 最後に、毎朝の処理と同じ関数（runMorning）を呼んで、今日の入り口を作る（本物の Claude を呼ぶ。1〜4 分かかる）

## API

- `POST /api/demo/families/<家族 ID>/reset`、`Authorization: Bearer $DEMO_RESET_TOKEN`
- 200: 消した件数・入れた件数と、毎朝の処理の要約（ID と件数だけ）
- 401: 鍵がない・違う（鍵が 32 文字未満、または CREATE_FAMILY_TOKEN・OPS_RECORD_TOKEN と同じ値なら、設定なしとみなして誰も通さない）
- 404 not_found: 家族がない、またはデモの家族ではない
- 409 demo_seed_mismatch: 家族の人の呼ばれ方と役が台本と合わない（何も変えていない）
- 409 demo_seed_missing: `demo/seed/` の写真か録音が欠けている、または種類が違う（何も変えていない）

## 手順

### 0. デモの家族を作る（初回だけ。運営が普通の画面で作る）

1. `/start` で「デモの家族として作る」に印を付けて作る。最初の人のリンクを開く
2. 最初の人を入れる: 呼ばれ方「お母さん」、家族の画面、話し方は標準語
3. `/family` で残りの 3 人を足し、一人ずつのリンクを作る
   - 「じいちゃん」（祖父母の画面、標準語）
   - 「まさとおじさん」（家族の画面、標準語）
   - 「ゆい」（家族の画面、標準語）
   - 呼ばれ方は `src/server/demo/seed.ts` の SEED_MEMBERS と一字も違わないこと（違うと demo_seed_mismatch で止まる）
4. 家族の ID は `/family` の画面に出る（0033）。運営の手元に控える

### 1. 素材を R2 に置く（初回と、素材を替えたとき）

- 元のファイルは、リポジトリの**外**に置く: 写真は `~/omoide-demo-seed/prepared/`（向きを直し、長い辺 1600px、EXIF なし）、録音は `~/omoide-demo-seed/voice/`（n1・n7・n8・n12。m4a・mp3・wav のどれか）
- 写真のファイル名と R2 の鍵は `seed.ts` の SEED_PHOTOS の `file` に合わせる。写真を替えたら content_hash・幅・高さも seed.ts で直す
- 置く先: 写真は `demo/seed/photos/<ファイル名>`、録音は `demo/seed/voice/<語りの印>`（拡張子なし）。**種類（--content-type）を必ず付ける**（写真は image/jpeg、録音は audio/mp4・audio/mpeg・audio/wav）。種類が合わないと demo_seed_missing で止まる

```bash
# local（開発サーバーと同じ .wrangler/state に置く）
for f in ~/omoide-demo-seed/prepared/*.jpg; do
  npx wrangler r2 object put "omoide-tsumugi/demo/seed/photos/$(basename "$f")" --file "$f" --content-type image/jpeg --local
done
npx wrangler r2 object put omoide-tsumugi/demo/seed/voice/n1 --file ~/omoide-demo-seed/voice/n1.m4a --content-type audio/mp4 --local
# n7・n8・n12 も同じ

# preview: バケットは omoide-tsumugi-preview、--env preview --remote
# production: バケットは omoide-tsumugi、--remote
```

- 録音の長さを測り、`seed.ts` の SEED_VOICE_DURATION_MS に書く（測るまでは null。長さを作らない）

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 ~/omoide-demo-seed/voice/n1.m4a   # 秒。1000 倍して整数に
```

- 台本の語りを変えたとき・clean_transcript の版を上げたときは、声の語りの整えた文字を作り直す（本物の Haiku を一度呼ぶ）: `npm run eval:demo-seed`（worktree では `EVAL_DEV_VARS=<メインの .dev.vars>` を付ける）。`src/server/demo/seed-cleaned.ts` が書き換わる

### 2. 初期化を呼ぶ

画面から: `/start` の「デモを最初の状態に戻す」に家族の ID と鍵を入れて押す（鍵は画面の中だけで、端末に残らない）

コマンドから:

```bash
# local（npm run dev で開発サーバーを動かしておく。Vite の既定のポートは 5173）
curl -sS -X POST "http://localhost:5173/api/demo/families/<家族 ID>/reset" -H "Authorization: Bearer $DEMO_RESET_TOKEN"

# preview / production
curl -sS -X POST "<URL>/api/demo/families/<家族 ID>/reset" -H "Authorization: Bearer $DEMO_RESET_TOKEN"
```

- `DEMO_RESET_TOKEN` は `/setup-secrets` で登録する（`openssl rand -base64 32` などで作った 32 文字以上の値。ほかの鍵と別の値）。会話の中に値を貼らない。人間に `! ` を付けて実行してもらうか、手元の `.dev.vars` から読む
- production では、渡す ID がデモの家族の ID であることを、実行の前に人間に確かめてもらう（デモでなければ 404 で何も変わらないが、ID の取り違えに気づくため）

### 3. 確かめる

- デモの家族のリンクで開いて、アルバム（写真 12 枚のうち語りのある 6 枚）、言葉の糸（ゆいとじいちゃんの答え）、今日の入り口、祖父母の画面の読み上げが出ていることを確かめる
- 実際の家族の数とデータが変わっていないことを確かめる（初期化の前と後で、家族の一覧の件数を比べる）
- デモの家族そのものを消すときは、`/delete-family` に `--allow-demo` を付ける
