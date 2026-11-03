// 運営の記録を本番でも開くようにしたことの、すき間の確かめ（qa-engineer、0030）。
// - 鍵の長さの下限の境目（31 文字は設定なし扱い、32 文字は使える）
// - 本番では、運営の鍵を付けても /api/check/* は 404 のまま（開発用の入り口は鍵で開かない）
// - 許可の一覧に載せた家族の記録に、ほかの家族の語り・写真・推測が混ざらない
// 架空の家族と架空の文だけを使う。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { opsKeyMisconfig, OPS_KEY_MIN_LENGTH } from "../src/server/routes/auth";
import type { OpsFamilyRecord } from "../src/shared/ops";
import { addMember, addPhoto, CREATE_TOKEN, createFamily, makeTestApp, OPS_TOKEN, startD1 } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const recordUrl = (familyId: string) => `/api/ops/families/${familyId}/record`;

describe("運営の鍵の長さの境目", () => {
  it(`${OPS_KEY_MIN_LENGTH - 1} 文字は設定なし扱いで開かない。${OPS_KEY_MIN_LENGTH} 文字なら開く`, async () => {
    expect(OPS_KEY_MIN_LENGTH).toBe(32);
    const t = makeTestApp(d1, { appEnv: "production" });
    const f = await createFamily(t, true);
    const short = "k".repeat(OPS_KEY_MIN_LENGTH - 1);
    const exact = "k".repeat(OPS_KEY_MIN_LENGTH);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      t.deps.config.opsRecordToken = short;
      expect(opsKeyMisconfig(t.deps.config)).toBe("too_short");
      expect((await t.app.request(recordUrl(f.familyId), { headers: { Authorization: `Bearer ${short}` } })).status).toBe(401);
      t.deps.config.opsRecordToken = exact;
      expect(opsKeyMisconfig(t.deps.config)).toBeNull();
      expect((await t.app.request(recordUrl(f.familyId), { headers: { Authorization: `Bearer ${exact}` } })).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("家族を作る鍵の設定がないときは、同じ値の比べで誤って弾かない", () => {
    expect(
      opsKeyMisconfig({ appEnv: "production", createFamilyToken: null, opsRecordToken: OPS_TOKEN, opsRecordFamilies: [] }),
    ).toBeNull();
    expect(opsKeyMisconfig({ appEnv: "production", createFamilyToken: CREATE_TOKEN, opsRecordToken: null, opsRecordFamilies: [] })).toBeNull();
  });
});

describe("本番では、運営の鍵を付けても /check の入り口は 404 のまま", () => {
  it("POST /api/check/transcribe と /api/check/speech", async () => {
    const t = makeTestApp(d1, { appEnv: "production" });
    const f = await createFamily(t, true);
    const m = await addMember(t, f.cookie);
    const headers = { Cookie: m.cookie, Authorization: `Bearer ${OPS_TOKEN}` };
    const form = new FormData();
    form.set("params", JSON.stringify({ model: "x", fields: [] }));
    form.set("audio", new File([new Uint8Array([1, 2, 3])], "a.m4a", { type: "audio/mp4" }));
    expect((await t.app.request("/api/check/transcribe", { method: "POST", headers, body: form })).status).toBe(404);
    const speech = await t.app.request("/api/check/speech", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "架空の文" }),
    });
    expect(speech.status).toBe(404);
    // 鍵だけ（cookie なし）では、合言葉の確認で止まる
    const onlyKey = await t.app.request("/api/check/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPS_TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(onlyKey.status).toBe(401);
  });
});

describe("許可の一覧に載せた家族の記録に、ほかの家族のものが混ざらない（本番）", () => {
  it("語り・写真・メンバーは、その家族のものだけ", async () => {
    const t = makeTestApp(d1, { appEnv: "production" });
    const a = await createFamily(t, false);
    const b = await createFamily(t, false);
    const aMember = await addMember(t, a.cookie);
    const bMember = await addMember(t, b.cookie);
    const aPhoto = await addPhoto(t, aMember.cookie, 1);
    const bPhoto = await addPhoto(t, bMember.cookie, 2);
    t.deps.config.opsRecordFamilies = [a.familyId];
    const res = await t.app.request(recordUrl(a.familyId), { headers: { Authorization: `Bearer ${OPS_TOKEN}` } });
    expect(res.status).toBe(200);
    const r = (await res.json()) as OpsFamilyRecord;
    expect(r.photos.map((p) => p.id)).toEqual([aPhoto.id]);
    const text = JSON.stringify(r);
    expect(text).not.toContain(b.familyId);
    expect(text).not.toContain(bMember.id);
    expect(text).not.toContain(bPhoto.id);
  });
});
