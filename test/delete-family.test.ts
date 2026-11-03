// scripts/delete-family.mjs（家族の場をまるごと消す。0027、0031）を、手元の D1・R2 で確かめる。
// 消す家族とは別に、残す家族とデモの家族を作り、消した後もそれらの行とファイルが残ることを見る。
// 家族はすべて架空。R2 に入れるのは数バイトの架空のバイト列だけ。
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/server/db/schema";
import { startD1 } from "./helpers";
import { childProcess, fs, os, path, processEnv, repoRoot } from "./node";

/* eslint-disable @typescript-eslint/no-explicit-any */
const lib: any = await import(path.join(repoRoot, "scripts/delete-family.mjs") as string);
const script = path.join(repoRoot, "scripts/delete-family.mjs");

const tables: SQLiteTable[] = (Object.values(schema) as unknown[]).filter((t): t is SQLiteTable => is(t, SQLiteTable));

describe("消す表の一覧（schema.ts を正とする）", () => {
  it("schema.ts の表を、漏れも余りもなく含む", () => {
    expect([...lib.FAMILY_TABLES].sort()).toEqual(tables.map((t) => getTableConfig(t).name).sort());
  });

  it("families のほかの表は、どれも family_id を持つ", () => {
    for (const t of tables) {
      const c = getTableConfig(t);
      if (c.name === "families") continue;
      expect(c.columns.map((col) => col.name), c.name).toContain("family_id");
    }
  });

  it("外部キーの子が親より先に消える順になっている", () => {
    const order: string[] = lib.FAMILY_TABLES;
    for (const t of tables) {
      const c = getTableConfig(t);
      for (const fk of c.foreignKeys) {
        const parent = getTableConfig(fk.reference().foreignTable).name;
        if (parent === c.name) continue;
        expect(order.indexOf(c.name), `${c.name} → ${parent}`).toBeLessThan(order.indexOf(parent));
      }
    }
  });
});

// ---- 手元の D1・R2（メモリの中） ----

const A = "aaaaaaaa-0000-4000-8000-000000000001"; // 消す家族
const B = "bbbbbbbb-0000-4000-8000-000000000002"; // 残す家族
const D = "dddddddd-0000-4000-8000-000000000003"; // デモの家族

