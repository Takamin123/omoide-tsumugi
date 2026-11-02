#!/usr/bin/env bash
# ステージされた変更に、写真・録音・データベースのファイル・秘密の値が含まれていないかを検査する。
# git の pre-commit フック（.githooks/pre-commit）と、Claude Code のフック（.claude/hooks/guard-bash.mjs）の両方から呼ばれる。
# 見つかったら 1 を返す。理由は docs/decisions/0004-commit-guard.md
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0
report() { echo "  ✗ $1" >&2; fail=1; }

media_ext='jpg|jpeg|png|gif|webp|heic|heif|avif|tif|tiff|bmp|raw|dng|cr2|nef|arw|psd|ico|mov|mp4|m4v|avi|mkv|3gp|m4a|mp3|wav|aac|ogg|oga|opus|flac|weba|webm|caf|amr|aiff|aif|wma'
db_ext='sqlite|sqlite3|db|db3|db-wal|db-shm|db-journal|sqlite-wal|sqlite-shm|sqlite-journal'

while IFS= read -r -d '' f; do
  lower=$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]')
  base=${lower##*/}

  case "$base" in
    .env.example | .dev.vars.example) ;;
    .env | .env.* | .dev.vars | .dev.vars.*) report "$f — 秘密の値のファイル（.env / .dev.vars）" ; continue ;;
  esac

  case "/$lower" in
    */.wrangler/*) report "$f — wrangler の手元のデータ（.wrangler/）" ; continue ;;
  esac

  if [[ "$base" =~ \.(${media_ext})$ ]]; then
    report "$f — 写真・画像・録音・動画のファイル（SVG 以外の画像は入れない）"; continue
  fi
  if [[ "$base" =~ \.(${db_ext})$ ]]; then
    report "$f — データベースのファイル"; continue
  fi

  # 拡張子を変えたファイルも、先頭のバイトで見分ける
  head_hex=$(git cat-file blob ":$f" 2>/dev/null | head -c 16 | od -An -tx1 | tr -d ' \n')
  case "$head_hex" in
    53514c69746520666f726d6174203300*) report "$f — 中身が SQLite のデータベース" ;;
    ffd8ff*)                           report "$f — 中身が JPEG" ;;
    89504e47*)                         report "$f — 中身が PNG" ;;
    47494638*)                         report "$f — 中身が GIF" ;;
    52494646????????57415645*)         report "$f — 中身が WAV" ;;
    52494646????????57454250*)         report "$f — 中身が WebP" ;;
    494433*)                           report "$f — 中身が MP3" ;;
    1a45dfa3*)                         report "$f — 中身が WebM / Matroska" ;;
    4f676753*)                         report "$f — 中身が Ogg" ;;
    ????????66747970*)                 report "$f — 中身が HEIC / MP4 / M4A など" ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMR -z)

# 追加した行に、API キーらしき文字列がないか
secret_patterns=(
  'sk-ant-[A-Za-z0-9_-]{20,}'                                   # Anthropic
  'sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}'               # OpenAI
  'AKIA[0-9A-Z]{16}'                                            # AWS 形式のアクセスキー
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'                          # 秘密鍵
  '(api[_-]?key|secret|token|password|access[_-]?key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_/+=-]{20,}'
)
pattern=$(IFS='|'; echo "${secret_patterns[*]}")

while IFS= read -r -d '' f; do
  [[ "$f" == "scripts/check-staged.sh" ]] && continue
  hits=$(git diff --cached -U0 --no-color -- "$f" | grep -E '^\+' | grep -vE '^\+\+\+' | grep -ainE -e "$pattern" | head -n 3)
  if [[ -n "$hits" ]]; then
    report "$f — API キーらしき文字列"
    while IFS= read -r line; do echo "      ${line:0:120}" >&2; done <<<"$hits"
  fi
done < <(git diff --cached --name-only --diff-filter=ACMR -z)

if [[ $fail -ne 0 ]]; then
  cat >&2 <<'EOF'

コミットを止めました。上のファイルを `git restore --staged <ファイル>` でステージから外してください。
写真・録音・データベース・秘密の値は、リポジトリに入れません（docs/decisions/0004-commit-guard.md）。
誤検知のときも、フックを飛ばさず人間に相談してください。
EOF
  exit 1
fi
exit 0
