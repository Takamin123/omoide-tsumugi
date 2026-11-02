# 0001 エージェントの構成と Fable の使い方

- 日付: 2026-11-02
- 状態: 採用
- 決めた人: 人間（キックオフ時）

## 決めたこと

- エージェントは5つにする: fable-advisor（Fable）、frontend-developer、backend-developer、qa-engineer、code-reviewer（すべて Opus）
- Fable は、相談と区切りのレビュー（機能のまとまりが一つできたとき、一日の終わりなど）にだけ使う。コミットごとのレビューは、Opus の code-reviewer が差分だけを見て行う
- 実装エージェントは、コミットの前に qa-engineer のテストと code-reviewer のレビューを通す
- 作品の方針、データの形、画面の流れ、家族に見せる言葉、使い心地が変わる選択は、fable-advisor に相談する。相談した側のエージェントが、結果をこのフォルダに記録する
- 各エージェントの進め方は CLAUDE.md ではなく、各エージェントの定義ファイルに書く。動くエージェントが自分のファイルだけを読めば済むようにするため
- インフラ専門のエージェントは置かない。Workers ならではの制約は backend-developer の定義に書く

## 理由

- Fable は利用量が大きい可能性がある。回数の多いコミットごとのレビューに使うと、1週間もたない恐れがある
- 作品の考え方に関わる判断を一か所（fable-advisor）に集めると、判断がぶれにくい

## 退けた案とその理由

- インフラ専門のエージェント: 1週間の開発では、受け渡しの手間が利点を上回る。迷ったときは fable-advisor に相談すれば足りる
- すべてのレビューを Fable に任せる: 利用量の面で続かない

## 根拠にしたもの

- サブエージェントの `model` には `fable` を指定できる（Fable 5.1、Claude Code v2.1.257 以降が必要）。https://code.claude.com/docs/en/sub-agents.md 、https://code.claude.com/docs/en/model-config.md
- プランによっては、Fable の利用がプランの枠ではなく usage credits から引かれる（`/model` の選択画面に "Requires usage credits" と表示される）。プランごとの提供状況の一覧は、公式ドキュメントでは見つからなかった
- サブエージェントは、別のサブエージェントを呼べる（既定でメインの会話から3層まで）。このため、実装エージェントが自分で qa-engineer、code-reviewer、fable-advisor を呼べる。同じく sub-agents.md

## 見直す条件

- Fable が使えない場合、または利用量が想定を超えた場合は、fable-advisor のモデルを `opus` に替える
