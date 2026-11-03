// 移行 0003（一人ずつのリンク。0036）: 家族単位のリンクは、移行の後にすべて使えなくなる。架空の家族だけを使う。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "../src/server/core/secrets";
import { applyMigration, cookieOf, makeTestApp, migrationFiles, startD1 } from "./helpers";

const MIGRATION = "0003_member_links.sql";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1({ before: MIGRATION }));
}, 60_000);
afterAll(() => dispose());

describe(`移行 ${MIGRATION}`, () => {
  it("移行の前に有効だった家族単位のリンクは、移行の後は 401", async () => {
    expect(migrationFiles()).toContain(MIGRATION);
    const token = "old-family-link-".padEnd(43, "x");
    await d1.batch([
      d1.prepare("INSERT INTO families (id, is_demo, created_at) VALUES ('fam-old', 0, 0)"),
      d1.prepare("INSERT INTO invite_links (id, family_id, token_hash, created_at) VALUES ('l-old', 'fam-old', ?, 0)").bind(await hashToken(token)),
      d1.prepare("INSERT INTO members (id, family_id, role, relation, called_as, speech_style, created_at) VALUES ('m-old', 'fam-old', 'family', '母', 'おかあさん', 'standard', 0)"),
    ]);
    const t = makeTestApp(d1);
    // 移行の前のスキーマでは、このリポジトリは列が足りず読めないので、移行の後だけを確かめる
    for (const f of migrationFiles().filter((f) => f >= MIGRATION)) await applyMigration(d1, f);

    const row = await d1.prepare("SELECT revoked_at, member_id FROM invite_links WHERE id = 'l-old'").first<{ revoked_at: number | null; member_id: string | null }>();
    expect(row?.revoked_at).not.toBeNull();
    expect(row?.member_id).toBeNull();
    const res = await t.app.request("/api/family", { headers: { Cookie: cookieOf(token) } });
    expect(res.status).toBe(401);
    // 人と家族は残る
    expect((await d1.prepare("SELECT count(*) AS n FROM members WHERE family_id = 'fam-old'").first<{ n: number }>())?.n).toBe(1);
  });
});
