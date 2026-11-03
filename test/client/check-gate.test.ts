// 本番（APP_ENV=production）では、開発用の /check の画面をビルドに入れない（docs/decisions/0014）。
// 決め方（vite.check-page.ts）と、vite.config.ts が環境ごとに渡す __CHECK_PAGE__、App の読み込み方を確かめる。
// 実際のビルドの出力（chunk の有無）は npm run build / build:preview で確かめる。
import { afterEach, describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

// vite.config.ts と vite.check-page.ts は tsconfig.node の側なので、型の繋がりを作らないよう名前で読み込む
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): Promise<any> => import(name);
const { includeCheckPage } = await load("../../vite.check-page");

describe("includeCheckPage: 本番と APP_ENV がないときは入れない", () => {
  it("ビルド: production・空・なしでは入れない（閉じる側に倒す）", () => {
    expect(includeCheckPage({ command: "build", appEnv: "production" })).toBe(false);
    expect(includeCheckPage({ command: "build", appEnv: undefined })).toBe(false);
    expect(includeCheckPage({ command: "build", appEnv: "" })).toBe(false);
  });
  it("ビルド: preview・development では入れる", () => {
    expect(includeCheckPage({ command: "build", appEnv: "preview" })).toBe(true);
    expect(includeCheckPage({ command: "build", appEnv: "development" })).toBe(true);
  });
  it("手元（vite dev）では入れる", () => {
    expect(includeCheckPage({ command: "serve", appEnv: "production" })).toBe(true);
    expect(includeCheckPage({ command: "serve", appEnv: undefined })).toBe(true);
  });
});

describe("vite.config.ts: wrangler.jsonc の環境から __CHECK_PAGE__ を決める", () => {
  // test/ は Workers の型で検査するので、process は globalThis から any として取る（test/node.ts と同じ理由）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const process = (globalThis as any).process;
  const saved = process.env.CLOUDFLARE_ENV;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLOUDFLARE_ENV;
    else process.env.CLOUDFLARE_ENV = saved;
  });
  const defineFor = async (command: "build" | "serve", cfEnv: string | undefined) => {
    if (cfEnv === undefined) delete process.env.CLOUDFLARE_ENV;
    else process.env.CLOUDFLARE_ENV = cfEnv;
    const { default: config } = await load("../../vite.config");
    const resolved = await config({ command, mode: "production" });
    return resolved.define?.__CHECK_PAGE__;
  };

  it("本番のビルド（CLOUDFLARE_ENV なし）では false", async () => {
    expect(await defineFor("build", undefined)).toBe("false");
  });
  it("CLOUDFLARE_ENV が空の文字のビルドも本番扱いで false", async () => {
    expect(await defineFor("build", "")).toBe("false");
  });
  it("プレビューのビルド（CLOUDFLARE_ENV=preview）では true", async () => {
    expect(await defineFor("build", "preview")).toBe("true");
  });
  it("手元（vite dev）では true", async () => {
    expect(await defineFor("serve", undefined)).toBe("true");
  });
});

describe("App: check/ を読み込むのは __CHECK_PAGE__ が真のときだけ", () => {
  const app = fs.readFileSync(path.join(repoRoot, "src/client/App.tsx"), "utf8") as string;
  it("lazy の import は __CHECK_PAGE__ の三項の中にあり、偽なら null", () => {
    expect(app).toMatch(/const CheckPage = __CHECK_PAGE__ \? lazy\(\(\) => import\("\.\/check\/CheckPage"\)\) : null;/);
    expect(app.match(/import\("\.\/check\//g)).toHaveLength(1);
  });
  it("CheckPage が null なら /check は家族の画面と同じ道を通る（家族の読み込みをする）", () => {
    expect(app).toContain('const isCheck = CheckPage !== null && path === "/check";');
    expect(app).toMatch(/const needsFamily = [^;]*!isCheck;/);
  });
  // 運営の記録の画面（/ops/record）は __CHECK_PAGE__ の規則から外し、本番のビルドにも入れる（0030）。/check は外れたまま
  it("ops/ の lazy の import は __CHECK_PAGE__ に掛けない（常に読み込める）。家族の読み込みは通さない", () => {
    expect(app).toMatch(/const OpsRecordPage = lazy\(\(\) => import\("\.\/ops\/RecordPage"\)\);/);
    expect(app.match(/import\("\.\/ops\//g)).toHaveLength(1);
    expect(app).not.toMatch(/__CHECK_PAGE__[^;]*ops\//);
    expect(app).toContain('const isOps = path === "/ops/record";');
    expect(app).toMatch(/const needsFamily = [^;]*!isOps[ &;]/);
  });
});
