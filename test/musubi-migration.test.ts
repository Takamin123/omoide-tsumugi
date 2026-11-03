// 移行 0005（むすびの推測。0044）: 表を作り直しても、家族の手で決めたむすびは残り、決めた人は根拠の語りの語り手になる。
// 根拠の記録を持たない前の形の推測は写さない。架空の家族だけを使う。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFiles, startD1 } from "./helpers";

const MIGRATION = "0005_musubi_guess.sql";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1({ before: MIGRATION }));
}, 60_000);
afterAll(() => dispose());

describe(`移行 ${MIGRATION}`, () => {
  it("家族のむすびの確定は残り、決めた人と時刻が入る。前の形の推測は写さない", async () => {
    expect(migrationFiles()).toContain(MIGRATION);
    await d1.batch([
      d1.prepare("INSERT INTO families (id, is_demo, created_at) VALUES ('f', 1, 0)"),
      d1.prepare("INSERT INTO members (id, family_id, role, relation, called_as, speech_style, created_at) VALUES ('m', 'f', 'family', 'r', 'c', 'standard', 0)"),
      d1.prepare("INSERT INTO photos (id, family_id, owner_member_id, storage_key, content_hash, width, height, created_at) VALUES ('p', 'f', 'm', 'k', 'h', 1, 1, 0)"),
      d1.prepare("INSERT INTO narrations (id, family_id, speaker_member_id, photo_id, kind, transcript, transcript_status, for_date, created_at) VALUES ('n', 'f', 'm', 'p', 'text', 't', 'done', '2026-11-02', 0)"),
      d1.prepare("INSERT INTO musubi (id, family_id, created_by, created_at) VALUES ('mu-family', 'f', 'family', 0)"),
      d1.prepare("INSERT INTO musubi (id, family_id, created_by, model, prompt_version, created_at) VALUES ('mu-old-guess', 'f', 'guessed', 'x', 'v0', 0)"),
      d1.prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, evidence_narration_id, created_at) VALUES ('mu-family', 'p', 'f', 'confirmed', 'n', 7)"),
      d1.prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES ('mu-old-guess', 'p', 'f', 'guessed', 0)"),
    ]);
    for (const f of migrationFiles().filter((f) => f >= MIGRATION)) await applyMigration(d1, f);

    expect((await d1.prepare("SELECT id FROM musubi ORDER BY id").all()).results).toEqual([{ id: "mu-family" }]);
    expect((await d1.prepare("SELECT * FROM musubi_photos").all()).results).toEqual([
      expect.objectContaining({ musubi_id: "mu-family", status: "confirmed", evidence_narration_id: "n", decided_by_member_id: "m", decided_at: 7 }),
    ]);
    // 作り直した後も外部キーと CHECK が効く
    await expect(d1.prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES ('mu-family', 'p2', 'f', 'guessed', 0)").run()).rejects.toThrow(/FOREIGN KEY/);
    expect((await d1.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});
