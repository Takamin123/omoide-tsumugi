# 出し比べ: 入り口づくり（entrance/v2）family-a、同じ日の写真を外さない（0042 の前）

- 日付: 2026-11-03
- モデル: claude-sonnet-5-5（応答に書かれたもの: claude-sonnet-5-5）
- データ: evals/fixtures/family-a.json の 5 人 × 2 回の朝。人の順（毎朝の処理の順）: お母さん → ばあば → じいじ → まさるおじさん → ゆい。今日 = 2026-11-03
- 過去の入り口: なし
- 画像: なし（写真の説明だけ。focus は null だけを許す）
- 「引用の再利用」: 問いかけと画面に出る引用に共通する、いちばん長い連続した文字列の字数

## まとめ

- 作れた: 10 / 10（固定の入り口に倒れたもの: 0）
- 検査で再試行になったもの: 0
- トークン: 入力 63444、出力 10866

- 1 回目の朝: 異なる写真 4 / 5 人、異なる引用 4（引用あり 5）
- 2 回目の朝: 異なる写真 5 / 5 人、異なる引用 5（引用あり 5）

| 受け取る人 | 回 | 結果 | 試行 | 先の人の写真 | 写真 | 引用（語り手） | 問いかけ | 字数 | 引用の再利用 |
|---|---|---|---|---|---|---|---|---|---|
| お母さん | 1 | ok | 1 | - | p06-wedding | ばあば: n05-wedding-baaba | この日の座敷では、ほかにどんなことがあったのか、聞かせてください | 32 | 2 |
| ばあば | 1 | ok | 1 | p06-wedding | p02-sports-day | お母さん: n09-sports-day-mother | この日、テントの前ではほかにどんなことがありましたか | 26 | 6 |
| じいじ | 1 | ok | 1 | p06-wedding、p02-sports-day | p07-field | ゆい: n10-field-yui | 畑では、ほかにどんな時間を過ごしましたか | 20 | 1 |
| まさるおじさん | 1 | ok | 1 | p06-wedding、p02-sports-day、p07-field | p06-wedding | ばあば: n05-wedding-baaba | この日の集まりで、ほかにどんなことがあったのか、聞かせてください | 32 | 2 |
| ゆい | 1 | ok | 1 | p06-wedding、p02-sports-day、p07-field、p06-wedding | p04-new-year | ばあば: n03-new-year-baaba | 餅をついていたころのお正月は、ほかにどんな様子だったのか、聞かせてください | 37 | 2 |
| お母さん | 2 | ok | 1 | - | p06-wedding | ばあば: n05-wedding-baaba | この日、ほかにどんなことがあったのか、聞かせてください | 27 | 2 |
| ばあば | 2 | ok | 1 | p06-wedding | p02-sports-day | お母さん: n09-sports-day-mother | この日の運動会には、ほかにどんな場面がありましたか | 25 | 1 |
| じいじ | 2 | ok | 1 | p06-wedding、p02-sports-day | p07-field | ゆい: n10-field-yui | この日の畑では、ほかにどんなことがありましたか | 23 | 3 |
| まさるおじさん | 2 | ok | 1 | p06-wedding、p02-sports-day、p07-field | p04-new-year | ばあば: n03-new-year-baaba | 餅つきのときは、家の中や台所でどんなことがありましたか | 27 | 1 |
| ゆい | 2 | ok | 1 | p06-wedding、p02-sports-day、p07-field、p04-new-year | p01-beach | ばあば: n01-beach-baaba | 汽車に揺られていた時間は、どんな様子だったのか聞かせてください | 31 | 2 |

## 一人ずつ

### お母さん（母、family。1 回目）

候補（並べた順）: p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year、p01-beach

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> 料理は近所の人が持ち寄ってくれて、うちの父がお酒を

- 問いかけ: この日の座敷では、ほかにどんなことがあったのか、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p06-wedding を選択。母が生まれる前の場面で、ばあばの語りが付いており未提示。p01-beach は母と叔父の語りが食い違うため退けた。画像なしで focus は null。材料は n05-wedding-baaba。

### ばあば（祖母、elder。1 回目）

候補（並べた順）: p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p01-beach、p03-car

- 写真: p02-sports-day（説明: 校庭のトラックで、はちまきをした子どもたちが走っている。手前にテントがあり、大人が何人か立っている）
- focus: null
- 引用: n09-sports-day-mother（お母さん）

> 起き上がって走ったら、ばあばがテントの前で立ち上がって手を振ってた。

- 問いかけ: この日、テントの前ではほかにどんなことがありましたか
- 問いかけの検査（保存の形）: ok
- reason: p02-sports-day を選択。ばあばが場にいた話で、お母さんの語りが付いており、未出し。p01 は語りが食い違うため退けた。画像なしのため focus は null。材料は n09-sports-day-mother。

### じいじ（祖父、elder。1 回目）

候補（並べた順）: p07-field、p02-sports-day、p09-okonomiyaki、p06-wedding、p04-new-year、p01-beach

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> 全然抜けなくて、じいじが後ろから引っぱってくれた。

- 問いかけ: 畑では、ほかにどんな時間を過ごしましたか
- 問いかけの検査（保存の形）: ok
- reason: p07-field を選択。じいじ宛てで孫ゆいの語りがあり未出し。p01-beach は母とまさるの語りが食い違うため退けた。画像なしのため focus は null。材料は n10-field-yui。

