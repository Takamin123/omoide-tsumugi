---
name: delete-family
description: 家族の場を、家族 ID を指定してまるごと消す（D1 の全部の行と、R2 の families/<id>/ の全部のファイル）。本人から「消して」と言われたとき（0027。1 週間以内）に使う。本番で消す前には、必ず人間の確認を取る。
argument-hint: "[local|preview|production] [家族 ID]"
---

# 家族の場を消す

対象: `$ARGUMENTS`（環境と家族 ID。どちらかがなければ、人間に聞く。推測で埋めない）

消したものは戻りません（R2 は戻せない）。順番を飛ばさないでください。判断の理由は `docs/decisions/0031-delete-family.md`。

## 約束

- 消す範囲は家族の場ごと全部（0027）。D1 のその家族の全部の行と、R2 の接頭 `families/<id>/` の全部のファイル（写真、録音、問いかけの音声。D1 の行が指していないファイルも含む）
- アプリに消す入り口はない。`scripts/delete-family.mjs` が、運営の手元の wrangler のログインで D1・R2 に触れる（preview / production は wrangler の remote のバインディング）
- 家族 ID は UUID の小文字の完全な形だけを受け付ける。消すときは `--confirm` に同じ ID をもう一度書く
- デモの家族は消さない（デモは `/demo-reset`）。どうしても消すときだけ `--allow-demo`
- **出してよいのは、環境、家族 ID、デモかどうか、件数だけ。** 家族の名前、語りの本文、写真の URL、R2 のキーを、会話・ログ・ファイルに出さない。家族 ID もファイルやコミットに書かない
- **本番では、必ず人間の確認を取ってから消す。** サブエージェントとして動いているときは、本番では数えるところまでで止め、「本番で消すのは人間に頼む必要がある」と報告して返す

## 前提

- 環境、データベース、バケットの名前は `wrangler.jsonc` を正とする。スクリプトは、プレビューと本番が同じ D1 か R2 を指していたら止まる
- preview / production では `npx wrangler whoami` でログインしていること
- local は `.wrangler/state`（開発サーバーと同じ場所）を使う。開発サーバーは止めなくてよい

## 1. 数える（消さない）

```bash
node scripts/delete-family.mjs <local|preview|production> <家族ID>
```

- 出るもの: 種類（デモの家族 / 実際の家族（デモではない））、人・写真・語り・入り口・R2 のファイルの数、表ごとの行数、D1 が指す R2 のキーの数（接頭の外の数）
- マイグレーションを当てる前の環境（例: 0004・0005 の前の本番）では、後から足した表（record_extractions、musubi_guess_runs など）がまだない。スクリプトはその表を 0 件として数え、「まだない表」として出し、ある表だけを消す。それ以外の表（families、members、records など 0000 で作る表）がなければ、つなぐ先の取り違えとして止まる
- 「この家族の行もファイルもありません」なら、ID の打ち間違いか、もう消えている。人間に ID を確かめてもらう
- 「接頭の外」か「ほかの家族の行がこの接頭を指す」が 0 でなければ、消さずに止めて人間に知らせる（スクリプトもそこで止まる）

## 2. 人間に確かめてもらう

次のことを人間に示して、消してよいかを聞く。

- 環境と家族 ID（人間が持っている ID と一文字ずつ合っているか）
- デモの家族か、実際の家族か
- 1 の件数
- 消したら戻せないこと。D1 は Time Travel で、データベース全体を過去の時点に戻せる期間がある（そのあいだは Cloudflare のバックアップに残る）。R2 は戻せない

**本番が初めてなら**、先に preview でデモでない使い捨ての家族を作り（写真・録音・問いかけの音声を一つずつ入れる）、この手順を一度通したかを確かめる。まだなら、そちらを先にする。

## 3. 消す

```bash
# local / preview（人間の了解の後に）
node scripts/delete-family.mjs <local|preview> <家族ID> --delete --confirm <家族ID>

# production は、人間が自分の端末で打つ（Claude Code の外のシェル）
node scripts/delete-family.mjs production <家族ID> --delete --confirm <家族ID>
```

- 本番で消すときは、スクリプトが件数を出した後に、家族 ID をもう一度打つよう求める。端末からの入力がないとき（Claude の Bash、サブエージェント、`! ` の実行で端末にならないとき）は、本番につなぐ前に止まる。人間には、コマンドを示して自分の端末で打ってもらう

- 順番: 数える → D1 が指すキーが接頭の外にないか、ほかの家族の行がこの接頭を指していないか確かめる → D1 を一つの batch で子の表から消す → R2 を接頭で一覧して消す → 数え直す
- D1 を先に消すのは、families の行が消えた時点でアプリの合言葉が通らなくなり、新しい写真や録音が入らなくなるため
- 途中で落ちたら、同じコマンドをもう一度打つ。続きから消える
- 本番では、消し始めた時刻が出る（Time Travel の目安）

## 4. 消えたことを確かめる

- スクリプトが消した後にもう一度数え、全部の表と R2 のファイルが 0 件なら「0 件になりました」と出す。0 でなければ失敗で終わるので、もう一度 3 を打つ
- **本番の初回だけ**、人間に Cloudflare のダッシュボードで R2 のバケットを接頭 `families/<家族ID>/` で絞り、0 件であることを目で確かめてもらう（別の道での確かめ）

## 5. 消した後の人間の段取り

1. 秘密の値 `OPS_RECORD_FAMILIES` から、その家族 ID を外す（0030）。人間が値を入力し直す

   ```bash
   ! npx wrangler secret put OPS_RECORD_FAMILIES            # 本番
   ! npx wrangler secret put OPS_RECORD_FAMILIES --env preview
   ```

   ほかの家族がいなければ、空ではなく `wrangler secret delete OPS_RECORD_FAMILIES` でもよい
2. 本人に「消した」と伝える。作り手の言葉で、Cloudflare のバックアップ（D1 の Time Travel）に保持期間のあいだ残り、その後は自動で消えることを添える。作り手が Time Travel で戻すことはしない（戻すのはデータベース全体で、その家族だけを戻す道でもない）

## うまくいかなかったとき

- remote のバインディング（getPlatformProxy）が動かないとき（wrangler の変更など）の退路: D1 の行からキーを集め、wrangler の CLI で一つずつ消す。この道では D1 の行が指していないファイルは消せないので、最後にダッシュボードで接頭 0 件を確かめる

  ```bash
  npx wrangler d1 execute DB [--env preview] --remote --json --command "SELECT storage_key AS k FROM photos WHERE family_id = '<家族ID>' UNION ALL SELECT audio_key FROM narrations WHERE family_id = '<家族ID>' AND audio_key IS NOT NULL UNION ALL SELECT question_audio_key FROM entrances WHERE family_id = '<家族ID>' AND question_audio_key IS NOT NULL"
  npx wrangler r2 object delete <BUCKET>/<キー> [--env preview] --remote   # キーごとに。キーは会話に貼らず、シェルの中で回す
  ```

  D1 の行は、スクリプトの `FAMILY_TABLES` の順に `DELETE FROM <表> WHERE family_id = '<家族ID>'`（families は `id`）で消す
- 表を足したとき: `FAMILY_TABLES` に足す。足し忘れると `test/delete-family.test.ts` が落ちる
