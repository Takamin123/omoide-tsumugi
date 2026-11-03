# 出し比べ: 入り口づくり（entrance/v3）family-a-musubi-guessed、0042 の後（g0 と、同じ日の写真を外す）

- 日付: 2026-11-04
- モデル: claude-sonnet-5-5（応答に書かれたもの: claude-sonnet-5-5）
- データ: evals/fixtures/family-a-musubi-guessed.json の 5 人 × 3 回の朝。人の順（毎朝の処理の順）: お母さん → ばあば → じいじ → まさるおじさん → ゆい。今日 = 2026-11-03
- 過去の入り口: なし
- 画像: なし（写真の説明だけ。focus は null だけを許す）
- 「引用の再利用」: 問いかけと画面に出る引用に共通する、いちばん長い連続した文字列の字数
- むすび: mu-wrong-newyear-wedding {p04-new-year:guessed, p06-wedding:guessed}（使う）

## まとめ

- 作れた: 15 / 15（固定の入り口に倒れたもの: 0）
- 検査で再試行になったもの: 0
- トークン: 入力 107316、出力 16784
- 検査の違反（全試行）: なし
- つながりの検査に当たる最後の応答: 0
- 引用の再利用の最大: 6 字。quote null: 0。受け取る人以外の語りの引用: 15/15。focus の違反: 0
- 「ほかに」: 3/15。「でしたか」で終わる: 2/15
- receiver_present: unknown 4、yes 6、no 5。期待値との合致: 10/10
  - まさるおじさん 1 回目 p06-wedding: 期待 no / 出力 no「ばあばのこの話で、近所の人たちのことをもっと聞いてみたいのはどんなところですか」
  - ゆい 1 回目 p01-beach: 期待 no / 出力 no「ばあばの話のなかの浜の様子で、もっと聞いてみたいことはありますか」
  - まさるおじさん 2 回目 p06-wedding: 期待 no / 出力 no「ばあばのこの話で、料理のことをもっと聞いてみたいのは、どんなところですか」
  - ゆい 2 回目 p01-beach: 期待 no / 出力 no「ばあばのかき氷の話で、もっと聞いてみたいのはどんなところですか」
  - ゆい 3 回目 p01-beach: 期待 no / 出力 no「ばあばのこの話の、かき氷を食べた帰りの様子を聞かせてください」
- 渡した <same_event> の行: 13

- 1 回目の朝: 異なる写真 5 / 5 人、異なる引用 5（引用あり 5）
- 2 回目の朝: 異なる写真 5 / 5 人、異なる引用 5（引用あり 5）
- 3 回目の朝: 異なる写真 5 / 5 人、異なる引用 5（引用あり 5）

