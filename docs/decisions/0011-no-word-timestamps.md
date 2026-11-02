# 0011 文字起こしの時刻は使わない。引用は文字の範囲、再生は録音全体

- 日付: 2026-11-02
- 状態: 採用
- 決めた人: fable-advisor に相談（メインの会話）

## 決めたこと

- 文字起こしから言葉ごと・区間ごとの時刻は取らない。データにも持たない
- 添える家族の言葉（引用）は、語りの ID と文字の範囲（`quoteStart` / `quoteEnd`）で持つ
- 声を聞くときは、その語りの録音全体を流す。時刻で切り出さない
- 「引用の部分だけを声で」を、機械の読み上げで代わりにしない（0015）

## 理由

- 引用は語りからの引用そのもので、Claude には ID と範囲だけを返させる（implementation-policy「家族に見せる言葉」）。範囲の単位は文字で足りる
- 録音全体は家族の声そのもの。時刻で切ると、ずれたときに言っていない切れ方で聞こえる
- gpt-transcribe は時刻を返さない。whisper-1 は返すが日本語はほぼ一文字ごとに切れ、2027-02-26 に終了予定。終わる道具の上に機能を建てない

## 退けた案とその理由

- gpt-transcribe と whisper-1 を両方呼ぶ: 送る回数と費用が倍。時刻は荒く、終了予定のモデルの上に機能を建てることになる
- 語りを短く録る作りにして時刻を要らなくする: 技術の都合で高齢の人の話し方を縛る。0008 の二度押しの録音を変えることになり、人間が決めること
- 使い道が決まるまで決めない: 入り口と一覧の実装が時刻を前提にしないよう、原則だけ先に決める

## 根拠にしたもの

- 実機での確かめ（2026-11-02、iPhone の Safari、開発用ページ `/check`、0014）
  - gpt-transcribe に `response_format=verbose_json` を送ると 400「response_format 'verbose_json' is not compatible with model …, Use 'json' or 'text' instead」
  - `response_format=json` に `timestamp_granularities[]=word` を足すと、断られずに無視され、時刻なしで返る
  - whisper-1 の `verbose_json` ＋ word・segment は時刻を返すが、日本語はほぼ一文字ごと
- https://developers.openai.com/api/docs/guides/speech-to-text （`timestamp_granularities[]` は whisper-1 だけ。whisper-1 などは 2027-02-26 に終了予定）
- docs/requirements.md「記録と言葉」、docs/implementation-policy.md「家族に見せる言葉」「3. Workers と逃げ道」

## 見直す条件

- 家族から「長い録音のどこが引用か分からない」が出たとき。まず文字の引用を前に出す見せ方で解けないかを考え、それでも足りなければ gpt-transcribe 系が時刻を正式に返すようになっているかを確かめる。whisper-1 では解かない
- 一つの録音に複数の写真の話が混ざることが多いと分かったとき（文字の範囲で分けられるかを先に見る）
