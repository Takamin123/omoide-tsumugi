# 0013 文字起こしの欄: languages[]、keywords は家族由来の語だけ、数字は出力のまま

- 日付: 2026-11-02
- 状態: 採用
- 決めた人: 人間（呼ばれ方を OpenAI に送ること）、fable-advisor に相談（メインの会話）

## 決めたこと

- `language=ja` をやめ、`languages[]=ja` を送る。両方は送らない
- `keywords[]` には、家族自身に由来する語だけを入れる。今は members の呼ばれ方（calledAs）。整形ができたら records の origin=told の人名・地名を足す。origin=guessed の語と、位置から引いた地名は入れない。件数の上限は定数にする
- prompt は場面と話し方（家族が写真を見て思い出を語る、方言の地域、方言をそのまま書く）。keywords は綴りを固定したい固有名詞の列。prompt に固有名詞を並べず、keywords に指示文を入れない
- 方言の地域を prompt に入れる作りはそのまま
- 数字は文字起こしの出力のまま（昭和45年）。prompt で漢数字を求めず、後から書き換えない

## 理由

- gpt-transcribe では `languages[]` が公式の形。`language` は whisper 世代の欄で、whisper-1 の終了（2027-02-26）と一緒に消えても不思議はない
- keywords は文字起こしを導く手がかり（公式: "Words or phrases that guide transcription"）。推測の語を入れると、Claude の推測が家族の言葉の綴りに忍び込み、語ったことと推測を分ける線が文字起こしの段階で壊れる
- 呼ばれ方は家族の中の呼び名で（members に本名の欄はない）、録音の中にも出てくる語。録音はすでに OpenAI に渡っており、送る範囲は録音に含まれうる語の内側。綴りが揺れると、引用がその人の言葉として見えにくい
- 数字の表記は言った言葉そのもの。規則で漢数字に戻すと固有名詞（四谷、三十三間堂）を壊す。keywords に漢数字の語を入れても算用数字で書かれたので、表記を keywords で変えることもできない。祖父母の画面に文字起こしは出さない（0008）

## 退けた案とその理由

- `language=ja` のまま: 今は通るが、終了に合わせて消えたとき、文字起こしが全部 failed になる
- `keywords`（括弧なし）: 200 で通るが、効いたか外から分からない。公式の形だけ使う
- 方言の地域から連想した地名や、推測の語を keywords に入れる: 家族が語っていない語で綴りを寄せる
- 漢数字への後処理、prompt で表記を求める: 固有名詞を壊す。効き方が不安定

## 根拠にしたもの

- https://developers.openai.com/api/docs/guides/speech-to-text 、https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create 、https://developers.openai.com/cookbook/examples/migrating_from_whisper_to_gpt_transcribe （2026-11-02 に確認。multipart では `keywords[]` を一語ごとに繰り返す。gpt-transcribe では `languages[]` を使い、`language` と両方は送らない。keywords の件数・長さの上限と日本語の可否は記述なし）
- 実機での確かめ（2026-11-02、開発用ページ `/check`、0014）
  - `language=ja`・`response_format=json`・prompt（変える前の本番）: iPhone・iPad・Android のマイク（webm/opus）と録音済みファイル（m4a）がすべて 200 で文字になる
  - `languages[]=ja`・prompt・`keywords[]=鶴見川`・`keywords[]=昭和四十五年`: 200。鶴見川は正しく出る。昭和四十五年は「昭和45年」と書かれた（keywords でも数字の表記は変わらない）
  - 例文で言わない `keywords[]=多摩川` を足しても、文に書き足されない
  - `keywords=鶴見川`（括弧なし）: 200
  - keywords なしでも、「昭和四十五年」と読むと「昭和45年」と書かれる
  - エラー文のモデル名は中の名前だった。`gpt-transcribe` は別名で、版に振り分けられている
- docs/requirements.md「記録と言葉」「機能の要件（方言）」、docs/implementation-policy.md「2. Claude の呼び出し（渡すのは要るものだけ）」、0010

## 見直す条件

- whisper-1 の終了（2027-02-26）の前に、欄が公式の形のままかを確かめる
- 公式に keywords の上限が書かれたとき
- keywords を入れても呼ばれ方や地名の綴りが揺れるとき（出し比べで確かめてから prompt を触る）
- 数字の表記で家族が困ったとき（そのときも後処理で書き換えず、見せ方で考える）
- 家族が「文字が違う」と言ったとき（誰が直せるかは人間に聞く）
