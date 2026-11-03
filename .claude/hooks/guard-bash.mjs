// Claude Code の PreToolUse フック（Bash）。
// - git commit: フックを飛ばす指定を止め、ステージした変更を scripts/check-staged.sh で検査する
// - D1 の本番への変更、本番の家族を消すこと、本番の R2 のファイルを消すこと: 必ず人間に確認を求める
// 理由は docs/decisions/0004-commit-guard.md と .claude/skills/d1-migrate/SKILL.md
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const cmd = String(input?.tool_input?.command ?? "");
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

function deny(reason) {
  process.stderr.write(reason + "\n");
  process.exit(2);
}

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// ---- git commit ----
const isCommit = /\bgit\s+(?:-[cC]\s+\S+\s+|--?[\w-]+(?:=\S+)?\s+)*commit\b/.test(cmd);
if (isCommit) {
  if (/--no-verify\b/.test(cmd) || /\bcommit\b[^;&|\n]*\s-[A-Za-z]*n[A-Za-z]*(\s|$)/.test(cmd)) {
    deny("コミットのフックを飛ばす指定（--no-verify / -n）は使えません。docs/decisions/0004-commit-guard.md");
  }
  if (/core\.hooksPath/.test(cmd)) {
    deny("コミットのときに core.hooksPath を変えることはできません。");
  }

  let hooksPath = "";
  try {
    hooksPath = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: projectDir, encoding: "utf8" }).trim();
  } catch {}
  if (hooksPath !== ".githooks") {
    deny(
      "git のコミット前フックが有効になっていません。先に `git config core.hooksPath .githooks` を実行してください。" +
        "（同じコマンドの中で git add してからコミットする場合も、git のフックで検査されるようにするため）",
    );
  }

  const r = spawnSync("bash", [join(projectDir, "scripts/check-staged.sh")], { cwd: projectDir, encoding: "utf8" });
  if (r.status !== 0) {
    deny((r.stderr || "") + (r.stdout || "") || "scripts/check-staged.sh が失敗しました。");
  }
}

// ---- D1 の本番への変更 ----
const isRemoteD1Write =
  /\bwrangler\b[^;&|\n]*\bd1\b[^;&|\n]*\b(migrations\s+apply|execute|time-travel\s+restore|delete)\b/.test(cmd) &&
  /--remote\b/.test(cmd);
const targetsPreview = /--env[=\s]+["']?preview\b/.test(cmd) || /(^|\s)-e[=\s]+["']?preview\b/.test(cmd);
if (isRemoteD1Write && !targetsPreview) {
  ask("本番の D1 を変更するコマンドです。適用するマイグレーションと影響を確かめてから許可してください。");
}

// ---- 本番の家族を消す・本番の R2 のファイルを消す（0031） ----
const isProdFamilyDelete = /\bdelete-family\.mjs\b[^;&|\n]*\bproduction\b/.test(cmd) && /--delete\b/.test(cmd);
if (isProdFamilyDelete) {
  ask("本番の家族の場を消すコマンドです。家族 ID と件数を確かめてから許可してください（0031）。");
}
const isRemoteR2Delete = /\bwrangler\b[^;&|\n]*\br2\b[^;&|\n]*\bobject\s+delete\b/.test(cmd) && /--remote\b/.test(cmd);
if (isRemoteR2Delete && !targetsPreview) {
  ask("本番の R2 のファイルを消すコマンドです。消すキーを確かめてから許可してください（0031）。");
}

process.exit(0);
