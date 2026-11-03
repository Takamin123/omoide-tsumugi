---
name: parent-trial
description: 実際の家族（作り手の親）に本番で試してもらう段取り。本番に入れる前の確かめ、親の家族の作り方とリンクの渡し方、試しの間の見守り、試しの後（2026-11-11）に消すまでを一か所に並べる。本番に develop を入れる前と、親にリンクを渡す前に使う。
argument-hint: "[before|create|watch|end]"
---

# 親の試しの段取り

対象: `$ARGUMENTS`（指定がなければ全部を上から確かめる）

試しの線引き（同意・消す約束・費用）は `docs/decisions/0027-parent-trial-lines.md`。この手順は、その段取りを一か所に並べたものです。理由は各 decisions を正とします。

## 約束

- **本番に触る手順（マイグレーション、秘密の値、デプロイ、家族を消す）は、人間が決めて人間が打つ。** Claude は打つコマンドを示し、確かめた結果を並べるまで。サブエージェントは本番に書き込まない
- 本番に置くのは親の家族だけ。デモの家族は本番に置かず、撮影と審査はプレビューで行う（人間の決定、2026-11-04。`docs/decisions/0038-demo-reset.md`）
- 実際の家族の名前・写真・声・語り・家族 ID を、会話の記録、ログ、ファイル、コミットに書かない。家族 ID は人間の手元と秘密の値（`OPS_RECORD_FAMILIES`）にだけ置く

## 1. 本番に入れる前（before）

上から順に。一つでも済んでいなければ、先に進まない。

1. **Cloudflare の本番のアカウントが有料プランか確かめる**（ダッシュボードの Workers の Plans）。`docs/spec.md` は有料プランが前提。無料の 50 サブリクエストでは毎朝の処理が収まらない
2. **本番の既存の家族を数えて消す**（人間の決定、2026-11-04: 本番の既存の家族は消す）。手順は `/d1-migrate` の「本番に適用する」。消すのはマイグレーション 0005 より前
   - `npx wrangler d1 execute DB --remote --command "SELECT id, is_demo, created_at FROM families"` で数える（名前は出さない）
   - 一つずつ `/delete-family production <家族 ID>`（デモの家族なら `--allow-demo`）。消すのは人間が自分の端末で打つ
   - この時点の本番には、0004・0005 で作る表（record_extractions、musubi_guess_runs）がまだない。スクリプトはその表を「まだない表」として 0 件に数え、ある表だけを消す
3. **マイグレーション 0003 → 0004 → 0005 を本番に**。`/d1-migrate production`。先に `npx wrangler d1 migrations list DB --remote` で未適用のものを確かめ、人間の確認を取ってから
   - 0003 で、本番の有効なリンクはすべて取り消される（`docs/decisions/0036`）
4. **秘密の値（本番）**。`/setup-secrets production`。値は人間が入力する
   - `ANTHROPIC_API_KEY`（プレビューとは別のキー）、`OPENAI_API_KEY`、`CREATE_FAMILY_TOKEN`、`OPS_RECORD_TOKEN`（32 文字以上で、ほかの鍵とは別の値。`docs/decisions/0030`）
   - `DEMO_RESET_TOKEN` は本番には要らない（本番にデモの家族を置かない）
   - `OPS_RECORD_FAMILIES` は、下の「2. 親の家族を作って渡す」で家族を作った後に入れる
   - `npx wrangler secret list` で、名前がそろっていることを確かめる（値は表示されない）
5. **main に develop を取り込み、`npm run deploy:production`**。デプロイの後に `/verify-deploy production`

## 2. 親の家族を作って渡す（create）

形は `docs/decisions/0036-one-link-per-member.md`（一人ずつのリンク）。

1. 本番の `/start` で家族を作る。**「デモの家族として作る」の印は付けない**
2. 最初の人のリンクを作り手自身が開き、自分を家族の画面の人として入れる
3. `/family` で親を足す。話し方と地域（方言）を入れる。二人で一台を使うなら「じいじとばあば」のような一人として足してよい（`docs/decisions/0037`）
4. 一人ずつ「リンクを作る」で親のリンクを作る
5. `/family` の一番下の「家族の番号」（`docs/decisions/0033`）を写し、`OPS_RECORD_FAMILIES` に入れる（`! npx wrangler secret put OPS_RECORD_FAMILIES`）。入れないと、鍵が合っていても記録の画面は 404（`docs/decisions/0030`）
6. **リンクは合言葉そのもの。** LINE で送って LINE の中の閲覧画面で開くと、cookie がその閲覧画面にだけ残る。親には先に「Chrome で開いて、ホーム画面に足す」を案内する。親の端末はらくらくスマホ（幅 360px 前後）
7. **渡す時期**（`docs/decisions/0027` の段取り）: 作り手が写真を入れた翌朝以降に渡す（初日は全員が固定の入り口になる）。一度に 10 枚を超えて入れると写真の説明が Batch になり、翌朝に間に合わないことがある。渡す 2 日前に入れるか、10 枚以下に分けて入れる
8. **同意の電話**（`docs/decisions/0027` の「同意の取り方」）の項目に、一言添える: 毎朝、話した言葉から人・場所・時期・出来事の言葉を抜き出し（`docs/decisions/0039`）、写真どうしのつながりを推測する（`docs/decisions/0044`）
9. **作り手が祖父母の画面を一度見ておく。** プレビューに祖父母の画面の人のリンクを一つ作り、自分の端末で開く。祖父母の画面はひらがなのボタンなど言葉が家族の画面と違う（`docs/decisions/0043`）ので、電話で操作を教えるときに言葉を合わせるため

## 3. 試しの間の見守り（watch）

- Anthropic と OpenAI の残高（`docs/decisions/0027` の「費用」）。尽きると Claude・文字起こし・読み上げが静かに失敗する
- 毎朝の処理のログ（日本時間 3:00）。ダッシュボードの Workers Logs か `npx wrangler tail` で、次のものを見る（ログには ID と件数だけが出る）
  - `morning_done` の `fallbacks`（固定の入り口に倒れた人と理由の種類）、`failed`、`speech.failed`、`preludeSkipped`
  - `record_extraction_run` の `deferred`（予算を超えて翌朝に回った語りの数）
- 記録の画面（`/ops/record`。鍵は `OPS_RECORD_TOKEN`）

## 4. 試しの後（end。2026-11-11）

`docs/decisions/0027` の「消す約束」と `docs/decisions/0031`。

1. **11/11 より前に**、プレビューでデモでない使い捨ての家族を一度消してみる（`/delete-family preview`。0031 の約束）
2. 11/11 に、`/delete-family production <家族 ID>` を人間が自分の端末で打つ
3. `OPS_RECORD_FAMILIES` から、その家族 ID を外す
4. 本人に消したことを伝える。Cloudflare のバックアップ（D1 の Time Travel）に保持の期間のあいだ残り、その後は自動で消えること、Anthropic と OpenAI に送った分は作り手からは消せないこと（各社の保持の期間が過ぎると消える）を添える