/** 全部の表に一行以上ずつ、架空の行を入れる。R2 にも、D1 が指すファイルを入れる */
async function seedFamily(d1: D1Database, bucket: R2Bucket, id: string, isDemo: boolean): Promise<void> {
  const p = id.slice(0, 8);
  const pre = `families/${id}`;
  const keys = { photo: `${pre}/photos/${p}-ph.jpg`, audio: `${pre}/audio/${p}-n1`, speech: `${pre}/speech/${p}-e1-x.mp3` };
  const now = 1;
  await d1.batch([
    d1.prepare("INSERT INTO families (id, name, is_demo, created_at) VALUES (?, '架空の家族', ?, ?)").bind(id, isDemo ? 1 : 0, now),
    d1.prepare("INSERT INTO invite_links (id, family_id, token_hash, created_at) VALUES (?, ?, ?, ?)").bind(`${p}-inv`, id, `${p}-hash`, now),
    d1
      .prepare("INSERT INTO members (id, family_id, role, relation, called_as, speech_style, created_at) VALUES (?, ?, 'elder', '祖母', 'おばあちゃん', 'standard', ?)")
      .bind(`${p}-m1`, id, now),
    d1
      .prepare("INSERT INTO photos (id, family_id, owner_member_id, storage_key, content_hash, width, height, created_at) VALUES (?, ?, ?, ?, 'h', 1, 1, ?)")
      .bind(`${p}-ph`, id, `${p}-m1`, keys.photo, now),
    d1
      .prepare("INSERT INTO photo_guesses (id, photo_id, family_id, description, model, prompt_version, created_at) VALUES (?, ?, ?, '架空', 'm', 'v1', ?)")
      .bind(`${p}-pg`, `${p}-ph`, id, now),
    d1
      .prepare("INSERT INTO photo_guess_requests (photo_id, prompt_version, family_id, state, attempts, claimed_at) VALUES (?, 'v2', ?, 'failed', 1, ?)")
      .bind(`${p}-ph`, id, now),
    d1
      .prepare(
        "INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, question, kind, model, prompt_version, question_audio_key, created_at) VALUES (?, ?, ?, '2026-11-03', ?, '架空の問い', 'claude', 'm', 'v2', ?, ?)",
      )
      .bind(`${p}-e1`, id, `${p}-m1`, `${p}-ph`, keys.speech, now),
    d1
      .prepare(
        "INSERT INTO narrations (id, family_id, speaker_member_id, photo_id, entrance_id, kind, audio_key, transcript_status, for_date, created_at) VALUES (?, ?, ?, ?, ?, 'voice', ?, 'done', '2026-11-03', ?)",
      )
      .bind(`${p}-n1`, id, `${p}-m1`, `${p}-ph`, `${p}-e1`, keys.audio, now),
    d1
      .prepare("INSERT INTO records (id, family_id, photo_id, kind, value, origin, told_by_member_id, narration_id, created_at) VALUES (?, ?, ?, 'place', '架空', 'told', ?, ?, ?)")
      .bind(`${p}-r1`, id, `${p}-ph`, `${p}-m1`, `${p}-n1`, now),
    d1
      .prepare(
        "INSERT INTO record_extractions (narration_id, family_id, prompt_version, model, state, attempts, input_tokens, output_tokens, created_at) VALUES (?, ?, 'extract_records/v1', 'm', 'done', 1, 1, 1, ?)",
      )
      .bind(`${p}-n1`, id, now),
    d1.prepare("INSERT INTO musubi (id, family_id, created_by, created_at) VALUES (?, ?, 'family', ?)").bind(`${p}-mu`, id, now),
    d1
      .prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, evidence_narration_id, created_at) VALUES (?, ?, ?, 'confirmed', ?, ?)")
      .bind(`${p}-mu`, `${p}-ph`, id, `${p}-n1`, now),
  ]);
  for (const k of Object.values(keys)) await bucket.put(k, new Uint8Array([1, 2, 3]));
  // D1 のどの行も指さないファイル（孤児）も、接頭の下に置く
  await bucket.put(`${pre}/photos/${p}-orphan.jpg`, new Uint8Array([4]));
}

const ONE_EACH = Object.fromEntries(
  ["records", "record_extractions", "musubi_photos", "musubi", "photo_guess_requests", "photo_guesses", "narrations", "entrances", "photos", "invite_links", "members", "families"].map(
    (t) => [t, 1],
  ),
);
const ZERO_EACH = Object.fromEntries(Object.keys(ONE_EACH).map((t) => [t, 0]));

