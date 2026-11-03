// 移行 0006（入り口 v3。0046）: 列を足すだけで、前からある入り口の行（固定・Claude）はそのまま読め、新しい列は null。架空の家族だけを使う
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createD1Repositories } from "../src/server/platform/cloudflare/d1-repositories";
import { applyMigration, migrationFiles, startD1 } from "./helpers";

const MIGRATION = "0006_entrance_v3.sql";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1({ before: MIGRATION }));
}, 60_000);
afterAll(() => dispose());

describe(`移行 ${MIGRATION}`, () => {
  it("前からある入り口の行は残り、新しい列は null。リポジトリから読める", async () => {
    expect(migrationFiles()).toContain(MIGRATION);
    await d1.batch([
      d1.prepare("INSERT INTO families (id, is_demo, created_at) VALUES ('f', 1, 0)"),
      d1.prepare("INSERT INTO members (id, family_id, role, relation, called_as, speech_style, created_at) VALUES ('m', 'f', 'elder', '祖母', '架空のばあば', 'standard', 0)"),
      d1.prepare("INSERT INTO photos (id, family_id, owner_member_id, storage_key, content_hash, width, height, created_at) VALUES ('p', 'f', 'm', 'k', 'h', 1, 1, 0)"),
      d1.prepare("INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, kind, created_at) VALUES ('e-fixed', 'f', 'm', '2026-11-01', 'p', 'fixed', 1)"),
      d1.prepare(
        "INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, question, reason, kind, model, prompt_version, input_narration_ids, input_tokens, output_tokens, question_audio_key, created_at) VALUES ('e-claude', 'f', 'm', '2026-11-02', 'p', '架空の問いかけですか', '架空', 'claude', 'claude-fake', 'entrance/v2', '[\"n1\"]', 10, 20, 'audio-k', 2)",
      ),
    ]);
    for (const f of migrationFiles().filter((f) => f >= MIGRATION)) await applyMigration(d1, f);

    const raw = (await d1.prepare("SELECT id, input_musubi_ids, receiver_present FROM entrances ORDER BY id").all()).results;
    expect(raw).toEqual([
      { id: "e-claude", input_musubi_ids: null, receiver_present: null },
      { id: "e-fixed", input_musubi_ids: null, receiver_present: null },
    ]);
    const repos = createD1Repositories(d1);
    const claude = await repos.entrances.get("f", "m", "2026-11-02");
    expect(claude).toMatchObject({
      id: "e-claude",
      kind: "claude",
      question: "架空の問いかけですか",
      promptVersion: "entrance/v2",
      inputNarrationIds: ["n1"],
      inputTokens: 10,
      outputTokens: 20,
      questionAudioKey: "audio-k",
      inputMusubiIds: null,
      receiverPresent: null,
    });
    expect(await repos.entrances.get("f", "m", "2026-11-01")).toMatchObject({ id: "e-fixed", kind: "fixed", inputMusubiIds: null, receiverPresent: null });
    // 外部キーと CHECK（entrances_kind）は効いたまま
    await expect(
      d1.prepare("INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, kind, model, created_at) VALUES ('e-bad', 'f', 'm', '2026-11-03', 'p', 'fixed', 'x', 3)").run(),
    ).rejects.toThrow(/CHECK/);
    expect((await d1.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});