| 受け取る人 | 回 | 結果 | 試行 | 先の人の写真 | 写真 | 引用（語り手） | その場 | 問いかけ | 字数 | 引用の再利用 |
|---|---|---|---|---|---|---|---|---|---|---|
| お母さん | 1 | ok | 1 | - | p04-new-year | ばあば: n03-new-year-baaba | unknown | こたつのまわりは、いつもどんな様子でしたか | 21 | 3 |
| ばあば | 1 | ok | 1 | p04-new-year | p02-sports-day | お母さん: n09-sports-day-mother | yes | テントの前で過ごしたこの日のことを、聞かせてください | 26 | 6 |
| じいじ | 1 | ok | 1 | p04-new-year、p02-sports-day | p07-field | ゆい: n10-field-yui | yes | この日の畑は、どんな様子だったのか聞かせてください | 25 | 2 |
| まさるおじさん | 1 | ok | 1 | p04-new-year、p02-sports-day、p07-field | p06-wedding | ばあば: n05-wedding-baaba | no | ばあばのこの話で、近所の人たちのことをもっと聞いてみたいのはどんなところですか | 39 | 4 |
| ゆい | 1 | ok | 1 | p04-new-year、p02-sports-day、p07-field、p06-wedding | p01-beach | ばあば: n01-beach-baaba | no | ばあばの話のなかの浜の様子で、もっと聞いてみたいことはありますか | 32 | 2 |
| お母さん | 2 | ok | 1 | - | p04-new-year | ばあば: n03-new-year-baaba | unknown | この日のこたつのまわりの様子を、聞かせてください | 24 | 3 |
| ばあば | 2 | ok | 1 | p04-new-year | p02-sports-day | お母さん: n09-sports-day-mother | yes | テントの前で過ごしたこの日のことを、聞かせてください | 26 | 6 |
| じいじ | 2 | ok | 1 | p04-new-year、p02-sports-day | p07-field | ゆい: n10-field-yui | yes | この畑では、ほかにどんなことをして過ごしましたか | 24 | 3 |
| まさるおじさん | 2 | ok | 1 | p04-new-year、p02-sports-day、p07-field | p06-wedding | ばあば: n05-wedding-baaba | no | ばあばのこの話で、料理のことをもっと聞いてみたいのは、どんなところですか | 36 | 2 |
| ゆい | 2 | ok | 1 | p04-new-year、p02-sports-day、p07-field、p06-wedding | p01-beach | ばあば: n01-beach-baaba | no | ばあばのかき氷の話で、もっと聞いてみたいのはどんなところですか | 31 | 3 |
| お母さん | 3 | ok | 1 | - | p04-new-year | ばあば: n03-new-year-baaba | unknown | 餅をつく頃のうちでは、ほかにどんなことをして過ごしましたか | 29 | 3 |
| ばあば | 3 | ok | 1 | p04-new-year | p09-okonomiyaki | ゆい: n08-okonomiyaki-yui | yes | お好み焼きを焼く日は、いつもどんな様子でしたか | 23 | 5 |
| じいじ | 3 | ok | 1 | p04-new-year、p09-okonomiyaki | p07-field | ゆい: n10-field-yui | yes | この畑では、ほかにどんなことをして過ごしましたか | 24 | 3 |
| まさるおじさん | 3 | ok | 1 | p04-new-year、p09-okonomiyaki、p07-field | p08-dog | じいじ: n04-dog-jiiji | unknown | この犬のそばで、どんなふうに過ごしていたのか、聞かせてください | 31 | 3 |
| ゆい | 3 | ok | 1 | p04-new-year、p09-okonomiyaki、p07-field、p08-dog | p01-beach | ばあば: n01-beach-baaba | no | ばあばのこの話の、かき氷を食べた帰りの様子を聞かせてください | 30 | 3 |

## 一人ずつ

### お母さん（母、family。1 回目）

候補（並べた順）: p01-beach、p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> うちに親戚がえっと集まって、こたつに入りきらんで。

- receiver_present: unknown
- 問いかけ: こたつのまわりは、いつもどんな様子でしたか
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year: 母向けに祖母の語りが付き未出し。在席は語りから不明。退けたp01は母が既に語り、叔父と食い違う。focusは画像なしでnull。材料はn03。

### ばあば（祖母、elder。1 回目）

候補（並べた順）: p01-beach、p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p03-car

- 写真: p02-sports-day（説明: 校庭のトラックで、はちまきをした子どもたちが走っている。手前にテントがあり、大人が何人か立っている）
- focus: null
- 引用: n09-sports-day-mother（お母さん）

> リレーのアンカーで、最後のカーブで転んだんだけど、起き上がって走ったら、ばあばがテントの前で立ち上がって手を振ってた。

- receiver_present: yes
- 問いかけ: テントの前で過ごしたこの日のことを、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p02-sports-day。お母さんの語りにばあばが出てくるので優先。ばあばがその場にいたと読める。p01は語りが食い違うため退けた。画像なしでfocusはnull。材料はn09-sports-day-mother。

### じいじ（祖父、elder。1 回目）

候補（並べた順）: p07-field、p09-okonomiyaki、p06-wedding、p01-beach、p05-shichigosan、p03-car。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> じいじの畑で大根抜いたやつ。全然抜けなくて、じいじが後ろから引っぱってくれた。

- receiver_present: yes
- 問いかけ: この日の畑は、どんな様子だったのか聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p07-field を選択。孫ゆいの語りが付き未提示で、elder宛てに合う。語りに「じいじ」が出るため同席と判断。p01-beach は母とおじの語りが食い違うため退けた。画像なしで focus は null。材料は n10-field-yui。

