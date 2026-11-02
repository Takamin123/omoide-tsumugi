// scripts/assert-build-env.mjs が、取り違えのときに deploy を止め、正しいときに通すかを確かめる。
// docs/decisions/0005-separate-preview-worker.md
//
// リポジトリの wrangler.jsonc は書き換えない。一時ディレクトリに設定の写しとビルドの出力を作り、そこで実行する。
// Cloudflare には触れない（ビルドと、設定ファイルの読み取りだけ）。
import { afterAll, describe, expect, it } from "vitest";
import { childProcess, fs, os, path, processEnv, repoRoot } from "./node";

const script = path.join(repoRoot, "scripts/assert-build-env.mjs");
const PROD_ID = "00000000-0000-4000-8000-000000000001";
const PREVIEW_ID = "00000000-0000-4000-8000-000000000002";

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "omoide-assert-env-"));
  tmpDirs.push(d);
  return d;
}

/** リポジトリの wrangler.jsonc を元に、文字列の置き換えをした写しを作る。 */
function wranglerJsonc(replacements: Array<[string | RegExp, string]> = []): string {
  let src = fs.readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8");
  // 実際の database_id（または仮の値）を、テスト用の ID に置き換える。1つ目が本番、2つ目がプレビュー
  const ids = [PROD_ID, PREVIEW_ID];
  let i = 0;
  src = src.replace(/("database_id"\s*:\s*)"[^"]*"/g, (_m: string, key: string) => `${key}"${ids[i++] ?? ""}"`);
  if (i !== 2) throw new Error(`wrangler.jsonc の database_id が2つではありません（${i}）`);
  for (const [from, to] of replacements) src = src.replace(from, to);
  // $schema はリポジトリの node_modules を指す
  return src.replace('"node_modules/wrangler/config-schema.json"', JSON.stringify(path.join(repoRoot, "node_modules/wrangler/config-schema.json")));
}

type Built = {
  name: string;
  APP_ENV: string;
  d1: { name: string; id: string };
  r2: string;
  crons?: string[];
};
const PROD: Built = { name: "omoide-tsumugi", APP_ENV: "production", d1: { name: "omoide-tsumugi", id: PROD_ID }, r2: "omoide-tsumugi" };
const PREVIEW: Built = {
  name: "omoide-tsumugi-preview",
  APP_ENV: "preview",
  d1: { name: "omoide-tsumugi-preview", id: PREVIEW_ID },
  r2: "omoide-tsumugi-preview",
};

/** vite build が書く形（.wrangler/deploy/config.json → dist/<worker>/wrangler.json）を真似て置く。 */
function writeBuildOutput(dir: string, b: Built) {
  fs.mkdirSync(path.join(dir, ".wrangler/deploy"), { recursive: true });
  fs.mkdirSync(path.join(dir, "dist/omoide_tsumugi"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".wrangler/deploy/config.json"),
    JSON.stringify({ configPath: "../../dist/omoide_tsumugi/wrangler.json", auxiliaryWorkers: [] }),
  );
  fs.writeFileSync(
    path.join(dir, "dist/omoide_tsumugi/wrangler.json"),
    JSON.stringify({
      name: b.name,
      main: "index.js",
      compatibility_date: "2026-11-01",
      vars: { APP_ENV: b.APP_ENV },
      d1_databases: [{ binding: "DB", database_name: b.d1.name, database_id: b.d1.id, migrations_dir: "../../drizzle/migrations" }],
      r2_buckets: [{ binding: "BUCKET", bucket_name: b.r2 }],
      triggers: { crons: b.crons ?? ["0 21 * * *"] },
    }),
  );
}

function run(dir: string, args: string[], extraEnv: Record<string, string> = {}) {
  const env = processEnv();
  delete env.WRANGLER_CI_OVERRIDE_NAME;
  delete env.CLOUDFLARE_ENV;
  const r = childProcess.spawnSync(process_execPath(), [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...env, ...extraEnv },
  });
  return { status: r.status as number, out: `${r.stdout}${r.stderr}` as string };
}
const process_execPath = (): string => (globalThis as any).process.execPath; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup(opts: { jsonc?: Array<[string | RegExp, string]>; built?: Built | null } = {}) {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "wrangler.jsonc"), wranglerJsonc(opts.jsonc));
  if (opts.built) writeBuildOutput(dir, opts.built);
  return dir;
}

