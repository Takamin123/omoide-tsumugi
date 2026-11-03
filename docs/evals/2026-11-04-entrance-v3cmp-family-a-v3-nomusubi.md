# 出し比べ: 入り口づくり（entrance/v3、むすびなし）family-a、0042 の後（g0 と、同じ日の写真を外す）

- 日付: 2026-11-04
- モデル: claude-sonnet-5-5（応答に書かれたもの: claude-sonnet-5-5）
- データ: evals/fixtures/family-a.json の 5 人 × 3 回の朝。人の順（毎朝の処理の順）: お母さん → ばあば → じいじ → まさるおじさん → ゆい。今日 = 2026-11-03
- 過去の入り口: なし
- 画像: なし（写真の説明だけ。focus は null だけを許す）
- 「引用の再利用」: 問いかけと画面に出る引用に共通する、いちばん長い連続した文字列の字数
- むすび: なし（使わない）

## まとめ

- 作れた: 15 / 15（固定の入り口に倒れたもの: 0）
- 検査で再試行になったもの: 0
- トークン: 入力 107200、出力 16745
- 検査の違反（全試行）: なし
- つながりの検査に当たる最後の応答: 0
- 引用の再利用の最大: 6 字。quote null: 0。受け取る人以外の語りの引用: 15/15。focus の違反: 0
- 「ほかに」: 7/15。「でしたか」で終わる: 1/15
- receiver_present: unknown 3、yes 6、no 6。期待値との合致: 11/11
  - まさるおじさん 1 回目 p06-wedding: 期待 no / 出力 no「ばあばのこの話で、料理のことをもっと聞いてみたいのはどんなところですか」
  - ゆい 1 回目 p01-beach: 期待 no / 出力 no「ばあばのこの話で、かき氷のことをもっと聞いてみたいのはどんなところですか」
  - お母さん 2 回目 p06-wedding: 期待 no / 出力 no「ばあばのこの話で、料理のことをもっと聞いてみたいのはどんなところですか」
  - ゆい 2 回目 p01-beach: 期待 no / 出力 no「ばあばのこの話で、かき氷のことをもっと聞いてみたいのはどんなところですか」
  - まさるおじさん 3 回目 p06-wedding: 期待 no / 出力 no「ばあばが話す持ち寄りの料理について、もっと聞いてみたいのはどんなところですか」
  - ゆい 3 回目 p01-beach: 期待 no / 出力 no「ばあばのこの話で、かき氷のほかにもっと聞いてみたいのはどんなところですか」
- 渡した <same_event> の行: 0

- 1 回目の朝: 異なる写真 5 / 5 人、異なる引用 5（引用あり 5）
- 2 回目の朝: 異なる写真 5 / 5 人、異なる引用 5（引用あり 5）
- 3 回目の朝: 異なる写真 5 / 5 人、異なる引用 5（引用あり 5）

