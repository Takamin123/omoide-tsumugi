# 0021 写真の初回整理（photo_guess）の作業の表と、回す場所

- 日付: 2026-11-03
- 状態: 採用
- 決めた人: fable-advisor に相談（backend-developer）。Haiku と Batch を使うこと、しきい値で call と Batch を分けること、photo_guesses を今日作ることは人間

## 決めたこと

### 冪等と Batch の追跡
- photo_guesses に unique(photo_id, prompt_version) を足す。同じ写真・同じ版の説明は一つ
- 作業の記録は、推測の表とは別の表 photo_guess_requests（PK photo_id + prompt_version、family_id、state working|failed、batch_id、attempts、claimed_at）に持つ
- 説明を作る前に行を「取る」（INSERT … ON CONFLICT DO UPDATE … WHERE、RETURNING）。取れた写真だけを call か Batch に回す。並んだ登録の背景処理が重なっても、同じ写真を二度呼ばない・二度 Batch に入れない
- 成功したら説明を入れ、作業の行を消す（一度に）。失敗は state = failed にして、試した回数（attempts）が 3 回に届くまで次の回で取り直す。家族には知らせない
- 取り直せる行（どれも attempts < 3 のときだけ）: 失敗して 10 分たったもの（一時的な障害の間に、続く登録の背景処理で回数を使い切らないように）、Batch なしで 10 分より前に取ったまま、Batch ありで 25 時間（Batch の期限 24 時間の外側）より前に取ったまま。getBatch が rejected（Batch が見つからない）なら、入っていた写真をすぐ失敗にする
- 一枚の画像が API の上限（base64 で 5MB）を超える写真は Batch に入れずに失敗にする（一枚でほかの写真の Batch を道連れにしない）
- キーがない（not_configured）、時間の予算で呼ばなかった、Batch に載せきれなかった写真は、試した回数に数えずに戻す（待たずに取り直せる）
- 一つの Batch は一家族分だけ（30 枚まで、画像の合計の大きさにも上限）。回収のときは customId をその Batch の作業の行と照らし、合わないものは捨てる。family_id は作業の行から取る

### 回す場所
- core/photo-guess.ts の `runPhotoGuesses(deps, familyId)`（終わった Batch の回収 → まだ説明のない写真を取って、しきい値 10 枚以下なら一枚ずつ call、超えたら Batch）を、次の二か所から呼ぶ
  - 写真の登録の後（runInBackground）
  - runMorning の、家族ごとの入り口づくりの前（Cron とデモの時計のボタンは、どちらも runMorning を通る）
- 一回の処理に時間の予算（毎朝の処理では 60 秒、登録の後の背景処理では waitUntil の 30 秒の内側の 25 秒）を持ち、超えた分は次の回に回す。投げずに飲み込み、写真の登録と入り口づくりは続ける

### 渡すものと検査
- Haiku に渡すのは縮小済みの画像だけ。撮影日、持ち主の呼ばれ方、家族の一覧、位置は渡さない
- 受け取る形は zod の `{ description: string }`。検査: 空でない、200 字以内、続柄の語（定数の一覧。一字の語も入れる）と感想・物語の語（定数の一覧）を含まない。違反は 1 回だけ再試行（Batch の行は失敗にして次の回で取り直す）
- 説明は家族向けの API の応答に出さない（テストで固定する）

## 理由
- 推測の表に作業の状態を混ぜない（0010。推測の表は名前と制約で分かり、description は NOT NULL のまま）。二重の呼び出しと二重の Batch を表の一意で止める（implementation-policy 5 の冪等）
- 入り口に至る経路を一つにする（0009、implementation-policy 5 の 4）。毎朝の処理は 10 分以内で、本体は入り口づくりなので、写真の整理が朝を食わないよう予算を切る
- 「写真に写っていないことは書かない」ので、日付を渡さない。日付を渡すと、日付を書き写したり、日付から行事を決めたりする。撮影日は入り口づくりが別に受け取る（0017）。渡すのは要るものだけ（implementation-policy 2）
- 説明は入り口づくりの材料になる。推測した気持ち（「楽しそう」）が問いかけの前提に忍び込むと、「推測は問いかけの形でしか使わない」「Claude 自身の言葉は最小限」が崩れる。入り口の側の検査では見つけられないので、ここで止める
- 続柄の語を誤って止めても、失うのは家族に見せない説明一つ。止める側に倒す（claude-checks.ts と同じ考え方）
- Workers の上限: waitUntil は応答の後 30 秒まで、サブリクエストは無料 50・有料 10,000（D1・R2 も数える）、メモリ 128MB（https://developers.cloudflare.com/workers/platform/limits/ 、2026-11-03 に確認）。一枚ずつの呼び出しは同時 4 本、Batch は 30 枚までにする

## 退けた案とその理由
- photo_guesses に status と batch_id を足す: 推測の表に作業が混ざり、description が null 可になる
- Batch の ID だけを持つ表: 取る仕組みがなく、並んだ背景処理の二重呼び出しを止められない
- scheduled とデモのボタンから別々に呼ぶ: 経路が二つになる（0009 で退けた形）
- 撮影日を渡す: 日付を書き写す・日付から行事を決める説明になる

## 根拠にしたもの
- fable-advisor との相談（2026-11-03）
- docs/requirements.md「記録と言葉」「プライバシー」「作らないもの」、docs/implementation-policy.md 2・3・5、0009、0010、0012、0017
- Cloudflare Workers の上限のページ（上記）

## 見直す条件
- 出し比べで、画像だけでは季節や行事の読みが弱いと分かったとき → 日付を渡すかを決め、検査に日付の禁止を足す
- 11 枚以上まとめて届く日が普通になり、翌朝の入り口に説明が付かないことが目立つとき → 「先頭の 10 枚は call、残りを Batch」に変えるかを考える
- runMorning が 10 分に近づいたとき → 写真の整理を朝から外し、Batch だけにする
- 無料プランのサブリクエストの上限（50）に当たるとき → 人間に有料プランの前提を確かめ、予算を小さく切る
- Batch 一回の枚数でメモリが詰まったとき