### まさるおじさん（叔父、family。1 回目）

候補（並べた順）: p09-okonomiyaki、p06-wedding、p08-dog、p03-car、p01-beach、p05-shichigosan。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> 料理は近所の人が持ち寄ってくれて

- receiver_present: no
- 問いかけ: ばあばのこの話で、近所の人たちのことをもっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p06-wedding: 祖母ばあばの語りがあり未提示のため優先。受け取る人は式の場にいなかったと推測。p01は本人が返事済みで母との食い違いがあり退けた。画像なしでfocusはnull。材料はn05-wedding-baaba。

### ゆい（孫、family。1 回目）

候補（並べた順）: p08-dog、p01-beach、p03-car、p05-shichigosan、p09-okonomiyaki

- 写真: p01-beach（説明: 砂浜で、浮き輪を持った子どもと、海に向かって走る子ども、日傘をさした女性が写っている。遠くに小さな島が見える。色があせている）
- focus: null
- 引用: n01-beach-baaba（ばあば）

> わたしはもう、ずうっと浜から呼びよったんよ。

- receiver_present: no
- 問いかけ: ばあばの話のなかの浜の様子で、もっと聞いてみたいことはありますか
- 問いかけの検査（保存の形）: ok
- reason: p01-beach: ばあば・母・おじさんの語りが揃い未出し。昭和の話でゆいは不在と推測。p08は語り手の記憶が曖昧なので退けた。画像なしでfocusはnull。材料はn01。

### お母さん（母、family。2 回目）

候補（並べた順）: p01-beach、p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> お正月じゃね、これは。うちに親戚がえっと集まって、こたつに入りきらんで。

- receiver_present: unknown
- 問いかけ: この日のこたつのまわりの様子を、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year を選択。ばあばの語りがあり未提示。場にいたかは語りから不明。p01は本人が既に語り語りも食い違うため、p06は語りに欠落が多いため退けた。画像なしでfocusはnull。材料はn03。

### ばあば（祖母、elder。2 回目）

候補（並べた順）: p01-beach、p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p03-car

- 写真: p02-sports-day（説明: 校庭のトラックで、はちまきをした子どもたちが走っている。手前にテントがあり、大人が何人か立っている）
- focus: null
- 引用: n09-sports-day-mother（お母さん）

> 起き上がって走ったら、ばあばがテントの前で立ち上がって手を振ってた。

- receiver_present: yes
- 問いかけ: テントの前で過ごしたこの日のことを、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p02-sports-day。母の語りがあり、ばあば自身はまだ語っていない。ばあばが語りに出るので同席と判断。p01は本人の語りが既出で、母とおじの話も食い違うため退けた。画像なしでfocusはnull。材料はn09。

### じいじ（祖父、elder。2 回目）

候補（並べた順）: p07-field、p09-okonomiyaki、p06-wedding、p01-beach、p05-shichigosan、p03-car。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> じいじの畑で大根抜いたやつ。全然抜けなくて、じいじが後ろから引っぱってくれた。

- receiver_present: yes
- 問いかけ: この畑では、ほかにどんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p07-field:孫ゆいの語りがあり未出し。じいじ宛に届く。p01は語りが食い違うため退けた。語りにじいじが出るのでyes。画像なしfocusはnull。材料n10-field-yui

### まさるおじさん（叔父、family。2 回目）

候補（並べた順）: p09-okonomiyaki、p06-wedding、p08-dog、p03-car、p01-beach、p05-shichigosan。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> 料理は近所の人が持ち寄ってくれて、うちの父がお酒を

- receiver_present: no
- 問いかけ: ばあばのこの話で、料理のことをもっと聞いてみたいのは、どんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p06-wedding。ばあばの語りがあり、おじさん自身はまだ語っていないため。式の話で、おじさんは生まれる前と読める。退けたp01は本人が語り済み。画像なしでfocusはnull。材料はn05。

### ゆい（孫、family。2 回目）

候補（並べた順）: p08-dog、p01-beach、p03-car、p05-shichigosan、p09-okonomiyaki