| 受け取る人 | 回 | 結果 | 試行 | 先の人の写真 | 写真 | 引用（語り手） | その場 | 問いかけ | 字数 | 引用の再利用 |
|---|---|---|---|---|---|---|---|---|---|---|
| お母さん | 1 | ok | 1 | - | p04-new-year | ばあば: n03-new-year-baaba | unknown | こたつのまわりでは、このころどんなふうに過ごしましたか | 27 | 3 |
| ばあば | 1 | ok | 1 | p04-new-year | p02-sports-day | お母さん: n09-sports-day-mother | yes | テントの前で過ごしたその日は、ほかにどんなことがありましたか | 30 | 6 |
| じいじ | 1 | ok | 1 | p04-new-year、p02-sports-day | p07-field | ゆい: n10-field-yui | yes | その畑では、ほかにどんなことをして過ごしましたか | 24 | 3 |
| まさるおじさん | 1 | ok | 1 | p04-new-year、p02-sports-day、p07-field | p06-wedding | ばあば: n05-wedding-baaba | no | ばあばのこの話で、料理のことをもっと聞いてみたいのはどんなところですか | 35 | 2 |
| ゆい | 1 | ok | 1 | p04-new-year、p02-sports-day、p07-field、p06-wedding | p01-beach | ばあば: n01-beach-baaba | no | ばあばのこの話で、かき氷のことをもっと聞いてみたいのはどんなところですか | 36 | 3 |
| お母さん | 2 | ok | 1 | - | p06-wedding | ばあば: n05-wedding-baaba | no | ばあばのこの話で、料理のことをもっと聞いてみたいのはどんなところですか | 35 | 2 |
| ばあば | 2 | ok | 1 | p06-wedding | p02-sports-day | お母さん: n09-sports-day-mother | yes | このときのテントの前は、ほかにどんな様子でしたか | 24 | 5 |
| じいじ | 2 | ok | 1 | p06-wedding、p02-sports-day | p07-field | ゆい: n10-field-yui | yes | 畑では、ほかにどんなことをして過ごしましたか | 22 | 2 |
| まさるおじさん | 2 | ok | 1 | p06-wedding、p02-sports-day、p07-field | p04-new-year | ばあば: n03-new-year-baaba | unknown | こたつでは、ほかにどんなことをして過ごしましたか | 24 | 3 |
| ゆい | 2 | ok | 1 | p06-wedding、p02-sports-day、p07-field、p04-new-year | p01-beach | ばあば: n01-beach-baaba | no | ばあばのこの話で、かき氷のことをもっと聞いてみたいのはどんなところですか | 36 | 3 |
| お母さん | 3 | ok | 1 | - | p04-new-year | ばあば: n03-new-year-baaba | unknown | この日のこたつのまわりで、どんなことをして過ごしましたか | 28 | 3 |
| ばあば | 3 | ok | 1 | p04-new-year | p09-okonomiyaki | ゆい: n08-okonomiyaki-yui | yes | お好み焼きを焼いた日のことを、聞かせてください | 23 | 5 |
| じいじ | 3 | ok | 1 | p04-new-year、p09-okonomiyaki | p07-field | ゆい: n10-field-yui | yes | その畑では、ほかにどんなことをして過ごしましたか | 24 | 3 |
| まさるおじさん | 3 | ok | 1 | p04-new-year、p09-okonomiyaki、p07-field | p06-wedding | ばあば: n05-wedding-baaba | no | ばあばが話す持ち寄りの料理について、もっと聞いてみたいのはどんなところですか | 38 | 3 |
| ゆい | 3 | ok | 1 | p04-new-year、p09-okonomiyaki、p07-field、p06-wedding | p01-beach | ばあば: n01-beach-baaba | no | ばあばのこの話で、かき氷のほかにもっと聞いてみたいのはどんなところですか | 36 | 3 |

## 一人ずつ

### お母さん（母、family。1 回目）

候補（並べた順）: p01-beach、p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> お正月じゃね、これは。うちに親戚がえっと集まって、こたつに入りきらんで。

- receiver_present: unknown
- 問いかけ: こたつのまわりでは、このころどんなふうに過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year。ばあばの語りがあり母がまだ語っていないため優先。母の在場は語りから不明。p01は母が既に返事済みで語りも食い違うため退けた。画像なしでfocusはnull。材料はn03。

### ばあば（祖母、elder。1 回目）

候補（並べた順）: p01-beach、p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p03-car

- 写真: p02-sports-day（説明: 校庭のトラックで、はちまきをした子どもたちが走っている。手前にテントがあり、大人が何人か立っている）
- focus: null
- 引用: n09-sports-day-mother（お母さん）

> リレーのアンカーで、最後のカーブで転んだんだけど、起き上がって走ったら、ばあばがテントの前で立ち上がって手を振ってた。

- receiver_present: yes
- 問いかけ: テントの前で過ごしたその日は、ほかにどんなことがありましたか
- 問いかけの検査（保存の形）: ok
- reason: p02-sports-day。お母さんの語りが付き、未出で elder に届く。語りにばあばが出るため yes。p01はばあば自身の語りが既にあり食い違いもあるので退けた。画像なしでfocusはnull。材料はn09。

### じいじ（祖父、elder。1 回目）

候補（並べた順）: p07-field、p09-okonomiyaki、p06-wedding、p01-beach、p05-shichigosan、p03-car

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> じいじの畑で大根抜いたやつ。全然抜けなくて、じいじが後ろから引っぱってくれた。

