// VPS への逃げ道: アプリの中心（app.ts、core/、db/、routes/）が Workers 専用の API に直接つながっていないかを確かめる。
// docs/decisions/0002-cloudflare-workers.md
//
// worker-configuration.d.ts の型（D1Database など）は src/server 全体に見えるため、tsc -b だけでは見つけられない。
// そこで (1) ソースの字面を調べ、(2) Workers の型なしで中心だけを型検査する。
import { describe, expect, it } from "vitest";
import { childProcess, fs, path, processEnv, repoRoot } from "./node";

const serverDir = path.join(repoRoot, "src/server");
const coreRoots = ["app.ts", "core", "db", "routes", "demo"];

function listTs(p: string): string[] {
  const abs = path.join(serverDir, p);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return abs.endsWith(".ts") ? [abs] : [];
  return fs
    .readdirSync(abs, { recursive: true })
    .map((f: string) => path.join(abs, f))
    .filter((f: string) => f.endsWith(".ts") && fs.statSync(f).isFile());
}

const coreFiles = coreRoots.flatMap(listTs);
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// Workers 専用の型・グローバル
const forbiddenIdentifiers =
  /\b(D1Database|D1PreparedStatement|D1Result|R2Bucket|R2Object\w*|R2PutOptions|ExecutionContext|ExportedHandler|ScheduledController|ScheduledEvent|KVNamespace|DurableObject\w*|Fetcher|HTMLRewriter|Cloudflare|Env)\b/;
// Workers 専用のモジュール、または platform/ への依存
const forbiddenImport =
  /(?:from\s+|import\s*\(\s*|import\s+)["'](cloudflare:[^"']*|@cloudflare\/[^"']*|drizzle-orm\/d1[^"']*|hono\/cloudflare-[^"']*|[^"']*\/platform\/[^"']*)["']/;

describe("アプリの中心は Workers 専用の API を見ない", () => {
  it("調べる対象のファイルがある", () => {
    const rel = coreFiles.map((f) => path.relative(repoRoot, f));
    expect(rel).toContain("src/server/app.ts");
    expect(rel).toContain("src/server/core/ports.ts");
    expect(rel).toContain("src/server/core/morning.ts");
  });

  it.each(coreFiles.map((f) => [path.relative(repoRoot, f), f]))("%s", (_rel, file) => {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    expect(src).not.toMatch(forbiddenImport);
    expect(src).not.toMatch(forbiddenIdentifiers);
  });

  it("Workers の型（worker-configuration.d.ts）なしに、Node の型だけで中心が型検査を通る", () => {
    const dir = fs.mkdtempSync(path.join(repoRoot, "node_modules/.tmp-arch-"));
    try {
      const tsconfig = {
        extends: path.join(repoRoot, "tsconfig.base.json"),
        // VPS では Node で動かすので、Node の型（ReadableStream などの Web 標準を含む）だけで通ることを見る
        compilerOptions: { lib: ["ES2023"], types: ["node"], noEmit: true },
        files: coreFiles,
      };
      fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
      const tsc = path.join(repoRoot, "node_modules/.bin/tsc");
      const r = childProcess.spawnSync(tsc, ["-p", path.join(dir, "tsconfig.json")], {
        cwd: repoRoot,
        encoding: "utf8",
        env: processEnv(),
      });
      expect(`${r.stdout}${r.stderr}`).toBe("");
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("字面の検査が、Workers の型を見つけられる（検査そのものの確かめ）", () => {
    expect("export function f(db: D1Database) {}").toMatch(forbiddenIdentifiers);
    expect('import { env } from "cloudflare:workers";').toMatch(forbiddenImport);
    expect('import { drizzle } from "drizzle-orm/d1";').toMatch(forbiddenImport);
    expect('import { x } from "../platform/cloudflare/entry";').toMatch(forbiddenImport);
    expect(stripComments("// D1Database は platform/ だけ\nconst a = 1;")).not.toMatch(forbiddenIdentifiers);
  });
});
