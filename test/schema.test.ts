// 家族が語ったこと（出所つき）と Claude の推測が、データベースの制約で分けて保たれること（policy 5 の 2 番目）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startD1 } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  await d1.batch([
    d1.prepare("INSERT INTO families (id, is_demo, created_at) VALUES ('f', 1, 0)"),
    d1.prepare("INSERT INTO members (id, family_id, role, relation, called_as, speech_style, created_at) VALUES ('m', 'f', 'family', 'r', 'c', 'standard', 0)"),
    d1.prepare("INSERT INTO photos (id, family_id, owner_member_id, storage_key, content_hash, width, height, created_at) VALUES ('p', 'f', 'm', 'k', 'h', 1, 1, 0)"),
    d1.prepare("INSERT INTO narrations (id, family_id, speaker_member_id, photo_id, kind, transcript, transcript_status, for_date, created_at) VALUES ('n', 'f', 'm', 'p', 'text', 't', 'done', '2026-11-02', 0)"),
    d1.prepare("INSERT INTO musubi (id, family_id, created_by, created_at) VALUES ('mu', 'f', 'family', 0)"),
  ]);
}, 60_000);
afterAll(() => dispose());

const run = (sql: string) => d1.prepare(sql).run();
let seq = 0;
const rec = (cols: string, vals: string) =>
  run(`INSERT INTO records (id, family_id, kind, value, created_at, ${cols}) VALUES ('r${++seq}', 'f', 'place', 'v', 0, ${vals})`);

describe("出所と推測を分ける制約", () => {
  it("records: told は誰がどの語りで、が必須。model は持たない", async () => {
    await expect(rec("origin, told_by_member_id, narration_id", "'told', 'm', 'n'")).resolves.toBeTruthy();
    await expect(rec("origin", "'told'")).rejects.toThrow(/CHECK/);
    await expect(rec("origin, told_by_member_id, narration_id, model, prompt_version", "'told', 'm', 'n', 'x', 'v'")).rejects.toThrow(/CHECK/);
  });

  it("records: guessed は model と prompt_version が必須", async () => {
    await expect(rec("origin, model, prompt_version", "'guessed', 'x', 'v1'")).resolves.toBeTruthy();
    await expect(rec("origin", "'guessed'")).rejects.toThrow(/CHECK/);
  });

  it("musubi_photos: 確定・却下は家族の手だけ（決めた人と時刻が必須。根拠の語りだけでは足りない）。推測は決めた人を持たない（0044）", async () => {
    const mp = (cols: string, vals: string) => run(`INSERT INTO musubi_photos (musubi_id, photo_id, family_id, created_at, ${cols}) VALUES ('mu', 'p', 'f', 0, ${vals})`);
    await expect(mp("status", "'confirmed'")).rejects.toThrow(/CHECK/);
    await expect(mp("status, evidence_narration_id", "'rejected', 'n'")).rejects.toThrow(/CHECK/);
    await expect(mp("status, decided_by_member_id", "'confirmed', 'm'")).rejects.toThrow(/CHECK/);
    await expect(mp("status, decided_by_member_id, decided_at", "'guessed', 'm', 1")).rejects.toThrow(/CHECK/);
    await expect(mp("status, decided_by_member_id, decided_at", "'rejected', 'm', 1")).resolves.toBeTruthy();
  });

  it("musubi: 推測で作ったものは model と prompt_version と根拠の記録が必須", async () => {
    await expect(run("INSERT INTO musubi (id, family_id, created_by, created_at) VALUES ('mu2', 'f', 'guessed', 0)")).rejects.toThrow(/CHECK/);
    await expect(
      run("INSERT INTO musubi (id, family_id, created_by, model, prompt_version, created_at) VALUES ('mu3', 'f', 'guessed', 'x', 'musubi_guess/v1', 0)"),
    ).rejects.toThrow(/CHECK/);
    await expect(
      run(`INSERT INTO musubi (id, family_id, created_by, model, prompt_version, guessed_evidence_record_ids, created_at) VALUES ('mu4', 'f', 'guessed', 'x', 'musubi_guess/v1', '["r1"]', 0)`),
    ).resolves.toBeTruthy();
  });

  it("entrances: 固定の入り口は問いかけを持たない。Claude の入り口は問いかけと model が必須", async () => {
    await expect(
      run("INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, kind, question, created_at) VALUES ('e1', 'f', 'm', '2026-11-02', 'p', 'fixed', 'q', 0)"),
    ).rejects.toThrow(/CHECK/);
    await expect(
      run("INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, kind, question, created_at) VALUES ('e2', 'f', 'm', '2026-11-02', 'p', 'claude', 'q', 0)"),
    ).rejects.toThrow(/CHECK/);
  });

  it("narrations: 整えた文字には model と prompt_version が必須", async () => {
    await expect(run("UPDATE narrations SET cleaned_text = 'x' WHERE id = 'n'")).rejects.toThrow(/CHECK/);
  });
});