describe("数える・消す（手元の D1・R2）", () => {
  let env: { DB: D1Database; BUCKET: R2Bucket };
  const disposers: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const d of disposers) await d();
  });

  beforeEach(async () => {
    const s = await startD1();
    disposers.push(s.dispose);
    env = { DB: s.d1, BUCKET: s.bucket };
    await seedFamily(s.d1, s.bucket, A, false);
    await seedFamily(s.d1, s.bucket, B, false);
    await seedFamily(s.d1, s.bucket, D, true);
    await s.bucket.put("demo/seed/x.jpg", new Uint8Array([9]));
  });

  it("件数と種類だけを数える（接頭の下の孤児も R2 の数に入る）", async () => {
    const c = await lib.countFamily(env, A);
    expect(c).toEqual({
      familyId: A,
      exists: true,
      isDemo: false,
      tables: ONE_EACH,
      referencedKeys: 3,
      keysOutsidePrefix: 0,
      othersInPrefix: 0,
      r2Objects: 4,
    });
    expect(JSON.stringify(c)).not.toContain("架空");
    expect((await lib.countFamily(env, D)).isDemo).toBe(true);
  });

  it("その家族の行とファイルを全部消し、ほかの家族とデモの素材は残す", async () => {
    const logs: string[] = [];
    const r = await lib.deleteFamily(env, A, { log: (m: string) => logs.push(m) });
    expect(r.before.tables).toEqual(ONE_EACH);
    expect(r.r2Deleted).toBe(4);
    expect(r.after).toEqual({ familyId: A, exists: false, isDemo: null, tables: ZERO_EACH, referencedKeys: 0, keysOutsidePrefix: 0, othersInPrefix: 0, r2Objects: 0 });
    expect(lib.isEmpty(r.after)).toBe(true);
    // ログには件数だけ（キーや家族 ID を出さない）
    expect(logs.join("\n")).not.toContain("families/");

    for (const other of [B, D]) {
      const c = await lib.countFamily(env, other);
      expect(c.tables).toEqual(ONE_EACH);
      expect(c.r2Objects).toBe(4);
    }
    expect(await env.BUCKET.head("demo/seed/x.jpg")).not.toBeNull();
  });

  it("もう一度呼んでも何も壊さない（途中で落ちたときのやり直し）", async () => {
    await lib.deleteFamily(env, A);
    const r = await lib.deleteFamily(env, A);
    expect(r.r2Deleted).toBe(0);
    expect(lib.isEmpty(r.after)).toBe(true);
    expect((await lib.countFamily(env, B)).tables).toEqual(ONE_EACH);
  });

  it("D1 の行が接頭の外のキーを指していたら、何も消さずに止める", async () => {
    await env.DB.prepare("UPDATE photos SET storage_key = 'demo/seed/x.jpg' WHERE family_id = ?").bind(A).run();
    await expect(lib.deleteFamily(env, A)).rejects.toThrow(/外のキー/);
    const c = await lib.countFamily(env, A);
    expect(c.tables).toEqual(ONE_EACH);
    expect(c.keysOutsidePrefix).toBe(1);
    expect(await env.BUCKET.head("demo/seed/x.jpg")).not.toBeNull();
  });

  it("ほかの家族の行がこの家族の接頭の下を指していたら、何も消さずに止める", async () => {
    await env.DB.prepare("UPDATE narrations SET audio_key = ? WHERE family_id = ?").bind(`families/${A}/audio/x`, B).run();
    expect((await lib.countFamily(env, A)).othersInPrefix).toBe(1);
    await expect(lib.deleteFamily(env, A)).rejects.toThrow(/ほかの家族/);
    const c = await lib.countFamily(env, A);
    expect(c.tables).toEqual(ONE_EACH);
    expect(c.r2Objects).toBe(4);
  });

  it("デモの家族は、allowDemo なしでは消さない", async () => {
    await expect(lib.deleteFamily(env, D)).rejects.toThrow(/デモ/);
    expect((await lib.countFamily(env, D)).tables).toEqual(ONE_EACH);
    const r = await lib.deleteFamily(env, D, { allowDemo: true });
    expect(lib.isEmpty(r.after)).toBe(true);
    expect((await lib.countFamily(env, A)).tables).toEqual(ONE_EACH);
  });

  it("R2 の一覧が何ページにも分かれても、数え漏れも消し漏れもない", async () => {
    // 一覧の 1 ページを 2 件に絞った包み（本物は 1000 件で区切られる）
    const real = env.BUCKET;
    const paged = {
      list: (o: R2ListOptions) => real.list({ ...o, limit: Math.min(o?.limit ?? 1000, 2) }),
      delete: (k: string | string[]) => real.delete(k),
      head: (k: string) => real.head(k),
    };
    for (let i = 0; i < 5; i++) await real.put(`families/${A}/photos/extra-${i}.jpg`, new Uint8Array([i]));
    const penv = { DB: env.DB, BUCKET: paged };
    expect((await lib.countFamily(penv, A)).r2Objects).toBe(9);
    const r = await lib.deleteFamily(penv, A);
    expect(r.r2Deleted).toBe(9);
    expect(lib.isEmpty(r.after)).toBe(true);
    expect((await lib.countFamily(env, B)).r2Objects).toBe(4);
  });

  it("R2 の delete が効かないときは、回り続けずに止める", async () => {
    const real = env.BUCKET;
    const stuck = { list: (o: R2ListOptions) => real.list(o), delete: async () => {}, head: (k: string) => real.head(k) };
    await expect(lib.deleteFamily({ DB: env.DB, BUCKET: stuck }, A)).rejects.toThrow(/残っています/);
    // 本物の bucket でもう一度呼べば続きから消える
    expect(lib.isEmpty((await lib.deleteFamily(env, A)).after)).toBe(true);
  });

  it("接頭は末尾のスラッシュまで見る（ID で始まるだけの、接頭の外のキーは残す）", async () => {
    const near = [`families/${A}`, `families/${A}.bak`, `families/${A}x/photos/p.jpg`, `families/${A.slice(0, -1)}/photos/p.jpg`];
    for (const k of near) await env.BUCKET.put(k, new Uint8Array([7]));
    expect((await lib.countFamily(env, A)).r2Objects).toBe(4);
    const r = await lib.deleteFamily(env, A);
    expect(r.r2Deleted).toBe(4);
    for (const k of near) expect(await env.BUCKET.head(k), k).not.toBeNull();
  });

  it.each([
    ["narrations", "audio_key"],
    ["entrances", "question_audio_key"],
  ])("%s.%s がほかの家族のキーを指していても、何も消さずに止める", async (table, col) => {
    const otherKey = `families/${B}/audio/${B.slice(0, 8)}-n1`;
    await env.DB.prepare(`UPDATE ${table} SET ${col} = ? WHERE family_id = ?`).bind(otherKey, A).run();
    await expect(lib.deleteFamily(env, A)).rejects.toThrow(/外のキー/);
    const c = await lib.countFamily(env, A);
    expect(c.tables).toEqual(ONE_EACH);
    expect(c.r2Objects).toBe(4);
    expect(await env.BUCKET.head(otherKey)).not.toBeNull();
    expect((await lib.countFamily(env, B)).r2Objects).toBe(4);
  });

  it("D1 だけ消えて R2 が残った状態（途中で落ちた）から、もう一度呼べば R2 も消える", async () => {
    await env.DB.batch(lib.FAMILY_TABLES.map((t: string) => env.DB.prepare(`DELETE FROM ${t} WHERE ${t === "families" ? "id" : "family_id"} = ?`).bind(A)));
    const mid = await lib.countFamily(env, A);
    expect(mid.exists).toBe(false);
    expect(mid.r2Objects).toBe(4);
    expect(lib.isEmpty(mid)).toBe(false);
    const r = await lib.deleteFamily(env, A);
    expect(r.r2Deleted).toBe(4);
    expect(lib.isEmpty(r.after)).toBe(true);
    expect((await lib.countFamily(env, B)).r2Objects).toBe(4);
  });

  it("家族 ID は UUID の小文字の完全な形だけを受け付ける", async () => {
    for (const bad of [A.toUpperCase(), A.slice(0, -1), `${A} `, "%", `${A}' OR '1'='1`]) {
      await expect(lib.countFamily(env, bad)).rejects.toThrow(/家族 ID/);
    }
  });
});