- receiver_present: yes
- 問いかけ: その畑では、ほかにどんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p07-field を選択。孫ゆいの語りが付き未提示のため。じいじ本人が語りに登場するので同席と推測。p01-beach は母と叔父の語りが食い違うため退けた。画像なしで focus は null。材料は n10-field-yui。

### まさるおじさん（叔父、family。1 回目）

候補（並べた順）: p09-okonomiyaki、p06-wedding、p08-dog、p03-car、p01-beach、p05-shichigosan

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> 料理は近所の人が持ち寄ってくれて

- receiver_present: no
- 問いかけ: ばあばのこの話で、料理のことをもっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p06-wedding。ばあばの語りがあり、まだ出しておらず、おじさんに届く向きのため選んだ。式の日の話で本人はいなかったと読める。退けたp01-beachは本人の語りが既にあり、母との食い違いもある。focusは画像なしでnull。材料はn05-wedding-baaba。

### ゆい（孫、family。1 回目）

候補（並べた順）: p08-dog、p01-beach、p03-car、p05-shichigosan、p09-okonomiyaki

- 写真: p01-beach（説明: 砂浜で、浮き輪を持った子どもと、海に向かって走る子ども、日傘をさした女性が写っている。遠くに小さな島が見える。色があせている）
- focus: null
- 引用: n01-beach-baaba（ばあば）

> 帰りに食べたかき氷が、ぶちおいしかったねえ。

- receiver_present: no
- 問いかけ: ばあばのこの話で、かき氷のことをもっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p01-beach: ばあば・お母さん・おじさんの語りが揃う。昭和の話でゆいは不在と推測。p08-dog は語りが曖昧なため退けた。画像なしで focus は null。材料は n01。

### お母さん（母、family。2 回目）

候補（並べた順）: p01-beach、p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> 料理は近所の人が持ち寄ってくれて

- receiver_present: no
- 問いかけ: ばあばのこの話で、料理のことをもっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p06-wedding。お母さん宛てで祖母ばあばの語りがあり未出し。語りの「うちの父」から、ばあば自身の式の話でお母さんはその場にいないと読んだ。退けた候補はp01(本人の語りがある)。画像なしのためfocusはnull。材料はn05-wedding-baaba。

### ばあば（祖母、elder。2 回目）

候補（並べた順）: p01-beach、p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p03-car

- 写真: p02-sports-day（説明: 校庭のトラックで、はちまきをした子どもたちが走っている。手前にテントがあり、大人が何人か立っている）
- focus: null
- 引用: n09-sports-day-mother（お母さん）

> 起き上がって走ったら、ばあばがテントの前で立ち上がって手を振ってた。

- receiver_present: yes
- 問いかけ: このときのテントの前は、ほかにどんな様子でしたか
- 問いかけの検査（保存の形）: ok
- reason: p02-sports-day：お母さんの語りで、ばあばが場にいたと分かるため上位。p01は語りが食い違うため退けた。画像なしでfocusはnull。材料はn09-sports-day-mother。

### じいじ（祖父、elder。2 回目）

候補（並べた順）: p07-field、p09-okonomiyaki、p04-new-year、p01-beach、p05-shichigosan、p03-car

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> じいじの畑で大根抜いたやつ。全然抜けなくて、じいじが後ろから引っぱってくれた。

- receiver_present: yes
- 問いかけ: 畑では、ほかにどんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p07-field を選択。孫ゆいの語りがあり未出。語りにじいじが登場し現場にいたと判断。p01-beach は語りが食い違い、p09 はばあばの話で退けた。画像なしで focus は null。材料は n10-field-yui。

### まさるおじさん（叔父、family。2 回目）

候補（並べた順）: p09-okonomiyaki、p08-dog、p04-new-year、p03-car、p01-beach、p05-shichigosan

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> うちに親戚がえっと集まって、こたつに入りきらんで。

- receiver_present: unknown
- 問いかけ: こたつでは、ほかにどんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year を選択。叔父の未出の写真で、祖母の語りが付くため。同席は語りから断定できず unknown。p01は叔父と母の語りが食い違い、断定を避け退けた。画像なしのため focus は null。材料は n03-new-year-baaba。