### まさるおじさん（叔父、family。1 回目）

候補（並べた順）: p07-field、p02-sports-day、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> ひと晩じゅう歌うとったわ。

- 問いかけ: この日の集まりで、ほかにどんなことがあったのか、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p06-weddingを選択。ばあばの語りが付き、まだ出していない写真。p08-dogはじいじの記憶があいまいで退けた。画像がないためfocusはnull。材料はn05-wedding-baaba。

### ゆい（孫、family。1 回目）

候補（並べた順）: p02-sports-day、p06-wedding、p08-dog、p04-new-year、p01-beach、p03-car

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> そういやあ、この頃は餅をうちでつきよったんよ。前の晩から米を水につけて。

- 問いかけ: 餅をついていたころのお正月は、ほかにどんな様子だったのか、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year を選択。ゆいは family なので祖母ばあばの語りが付く写真を優先し、出した回数は全候補0。p01-beach はお母さんとまさるの語りが食い違うため退けた。画像なしのため focus は null。材料は n03-new-year-baaba。

### お母さん（母、family。2 回目）

候補（並べた順）: p07-field、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year、p01-beach

- 写真: p06-wedding（説明: 白黒の写真。広い板の間で、着物の女性と紋付きの男性が並んで座り、その前に料理の皿が並んでいる）
- focus: null
- 引用: n05-wedding-baaba（ばあば）

> 料理は近所の人が持ち寄ってくれて、

- 問いかけ: この日、ほかにどんなことがあったのか、聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p06-wedding を選択。母が自分の写真に載せた、ばあばの語りがある未出の写真。p01-beach は母とおじの語りが食い違うため退けた。画像なしで focus は null。材料は n05-wedding-baaba。

### ばあば（祖母、elder。2 回目）

候補（並べた順）: p07-field、p02-sports-day、p09-okonomiyaki、p08-dog、p01-beach、p03-car

- 写真: p02-sports-day（説明: 校庭のトラックで、はちまきをした子どもたちが走っている。手前にテントがあり、大人が何人か立っている）
- focus: null
- 引用: n09-sports-day-mother（お母さん）

> リレーのアンカーで、最後のカーブで転んだんだけど、起き上がって走ったら、ばあばがテントの前で立ち上がって手を振ってた。

- 問いかけ: この日の運動会には、ほかにどんな場面がありましたか
- 問いかけの検査（保存の形）: ok
- reason: p02-sports-day を選択。受け取る人が elder で、お母さんの語りがあり未出し。ばあば自身が語りに出る。p01 は語りが食い違うため退け、p07 も候補だったが p02 を優先。画像なしのため focus は null。材料は n09-sports-day-mother。

### じいじ（祖父、elder。2 回目）

候補（並べた順）: p07-field、p02-sports-day、p09-okonomiyaki、p06-wedding、p04-new-year、p01-beach

- 写真: p07-field（説明: 畑で、子どもが大根を両手で引っぱっている。後ろに麦わら帽子の年配の男性がいる）
- focus: null
- 引用: n10-field-yui（ゆい）

> じいじの畑で大根抜いたやつ。全然抜けなくて、じいじが後ろから引っぱってくれた。

- 問いかけ: この日の畑では、ほかにどんなことがありましたか
- 問いかけの検査（保存の形）: ok
- reason: p07-field を選択。受け取る人が elder で、孫ゆいの語りが付き、未出しのため。退けた p01-beach は語りが食い違う。画像なしで focus は null。材料は n10-field-yui。

### まさるおじさん（叔父、family。2 回目）

候補（並べた順）: p07-field、p02-sports-day、p09-okonomiyaki、p06-wedding、p08-dog、p04-new-year

- 写真: p04-new-year（説明: 和室のこたつを囲んで、大人と子どもが十人ほど座っている。机の上に重箱とみかんがある）
- focus: null
- 引用: n03-new-year-baaba（ばあば）

> うちに親戚がえっと集まって、こたつに入りきらんで。

- 問いかけ: 餅つきのときは、家の中や台所でどんなことがありましたか
- 問いかけの検査（保存の形）: ok
- reason: p04-new-year を選択。ばあばの語りが付き、受け取る人の持ち主写真で、その場にいた可能性が高い。p08-dog は名前を問う流れになりやすく、p06-wedding は受け取る人が生まれる前の話なので退けた。画像なしのため focus は null。材料は n03-new-year-baaba。

### ゆい（孫、family。2 回目）

候補（並べた順）: p02-sports-day、p06-wedding、p08-dog、p04-new-year、p01-beach、p03-car

- 写真: p01-beach（説明: 砂浜で、浮き輪を持った子どもと、海に向かって走る子ども、日傘をさした女性が写っている。遠くに小さな島が見える。色があせている）
- focus: null
- 引用: n01-beach-baaba（ばあば）

> お父さんが会社の休みをもろうて、汽車で行ったんよ。

- 問いかけ: 汽車に揺られていた時間は、どんな様子だったのか聞かせてください
- 問いかけの検査（保存の形）: ok
- reason: p01-beach を選択。ゆいに届く祖母ばあばの語りに、お母さんとまさるおじさんの返事が続き、家族の言葉が最も多い。ゆいは当時いない。食い違いのある n06、n07 は避け n01 から引用。画像なしのため focus は null。