// ---- コマンド（wrangler を通す。保存先は一時ディレクトリで、開発サーバーの .wrangler/ には触れない） ----

function run(args: string[]): { status: number; out: string } {
  const r = childProcess.spawnSync(nodeProcess.execPath, [script, ...args], { cwd: repoRoot, env: processEnv(), encoding: "utf8", timeout: 120_000 });
  return { status: r.status as number, out: `${r.stdout}${r.stderr}` };
}
const nodeProcess = (globalThis as any).process;

describe("コマンドの引数", () => {
  it.each([
    [[]],
    [["staging", A]],
    [["local", "abc"]],
    [["local", A, "--delete"]],
    [["local", A, "--delete", "--confirm", B]],
    [["local", A, "--confirm", A]],
    [["preview", A, "--persist-to", "/tmp/x"]],
    [["local", A, "--force"]],
    // 本番で消すのは人間の端末からだけ。端末のない子プロセスでは、つなぐ前に止まる
    [["production", A, "--delete", "--confirm", A]],
  ])("%j は何もせずに使い方を返す", (args) => {
    const r = run(args as string[]);
    expect(r.status).toBe(2);
  });
});

describe("本番で消す", () => {
  it("端末のない子プロセス（Claude やサブエージェント）からは、本番につなぐ前に止まる", () => {
    const r = run(["production", A, "--delete", "--confirm", A]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("自分の端末");
    expect(r.out).not.toContain("remote");
  });
});

describe("コマンド（local、一時の保存先）", () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), "omoide-delete-family-test-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("数えて、消して、0 件を確かめる。残す家族は残る。名前や本文は出さない", async () => {
    // 一時の保存先にマイグレーションを当て、家族を入れる
    const m = childProcess.spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", dir], {
      cwd: repoRoot,
      env: processEnv(),
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(m.status, m.stderr).toBe(0);
    const wrangler: any = await import("wrangler" as string);
    const proxy = await wrangler.getPlatformProxy({ configPath: path.join(repoRoot, "wrangler.jsonc"), persist: { path: path.join(dir, "v3") } });
    try {
      await seedFamily(proxy.env.DB, proxy.env.BUCKET, A, false);
      await seedFamily(proxy.env.DB, proxy.env.BUCKET, B, false);
    } finally {
      await proxy.dispose();
    }

    const counted = run(["local", A, "--persist-to", dir]);
    expect(counted.status, counted.out).toBe(0);
    expect(counted.out).toContain("実際の家族（デモではない）");
    expect(counted.out).toContain("R2 のファイル: 4");

    const deleted = run(["local", A, "--delete", "--confirm", A, "--persist-to", dir]);
    expect(deleted.status, deleted.out).toBe(0);
    expect(deleted.out).toContain("0 件になりました");
    expect(deleted.out).toContain("OPS_RECORD_FAMILIES");
    for (const out of [counted.out, deleted.out]) {
      expect(out).not.toContain("架空");
      expect(out).not.toContain("families/");
    }

    const kept = run(["local", B, "--persist-to", dir]);
    expect(kept.out).toContain("人: 1  写真: 1  語り: 1  入り口: 1  R2 のファイル: 4");
    const gone = run(["local", A, "--persist-to", dir]);
    expect(gone.out).toContain("もう消えています");
  }, 180_000);
});