describe("assert-build-env.mjs（設定の写しと、真似たビルドの出力で）", () => {
  it("本番のビルドを production で確かめると通る", () => {
    const r = run(setup({ built: PROD }), ["production"]);
    expect(r.out).toContain("✓ production");
    expect(r.status).toBe(0);
  });

  it("プレビューのビルドを preview で確かめると通る", () => {
    const r = run(setup({ built: PREVIEW }), ["preview"]);
    expect(r.out).toContain("✓ preview");
    expect(r.status).toBe(0);
  });

  it("本番のビルドを preview で上げようとすると止まる", () => {
    const r = run(setup({ built: PROD }), ["preview"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("preview のものではありません");
  });

  it("プレビューのビルドを production で上げようとすると止まる", () => {
    const r = run(setup({ built: PREVIEW }), ["production"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("production のものではありません");
  });

  it("名前だけがプレビューで、D1 が本番のものなら止まる", () => {
    const r = run(setup({ built: { ...PREVIEW, d1: PROD.d1 } }), ["preview"]);
    expect(r.status).toBe(1);
  });

  it("名前だけがプレビューで、R2 が本番のものなら止まる", () => {
    const r = run(setup({ built: { ...PREVIEW, r2: PROD.r2 } }), ["preview"]);
    expect(r.status).toBe(1);
  });

  it("database_id が仮の値のままなら止まる（本番）", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "wrangler.jsonc"), wranglerJsonc([[PROD_ID, "REPLACE_WITH_PRODUCTION_D1_ID"]]));
    writeBuildOutput(dir, { ...PROD, d1: { ...PROD.d1, id: "REPLACE_WITH_PRODUCTION_D1_ID" } });
    const r = run(dir, ["production"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("仮の値");
  });

  it("database_id が仮の値のままなら止まる（プレビュー）", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "wrangler.jsonc"), wranglerJsonc([[PREVIEW_ID, "REPLACE_WITH_PREVIEW_D1_ID"]]));
    writeBuildOutput(dir, { ...PREVIEW, d1: { ...PREVIEW.d1, id: "REPLACE_WITH_PREVIEW_D1_ID" } });
    const r = run(dir, ["preview"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("仮の値");
  });

  it("wrangler.jsonc で、本番とプレビューが同じ D1 を指していたら止まる", () => {
    const dir = setup({ jsonc: [[PREVIEW_ID, PROD_ID]], built: { ...PREVIEW, d1: { ...PREVIEW.d1, id: PROD_ID } } });
    for (const target of ["preview", "production"]) {
      if (target === "production") writeBuildOutput(dir, PROD);
      const r = run(dir, [target]);
      expect(r.status, target).toBe(1);
      expect(r.out).toContain("同じものを指しています");
    }
  });

  it("wrangler.jsonc で、本番とプレビューが同じ R2 を指していたら止まる", () => {
    const dir = setup({
      jsonc: [['"bucket_name": "omoide-tsumugi-preview"', '"bucket_name": "omoide-tsumugi"']],
      built: { ...PREVIEW, r2: "omoide-tsumugi" },
    });
    const r = run(dir, ["preview"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("R2=omoide-tsumugi");
  });

  it("wrangler.jsonc で、プレビューの Worker の名前が本番と同じなら止まる", () => {
    const dir = setup({
      jsonc: [['"name": "omoide-tsumugi-preview"', '"name": "omoide-tsumugi"']],
      built: { ...PREVIEW, name: "omoide-tsumugi" },
    });
    const r = run(dir, ["preview"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Worker=omoide-tsumugi");
  });

  it("wrangler.jsonc のプレビューの APP_ENV が production なら止まる", () => {
    const dir = setup({
      jsonc: [['"APP_ENV": "preview"', '"APP_ENV": "production"']],
      built: { ...PREVIEW, APP_ENV: "production" },
    });
    const r = run(dir, ["preview"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("APP_ENV");
  });

  it("cron が wrangler.jsonc と違うビルドなら止まる", () => {
    const r = run(setup({ built: { ...PREVIEW, crons: [] } }), ["preview"]);
    expect(r.status).toBe(1);
  });

  it("WRANGLER_CI_OVERRIDE_NAME がビルドの名前と違うと止まり、同じなら通る", () => {
    const dir = setup({ built: PREVIEW });
    const bad = run(dir, ["preview"], { WRANGLER_CI_OVERRIDE_NAME: "omoide-tsumugi" });
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("Workers Builds の Worker");
    const ok = run(dir, ["preview"], { WRANGLER_CI_OVERRIDE_NAME: "omoide-tsumugi-preview" });
    expect(ok.status).toBe(0);

    const prodDir = setup({ built: PROD });
    expect(run(prodDir, ["production"], { WRANGLER_CI_OVERRIDE_NAME: "omoide-tsumugi-preview" }).status).toBe(1);
    expect(run(prodDir, ["production"], { WRANGLER_CI_OVERRIDE_NAME: "omoide-tsumugi" }).status).toBe(0);
  });

  it("CLOUDFLARE_ENV が環境に残っていても、取り違えたビルドは通さない", () => {
    // wrangler の readConfig は env を省くと CLOUDFLARE_ENV を見る。そのときも安全側（止まる）に倒れるか
    expect(run(setup({ built: PREVIEW }), ["production"], { CLOUDFLARE_ENV: "preview" }).status).not.toBe(0);
    expect(run(setup({ built: PROD }), ["preview"], { CLOUDFLARE_ENV: "preview" }).status).not.toBe(0);
    expect(run(setup({ built: PROD }), ["preview"], { CLOUDFLARE_ENV: "production" }).status).not.toBe(0);
  });

  it("CLOUDFLARE_ENV が環境に残っていても、正しいビルドは通す（Workers Builds のビルド変数に置いた場合）", () => {
    expect(run(setup({ built: PREVIEW }), ["preview"], { CLOUDFLARE_ENV: "preview" }).status).toBe(0);
    expect(run(setup({ built: PROD }), ["production"], { CLOUDFLARE_ENV: "preview" }).status).toBe(0);
    expect(run(setup({ built: PROD }), ["production"], { CLOUDFLARE_ENV: "production" }).status).toBe(0);
  });

  it("ビルドの出力がなければ止まる", () => {
    const r = run(setup({ built: null }), ["production"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("先に vite build");
  });

  it("環境の名前が違えば、使い方を出して止まる", () => {
    const dir = setup({ built: PROD });
    expect(run(dir, []).status).toBe(2);
    expect(run(dir, ["prod"]).status).toBe(2);
  });
});

// 本物の vite build で、CLOUDFLARE_ENV ごとのバインディングと、assert の結果を確かめる。
describe("assert-build-env.mjs（一時コピーで本物の vite build をして）", () => {
  const dir = tmpDir();
  for (const f of ["index.html", "vite.config.ts", "vite.check-page.ts", "package.json", "tsconfig.json", "tsconfig.base.json", "tsconfig.client.json", "tsconfig.worker.json", "tsconfig.node.json"]) {
    fs.copyFileSync(path.join(repoRoot, f), path.join(dir, f));
  }
  fs.cpSync(path.join(repoRoot, "src"), path.join(dir, "src"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "drizzle"), path.join(dir, "drizzle"), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "wrangler.jsonc"), wranglerJsonc());

  const build = (cloudflareEnv?: string) => {
    const env = processEnv();
    delete env.CLOUDFLARE_ENV;
    if (cloudflareEnv) env.CLOUDFLARE_ENV = cloudflareEnv;
    const r = childProcess.spawnSync(path.join(repoRoot, "node_modules/.bin/vite"), ["build"], { cwd: dir, encoding: "utf8", env });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const { configPath } = JSON.parse(fs.readFileSync(path.join(dir, ".wrangler/deploy/config.json"), "utf8"));
    return JSON.parse(fs.readFileSync(path.resolve(dir, ".wrangler/deploy", configPath), "utf8"));
  };
  /** クライアントの出力にある、開発用の /check の chunk（docs/decisions/0014） */
  const checkChunks = () => (fs.readdirSync(path.join(dir, "dist/client/assets")) as string[]).filter((n) => /^CheckPage-.*\.js$/.test(n));

  it("vite build（本番）: 本番のバインディングになり、production は通り preview は止まる", () => {
    const c = build();
    expect(c.name).toBe("omoide-tsumugi");
    expect(c.vars).toEqual({ APP_ENV: "production" });
    expect(c.d1_databases.map((d: { database_name: string; database_id: string }) => [d.database_name, d.database_id])).toEqual([["omoide-tsumugi", PROD_ID]]);
    expect(c.r2_buckets.map((b: { bucket_name: string }) => b.bucket_name)).toEqual(["omoide-tsumugi"]);
    expect(c.triggers.crons).toEqual(["0 21 * * *"]);
    expect(run(dir, ["production"]).status).toBe(0);
    expect(run(dir, ["preview"]).status).toBe(1);
    // 本番のビルドには、開発用の /check の chunk も、その中身も入らない
    expect(checkChunks()).toEqual([]);
    const assets = path.join(dir, "dist/client/assets");
    for (const n of fs.readdirSync(assets) as string[]) expect(fs.readFileSync(path.join(assets, n), "utf8"), n).not.toContain("/api/check/");
  }, 60_000);

  it("CLOUDFLARE_ENV=preview vite build: プレビューのバインディングになり、preview は通り production は止まる", () => {
    const c = build("preview");
    expect(c.name).toBe("omoide-tsumugi-preview");
    expect(c.vars).toEqual({ APP_ENV: "preview" });
    expect(c.d1_databases.map((d: { database_name: string; database_id: string }) => [d.database_name, d.database_id])).toEqual([["omoide-tsumugi-preview", PREVIEW_ID]]);
    expect(c.r2_buckets.map((b: { bucket_name: string }) => b.bucket_name)).toEqual(["omoide-tsumugi-preview"]);
    expect(c.triggers.crons).toEqual(["0 21 * * *"]);
    expect(run(dir, ["preview"]).status).toBe(0);
    expect(run(dir, ["production"]).status).toBe(1);
    // プレビューのビルドには、開発用の /check の chunk が入る
    expect(checkChunks()).toHaveLength(1);
  }, 60_000);
});