- 写真: p01-beach（説明: 砂浜で、浮き輪を持った子どもと、海に向かって走る子ども、日傘をさした女性が写っている。遠くに小さな島が見える。色があせている）
- focus: null
- 引用: n01-beach-baaba（ばあば）

> 帰りに食べたかき氷が、ぶちおいしかったねえ。

- receiver_present: no
- 問いかけ: ばあばのかき氷の話で、もっと聞いてみたいのはどんなところですか
- 問いかけの検査（保存の形）: ok
- reason: p01-beach:ばあばの語りと家族の返事があり未出し。ゆいは昭和の話で不在と推測。退けたp08は語りが曖昧。画像なしでfocusはnull。材料n01

### お母さん（母、family。3 回目）

候補（並べた順）: p01-beach、p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> そういやあ、この頃は餅をうちでつきよったんよ。

- receiver_present: unknown
- 問いかけ: 餅をつく頃のうちでは、ほかにどんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year: ばあばの語りが付き、お母さんはまだ語っていないため優先。同席は語りから不明。p01は既にお母さんが語り食い違いもあり退けた。画像なしでfocusはnull。材料はn03。

### ばあば（祖母、elder。3 回目）

候補（並べた順）: p01-beach、p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p03-car

- 写真: p09-okonomiyaki（説明: 台所の鉄板の上で、お好み焼きが焼けている。へらを持った手が写っている）
- focus: null
- 引用: n08-okonomiyaki-yui（ゆい）

> ばあばのお好み焼き、また食べたい

- receiver_present: yes
- 問いかけ: お好み焼きを焼く日は、いつもどんな様子でしたか
- 問いかけの検査（保存の形）: ok
- reason: p09-okonomiyakiを選択。孫ゆいの言葉が付き、未提示で、ばあば宛ての内容。ばあばが焼いた料理の話なので現場にいたと推測。p01は本人が語済みで母とおじの話が食い違うため退けた。画像なしのためfocusはnull。材料はn08。

### じいじ（祖父、elder。3 回目）

候補（並べた順）: p07-field、p02-sports-day、p06-wedding、p01-beach、p05-shichigosan、p03-car。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> じいじの畑で大根抜いたやつ。全然抜けなくて、じいじが後ろから引っぱってくれた。

- receiver_present: yes
- 問いかけ: この畑では、ほかにどんなことをして過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p07-field。孫ゆいの語りが付き、未提示。じいじ本人が語りに出る。退けた: p01-beach は語りが食い違う。画像なしのため focus は null。材料: n10-field-yui

### まさるおじさん（叔父、family。3 回目）

候補（並べた順）: p02-sports-day、p06-wedding、p08-dog、p03-car、p01-beach、p05-shichigosan。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p08-dog（説明: 縁側に茶色の犬が寝そべっている。横に子どもの足が少し写っている）
- focus: null
- 引用: n04-dog-jiiji（じいじ）

> この犬はあれよ、ほら、あそこの家の。

- receiver_present: unknown
- 問いかけ: この犬のそばで、どんなふうに過ごしていたのか、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p08-dog。じいじの語りが付き、まだ出していない。持ち主は本人だが、その場にいたかは不明なのでunknown。p01は本人が語り済みで食い違いもあり退けた。画像なしでfocusはnull。材料はn04。

### ゆい（孫、family。3 回目）

候補（並べた順）: p02-sports-day、p06-wedding、p01-beach、p03-car、p05-shichigosan。<same_event> のむすび: mu-wrong-newyear-wedding

- 写真: p01-beach（説明: 砂浜で、浮き輪を持った子どもと、海に向かって走る子ども、日傘をさした女性が写っている。遠くに小さな島が見える。色があせている）
- focus: null
- 引用: n01-beach-baaba（ばあば）

> 帰りに食べたかき氷が、ぶちおいしかったねえ。

- receiver_present: no
- 問いかけ: ばあばのこの話の、かき氷を食べた帰りの様子を聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p01-beach を選択。ばあばの語りに母とまさるの返事が付き、未出しで最も言葉が多い。ゆいは昭和の話で不在と読める。母とまさるの食い違いは避け、ばあばの言葉を引用。画像なしのため focus は null。材料は n01。退けた p06 は語りが穴だらけ。