### ゆい（孫、family。2 回目）

候補（並べた順）: p08-dog、p01-beach、p03-car、p05-shichigosan、p09-okonomiyaki

- 写真: p01-beach（説明: 砂浜で、浮き輪を持った子どもと、海に向かって走る子ども、日傘をさした女性が写っている。遠くに小さな島が見える。色があせている）
- focus: null
- 引用: n01-beach-baaba（ばあば）

> 帰りに食べたかき氷が、ぶちおいしかったねえ。

- receiver_present: no
- 問いかけ: ばあばのこの話で、かき氷のことをもっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p01-beach。ばあばの語りと母・叔父の返事があり未提示。ゆいは昭和の話で不在と推測。p08-dogは語りが曖昧で退けた。画像なしでfocusはnull。材料はn01。叔父と母の食い違いは避けた。

### お母さん（母、family。3 回目）

候補（並べた順）: p01-beach、p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> うちに親戚がえっと集まって、こたつに入りきらんで。

- receiver_present: unknown
- 問いかけ: この日のこたつのまわりで、どんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year。まさるおじさんの写真で、ばあばの語りがあり未提示のため優先。お母さん本人の語りは無く在席は不明。p01は語りが食い違い、本人が既に返事済みなので退けた。画像なしのためfocusはnull。材料はn03-new-year-baaba。

### ばあば（祖母、elder。3 回目）

候補（並べた順）: p01-beach、p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p03-car

- 写真: p09-okonomiyaki（説明: 台所の鉄板の上で、お好み焼きが焼けている。へらを持った手が写っている）
- focus: null
- 引用: n08-okonomiyaki-yui（ゆい）

> ばあばのお好み焼き、また食べたい

- receiver_present: yes
- 問いかけ: お好み焼きを焼いた日のことを、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p09-okonomiyaki：孫ゆいの言葉がばあばに直接届き、未出で他の家族の語りあり。p01は本人の語りと家族の食い違いがあり退けた。根拠：語りにばあばが出る。画像なしでfocusはnull。材料：n08-okonomiyaki-yui

### じいじ（祖父、elder。3 回目）

候補（並べた順）: p07-field、p02-sports-day、p06-wedding、p01-beach、p05-shichigosan、p03-car

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> じいじの畑で大根抜いたやつ。全然抜けなくて、じいじが後ろから引っぱってくれた。

- receiver_present: yes
- 問いかけ: その畑では、ほかにどんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p07-field。孫ゆいの語りが付き未提示。じいじが語りに登場し同席と判断。退けたp01-beachは語りが食い違う。画像なしでfocusはnull。材料はn10-field-yui。

### まさるおじさん（叔父、family。3 回目）

候補（並べた順）: p02-sports-day、p06-wedding、p08-dog、p03-car、p01-beach、p05-shichigosan

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> 料理は近所の人が持ち寄ってくれて

- receiver_present: no
- 問いかけ: ばあばが話す持ち寄りの料理について、もっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p06-wedding。ばあばの語りがあり、お母さんの写真で未提示のため上位。式の日の話で、まさるおじさんは生まれる前と推測。退けた候補はp01-beach(本人が語り済み、食い違いあり)。画像なしでfocusはnull。材料はn05-wedding-baaba。

### ゆい（孫、family。3 回目）

候補（並べた順）: p02-sports-day、p08-dog、p01-beach、p03-car、p05-shichigosan

- 写真: p01-beach（説明: 砂浜で、浮き輪を持った子どもと、海に向かって走る子ども、日傘をさした女性が写っている。遠くに小さな島が見える。色があせている）
- focus: null
- 引用: n01-beach-baaba（ばあば）

> 帰りに食べたかき氷が、ぶちおいしかったねえ。

- receiver_present: no
- 問いかけ: ばあばのこの話で、かき氷のほかにもっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p01-beach を選択。ばあばの語りに母とおじの返事が付き、出した回数も0。語りの「あんたら」は母で、孫のゆいは不在と推測。p08-dog は名前が曖昧で退けた。画像なしのため focus は null。材料は n01。
