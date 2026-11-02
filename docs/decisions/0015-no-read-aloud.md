# 0015 問いかけを読み上げない

- 日付: 2026-11-02
- 状態: 一部置き換え済み（問いかけの読み上げ → 0019）
- 決めた人: fable-advisor に相談（メインの会話）

## 決めたこと

- 問いかけは読み上げない。祖父母の画面でも大きな文字で見せる（implementation-policy「高齢の人の画面の最低ライン」に従う）
- 添える家族の言葉は、元が声なら本人の録音を流せるようにし、元が文字なら文字で見せる。機械の声で読まない。録音は語り全体を流す（0011）。祖父母の画面の主な動作はマイク一つのままにし、聞くボタンは補助の大きさに留める
- ブラウザ標準の speechSynthesis も、OpenAI の読み上げ（/v1/audio/speech）も使わない

## 理由

- 機械の声で問いかけを読むと、文が同じでも「話し手」が生まれ、AI が祖父母に話しかける形になる（requirements「AI は話し相手にならない」、implementation-policy「AI の存在を前に出さない」、0008）
- OpenAI の利用方針は「AI の声だと明示せよ」を義務にしており、「AI を出さない」方針と両立しない
- 要件は「高齢の家族は声で答える」であって「声で問われる」ではない。読むことは文字の最低ラインで支える
- 本人の録音を流すのは「家族が実際に語った言葉を中心にする」そのもので、文字起こしより本人に近い
- 実機で、speechSynthesis は速さ 0.8〜1.0 のどれも「機械的で違和感がある」。端末ごとに声も lang の書き方も違う
- OpenAI の読み上げのモデルは 2027-01-06 に止まり、後継は Realtime API 専用。費用と期限と移行の作業が増える

## 退けた案とその理由

- speechSynthesis: 費用はないが、機械の声で AI が話しかける形になる。実機で三台とも違和感。端末で印象が変わる
- OpenAI の読み上げを毎朝作って保存: 「AI の声です」の表示が義務で、方針と両立しない。2027-01-06 で止まる。声は英語向けで日本語の公式サンプルがない。費用が増える
- 今は決めない: 判断に要る材料はそろっている。先送りすると使わないものへの備えが残る
- 家族の言葉を機械の声で読む: 本人と祖父母の間に機械の声が挟まる。文字の方が本人の言葉に近い

## 根拠にしたもの

- 実機での確かめ（2026-11-02、開発用ページ `/check`、0014）
  - iPhone の Safari: 日本語の声は「Kyoko」が二つ並ぶ（聞いた違いはない）。lang は `ja-JP`
  - iPad の Safari: 「Kyoko」が一つ
  - Android の Chrome: 「日本語 日本」が一つ。lang は `ja_JP`、既定の声ではない
  - どれも速さ 0.8・0.9・1.0 で機械的で違和感がある。Android の方が若干ましという程度
- OpenAI 公式（2026-11-02 に確認）
  - https://developers.openai.com/api/docs/guides/text-to-speech （"Our usage policies require you to provide a clear disclosure to end users that the TTS voice they are hearing is AI-generated and not a human voice."、"Voices are currently optimized for English."）
  - https://developers.openai.com/api/docs/deprecations#2026-10-01-text-to-speech-models （tts-1、tts-1-hd、gpt-4o-mini-tts は 2027-01-06 に終了。後継の gpt-realtime-2.1-mini は /v1/audio/speech では使えない）
  - 利用規約と Service Terms の本文は、取得できず直接は読めていない
- docs/requirements.md「守る方針」、docs/implementation-policy.md「高齢の人の画面の最低ライン」「家族に見せる言葉」「3. Workers と逃げ道（つなぐサービスを増やさない）」、0008

## 見直す条件

- 実際の祖父母が、文字を 150% に拡大しても問いかけを読めないとき → 人間が決める。問い: 「読めない祖父母のために、機械の声で問いかけを読むことを、『AI の声です』という表示を付けてでも作品として許すか」。家族の誰かが問いかけを自分の声で吹き込む案は、Claude の推測が家族の声で語られて出所が曖昧になるので、これも人間が決める
- 「AI の声だと明示せよ」の義務がない読み上げが出てきたとき。ただし「AI が話しかける形になる」理由は残るので、上の条件と重なったときだけ見直す
- 0011 で語りの中の時刻が取れるようになったとき → 添える言葉の録音を引用の範囲だけ流すことを考える
