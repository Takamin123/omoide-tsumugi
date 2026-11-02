# おもいでつむぎ

離れて暮らす家族が、アルバムを囲むように思い出を語り合える場。Built with Claude: Japan 2026 の作品。

- 要件と守る方針: [docs/requirements.md](docs/requirements.md)（作業の前に必ず読む）
- 基本仕様: [docs/spec.md](docs/spec.md)
- なぜそう決めたか: [docs/decisions/](docs/decisions/)
- ドキュメントの方針（どこに何を書くか）: [docs/README.md](docs/README.md)

## 約束

- 詳細設計はソースを正とする。ドキュメントの記述とソースが食い違ったら、ソースを信じる
- 実際の家族の写真・声・データはリポジトリに入れない（コミット前のフックで止まる）
- 作業は `develop` で行う。`main` は常にデモできる状態にする。Pull Request は使わない
- 各エージェントの役割と進め方は `.claude/agents/` の各定義ファイルに書いてある