describe("コマンド（local、一時の保存先、デモの家族）", () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), "omoide-delete-family-test-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("デモの家族は --allow-demo なしでは失敗で終わり、何も消さない。消えた後は何もしない", async () => {
    const m = childProcess.spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", dir], {
      cwd: repoRoot,
      env: processEnv(),
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(m.status, m.stderr).toBe(0);
    const wrangler: any = await import("wrangler" as string);
    const proxy = await wrangler.getPlatformProxy({ configPath: path.join(repoRoot, "wrangler.jsonc"), persist: { path: path.join(dir, "v3") } });
    try {
      await seedFamily(proxy.env.DB, proxy.env.BUCKET, D, true);
    } finally {
      await proxy.dispose();
    }

    const refused = run(["local", D, "--delete", "--confirm", D, "--persist-to", dir]);
    expect(refused.status, refused.out).toBe(1);
    expect(refused.out).toContain("デモの家族");
    expect(refused.out).not.toContain("0 件になりました");
    expect(run(["local", D, "--persist-to", dir]).out).toContain("R2 のファイル: 4");

    const allowed = run(["local", D, "--delete", "--confirm", D, "--allow-demo", "--persist-to", dir]);
    expect(allowed.status, allowed.out).toBe(0);
    expect(allowed.out).toContain("0 件になりました");
    // デモの家族は運営の記録の対象ではないので、OPS_RECORD_FAMILIES の段取りは出さない
    expect(allowed.out).not.toContain("OPS_RECORD_FAMILIES");
    for (const out of [refused.out, allowed.out]) {
      expect(out).not.toContain("架空");
      expect(out).not.toContain("families/");
    }

    const again = run(["local", D, "--delete", "--confirm", D, "--persist-to", dir]);
    expect(again.status, again.out).toBe(0);
    expect(again.out).toContain("何もしませんでした");
  }, 180_000);
});

describe("R2 の接頭", () => {
  it("末尾のスラッシュ込みで、形の合う ID のときだけ作る", () => {
    expect(lib.familyPrefix(A)).toBe(`families/${A}/`);
    for (const bad of ["", " ", "*", "x/..", undefined, null]) expect(() => lib.familyPrefix(bad)).toThrow(/家族 ID/);
  });
});
