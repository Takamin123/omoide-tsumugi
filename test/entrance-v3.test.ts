// 入り口 v3（0046）: むすびを候補の並び（g1a）と Claude への入力（<same_event>）にだけ使うこと、つながりの検査、
// receiver_present と input_musubi_ids の保存、家族向けの API に出ないこと。Claude は偽物。データは架空
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import {
  ENTRANCE_VERSION,
  buildEntranceInput,
  checkEntranceLinks,
  checkEntranceV3,
  ensureMorningEntrance,
  entranceSchemaV3,
  pickEntranceCandidates,
  sameEventLinks,
  type EntranceMaterial,
  type MusubiForEntrance,
  type NarrationForEntrance,
} from "../src/server/core/entrance-claude";
import { runMorning } from "../src/server/core/morning";
import type { ClaudeCallRequest, ClaudeCallResult, ClaudeClient, MusubiPhotoStatus, PhotoRow } from "../src/server/core/ports";
import { ENTRANCE_PROMPTS, PROMPTS } from "../src/server/prompts";
import { addMember, addPhoto, createFamily, makeTestApp, onlyPurpose, postForm, startD1 } from "./helpers";

const photo = (id: string, owner: string, takenAt: string | null = null): PhotoRow => ({
  id,
  familyId: "f",
  ownerMemberId: owner,
  storageKey: `k-${id}`,
  contentHash: id,
  width: 10,
  height: 10,
  takenAt,
  latitude: null,
  longitude: null,
  createdAt: 0,
});
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const mu = (id: string, photos: [string, MusubiPhotoStatus][]): MusubiForEntrance => ({
  id,
  photos: photos.map(([photoId, status]) => ({ photoId, status, decidedByMemberId: status === "guessed" ? null : "m", decidedAt: status === "guessed" ? null : 1 })),
});

describe("切り替え", () => {
  it("既定は v3（人間の決定、2026-11-04）。v2 は名指しで呼べる", () => {
    expect(ENTRANCE_VERSION).toBe("v3");
    expect(ENTRANCE_PROMPTS.v3.version).toBe("entrance/v3");
    expect(ENTRANCE_PROMPTS.v2).toBe(PROMPTS.entrance);
    expect(ENTRANCE_PROMPTS.v2.version).toBe("entrance/v2");
  });
  it("v3 のスキーマは receiver_present を reason の前に持つ", () => {
    expect(Object.keys(entranceSchemaV3.shape).slice(0, 2)).toEqual(["receiver_present", "reason"]);
  });
});

describe("sameEventLinks: 生きているむすびだけ", () => {
  const fam = new Set(["a", "b", "c", "d"]);
  it("rejected の写真と家族の外の写真を外し、2 枚未満なら無視する", () => {
    const links = sameEventLinks(
      [mu("m1", [["a", "guessed"], ["b", "rejected"]]), mu("m2", [["c", "guessed"], ["z-other-family", "guessed"]]), mu("m3", [["a", "guessed"], ["d", "guessed"]])],
      fam,
    );
    expect(links.get("a")).toEqual([{ musubiId: "m3", withPhotoId: "d", status: "guessed" }]);
    expect(links.has("b")).toBe(false);
    expect(links.has("c")).toBe(false);
    expect(links.has("z-other-family")).toBe(false);
  });
  it("両方が confirmed のときだけ confirmed", () => {
    const links = sameEventLinks([mu("m", [["a", "confirmed"], ["b", "confirmed"], ["c", "guessed"]])], fam);
    expect(links.get("a")).toEqual([
      { musubiId: "m", withPhotoId: "b", status: "confirmed" },
      { musubiId: "m", withPhotoId: "c", status: "guessed" },
    ]);
  });
});

describe("pickEntranceCandidates: g1a（0046）", () => {
  const me = "me";
  // X は受け取る人が語った写真。Y は X と同じむすびで、ほかの家族の古い語りがある。Z は無関係で、ほかの家族の新しい語りがある
  const photos = [photo("X", "o"), photo("Y", "o"), photo("Z", "o"), photo("W", "o")];
  const narrations = [
    { photoId: "X", speakerMemberId: me, createdAt: day("2026-11-02") },
    { photoId: "Y", speakerMemberId: "o", createdAt: day("2026-10-20") },
    { photoId: "Z", speakerMemberId: "o", createdAt: day("2026-11-01") },
  ];
  const ids = (r: ReturnType<typeof pickEntranceCandidates>) => r.map((c) => c.photo.id);

  it("むすびがなければ今までの並び（g1 の新しい順）", () => {
    expect(ids(pickEntranceCandidates(photos, narrations, [], me, "2026-11-03"))).toEqual(["Z", "Y", "W", "X"]);
  });
  it("むすびがあれば、受け取る人が語った写真と同じ出来事の写真を g1 より前に", () => {
    const r = pickEntranceCandidates(photos, narrations, [], me, "2026-11-03", new Set(), [mu("m", [["X", "guessed"], ["Y", "guessed"]])]);
    expect(ids(r)).toEqual(["Y", "Z", "W", "X"]);
  });
  it("rejected の写真を外して 2 枚未満のむすびは使わない", () => {
    const r = pickEntranceCandidates(photos, narrations, [], me, "2026-11-03", new Set(), [mu("m", [["X", "rejected"], ["Y", "guessed"]])]);
    expect(ids(r)).toEqual(["Z", "Y", "W", "X"]);
  });
  it("Y にほかの家族の語りがなければ g1a にしない", () => {
    const r = pickEntranceCandidates(photos, narrations, [], me, "2026-11-03", new Set(), [mu("m", [["X", "guessed"], ["W", "guessed"]])]);
    expect(ids(r)).toEqual(["Z", "Y", "W", "X"]);
  });
  it("受け取る人の語りが、Y を最後に出した後でなければ g1a にしない", () => {
    const past = [{ photoId: "Y", forDate: "2026-10-25", createdAt: day("2026-11-02") + 1 }];
    const r = pickEntranceCandidates(photos, narrations, past, me, "2026-11-03", new Set(), [mu("m", [["X", "guessed"], ["Y", "guessed"]])]);
    expect(ids(r)[0]).toBe("Z");
  });
  it("前の 7 日に出した写真は g1a にしない（g1 のような免除はない）", () => {
    // Y を 11/01 に出し、その後に受け取る人が X を語った。Y にほかの家族の新しい語りはない → 候補にならない
    const past = [{ photoId: "Y", forDate: "2026-11-01", createdAt: day("2026-11-01") }];
    const r = pickEntranceCandidates(photos, narrations, past, me, "2026-11-03", new Set(), [mu("m", [["X", "guessed"], ["Y", "guessed"]])]);
    expect(ids(r)).not.toContain("Y");
  });
  it("g0（この人の語りへの返事）は g1a より前のまま", () => {
    const ns = [
      ...narrations.map((n) => ({ ...n, id: `${n.photoId}-${n.speakerMemberId}`, replyToId: null })),
      { id: "w-me", photoId: "W", speakerMemberId: me, createdAt: day("2026-10-01"), replyToId: null },
      { id: "w-reply", photoId: "W", speakerMemberId: "o", createdAt: day("2026-10-02"), replyToId: "w-me" },
    ];
    const r = pickEntranceCandidates(photos, ns, [], me, "2026-11-03", new Set(), [mu("m", [["X", "guessed"], ["Y", "guessed"]])]);
    expect(ids(r).slice(0, 3)).toEqual(["W", "Y", "Z"]);
  });
  it("g1a の中は confirmed を先に、同じなら X への語りの新しい順", () => {
    const ps = [photo("X1", "o"), photo("Y1", "o"), photo("X2", "o"), photo("Y2", "o"), photo("X3", "o"), photo("Y3", "o")];
    const ns = [
      { photoId: "X1", speakerMemberId: me, createdAt: day("2026-11-02") },
      { photoId: "X2", speakerMemberId: me, createdAt: day("2026-10-20") },
      { photoId: "X3", speakerMemberId: me, createdAt: day("2026-10-25") },
      { photoId: "Y1", speakerMemberId: "o", createdAt: day("2026-10-01") },
      { photoId: "Y2", speakerMemberId: "o", createdAt: day("2026-10-01") },
      { photoId: "Y3", speakerMemberId: "o", createdAt: day("2026-10-01") },
    ];
    const ms = [
      mu("m1", [["X1", "guessed"], ["Y1", "guessed"]]),
      mu("m2", [["X2", "confirmed"], ["Y2", "confirmed"]]),
      mu("m3", [["X3", "guessed"], ["Y3", "guessed"]]),
    ];
    expect(ids(pickEntranceCandidates(ps, ns, [], me, "2026-11-03", new Set(), ms)).slice(0, 3)).toEqual(["Y2", "Y1", "Y3"]);
  });
  it("今日ほかの人に出した写真は g1a でも外す（0042）", () => {
    const r = pickEntranceCandidates(photos, narrations, [], me, "2026-11-03", new Set(["Y"]), [mu("m", [["X", "guessed"], ["Y", "guessed"]])]);
    expect(ids(r)).not.toContain("Y");
  });
});

describe("buildEntranceInput: <same_event>（0046）", () => {
  const n = (over: Partial<NarrationForEntrance> & Pick<NarrationForEntrance, "id" | "photoId">): NarrationForEntrance => ({
    speakerMemberId: "o",
    replyToId: null,
    kind: "text",
    transcript: "架空の語り",
    cleanedText: null,
    uncertainSpans: null,
    forDate: "2026-11-01",
    createdAt: 1,
    ...over,
  });
  const material = (sameEvent?: EntranceMaterial["sameEvent"]): EntranceMaterial => ({
    receiverId: "me",
    members: [
      { id: "me", role: "elder", relation: "祖母", calledAs: "架空のばあば" },
      { id: "o", role: "family", relation: "孫", calledAs: "架空のまご" },
    ],
    candidates: [{ photo: photo("Y", "o"), image: null, guess: null, shownCount: 0, lastShownDate: null }],
    narrations: [
      n({ id: "ny", photoId: "Y", transcript: "架空の夜店の話" }),
      n({ id: "nx-old", photoId: "X", speakerMemberId: "me", transcript: "架空の相手側の本文ABC", forDate: "2026-10-30", createdAt: 5 }),
      n({ id: "nx", photoId: "X", speakerMemberId: "me", transcript: "架空の相手側の本文DEF", forDate: "2026-11-02", createdAt: 9 }),
    ],
    ...(sameEvent ? { sameEvent } : {}),
  });
  const textOf = (m: EntranceMaterial) => buildEntranceInput(m).content.map((p) => (p.type === "text" ? p.text : "")).join("\n");

  it("むすびがなければ v2 と同じ（same_event なし）", () => {
    const input = buildEntranceInput(material());
    expect(textOf(material())).not.toContain("same_event");
    expect(input.inputMusubiIds).toEqual([]);
  });
  it("候補でない相手の写真も ID だけ渡し、相手側の語りの本文は渡さない。receiver_talked は受け取る人の最新の語りの日", () => {
    const m = material({ musubi: [mu("mu1", [["X", "guessed"], ["Y", "guessed"]])], familyPhotoIds: new Set(["X", "Y"]) });
    const text = textOf(m);
    expect(text).toContain('<same_event with="X" status="guessed" receiver_talked="2026-11-02"/>');
    expect(text).not.toContain("架空の相手側の本文");
    const input = buildEntranceInput(m);
    expect(input.inputMusubiIds).toEqual(["mu1"]);
    expect([...input.context.linkedPhotoIds]).toEqual(["X"]);
    expect(input.context.passedTexts.get("Y")).toEqual(["架空の夜店の話"]);
  });
  it("受け取る人が相手の写真を語っていなければ receiver_talked を付けない。confirmed はそのまま", () => {
    const m = material({ musubi: [mu("mu1", [["W", "confirmed"], ["Y", "confirmed"]])], familyPhotoIds: new Set(["W", "Y"]) });
    expect(textOf(m)).toContain('<same_event with="W" status="confirmed"/>');
  });
  it("ほかの家族の写真が混ざったむすびや、rejected の写真は渡さない", () => {
    const m = material({
      musubi: [mu("mu-other", [["Y", "guessed"], ["OTHER-FAMILY-PHOTO", "guessed"]]), mu("mu-rej", [["Y", "guessed"], ["X", "rejected"]])],
      familyPhotoIds: new Set(["X", "Y"]),
    });
    const text = textOf(m);
    expect(text).not.toContain("same_event");
    expect(text).not.toContain("OTHER-FAMILY-PHOTO");
    expect(buildEntranceInput(m).inputMusubiIds).toEqual([]);
  });
});

describe("checkEntranceLinks: つながりの断定と、別の写真の記録の語（0046）", () => {
  const ctx = {
    passedTexts: new Map([
      ["Y", ["夜店で金魚をすくった。二日目は雨だった。"]],
      ["Z", ["庭のあじさい"]],
    ]),
    candidateIds: new Set(["Y", "Z"]),
    linkedPhotoIds: new Set(["X"]),
  };
  const records = [
    { photoId: "X", value: "盆踊り", origin: "told" as const },
    { photoId: "Z", value: "あじさい", origin: "told" as const },
    { photoId: "Y", value: "金魚", origin: "told" as const },
    { photoId: "X", value: "輪", origin: "told" as const },
    { photoId: "FAR", value: "夕立", origin: "told" as const },
    { photoId: "X", value: "花火", origin: "guessed" as const },
  ];
  it("選んだ写真の語りにない、つながりの語は止める", () => {
    expect(checkEntranceLinks("同じ日の夜店では、どんなふうに過ごしましたか", "Y", ctx, [])).toBe("question_asserts_link");
    expect(checkEntranceLinks("この夜店の続きを聞かせてください", "Y", ctx, [])).toBe("question_asserts_link");
    expect(checkEntranceLinks("翌日は、どんな一日でしたか", "Y", ctx, [])).toBe("question_asserts_link");
  });
  it("選んだ写真の語りにある語なら通す（表記ゆれはそろえる）", () => {
    expect(checkEntranceLinks("二日目の雨の中では、どんなふうに過ごしましたか", "Y", ctx, [])).toBeNull();
  });
  it("渡した別の写真の told の記録の値（2 字以上）は止める。選んだ写真の語りにあれば通す", () => {
    expect(checkEntranceLinks("この夜は、盆踊りのほかにどんなことをしましたか", "Y", ctx, records)).toBe("question_other_photo_words");
    expect(checkEntranceLinks("あじさいのころは、どんな様子でしたか", "Y", ctx, records)).toBe("question_other_photo_words");
    expect(checkEntranceLinks("金魚は、そのあとどうなりましたか", "Y", ctx, records)).toBeNull();
    expect(checkEntranceLinks("あじさいのころは、どんな様子でしたか", "Z", ctx, records)).toBeNull();
  });
  it("算用数字の日目と、カタカナ・英字の大小の違いもそろえて止める", () => {
    expect(checkEntranceLinks("２日目の夜店では、どんなふうに過ごしましたか", "Y", { ...ctx, passedTexts: new Map([["Y", ["夜店"]]]) }, [])).toBe("question_asserts_link");
    expect(checkEntranceLinks("アジサイのころは、どんな様子でしたか", "Y", ctx, records)).toBe("question_other_photo_words");
    const latin = [{ photoId: "Z", value: "Disney", origin: "told" as const }];
    expect(checkEntranceLinks("disneyでは、どんなふうに過ごしましたか", "Y", ctx, latin)).toBe("question_other_photo_words");
  });
  it("一字の値、渡していない写真の記録、told でない記録は数えない", () => {
    expect(checkEntranceLinks("この輪のなかで、どんなふうに過ごしましたか", "Y", ctx, records)).toBeNull();
    expect(checkEntranceLinks("夕立のあとは、どんなふうに過ごしましたか", "Y", ctx, records)).toBeNull();
    expect(checkEntranceLinks("花火のあとは、どんなふうに過ごしましたか", "Y", ctx, records)).toBeNull();
  });
  it("checkEntranceV3 は v2 の検査を先に通す", () => {
    const full = {
      ...ctx,
      candidateIds: new Set(["Y"]),
      imagedIds: new Set<string>(),
      narrations: new Map(),
    };
    const v = { receiver_present: "yes" as const, reason: "架空", photo_id: "Y", focus: null, quote: null, question: "覚えていますか" };
    expect(checkEntranceV3(v, full, records)).toBe("question_forbidden");
    expect(checkEntranceV3({ ...v, question: "同じ旅の夜は、どんなふうでしたか" }, full, records)).toBe("question_asserts_link");
    expect(checkEntranceV3({ ...v, question: "この夜は、どんなふうでしたか" }, full, records)).toBeNull();
  });
});

// ---- 毎朝の処理につないだとき（D1） ----

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const NOW = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00

/** 渡された候補の先頭を選び、receiver_present を "no" で返す偽物。送った本文を記録する */
function recordingClaude() {
  const sent: string[] = [];
  const claude: ClaudeClient = {
    async call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>> {
      const text = req.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      sent.push(text);
      const candidates = [...text.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1]!);
      const base = { reason: "架空の理由", photo_id: candidates[0]!, focus: null, quote: null, question: "この日のことを、聞かせてください" };
      const value = (req.prompt.version === "entrance/v3" ? { receiver_present: "no", ...base } : base) as T;
      const meta = { purpose: req.prompt.purpose, model: "claude-fake", promptVersion: req.prompt.version, inputTokens: 1, outputTokens: 1, attempts: 1 };
      const violation = req.check?.(value) ?? null;
      if (violation) return { ok: false, reason: "check_failed", violation, meta };
      return { ok: true, value, meta };
    },
    createBatch: (req) => notConfiguredClaude.createBatch(req),
    getBatch: (id) => notConfiguredClaude.getBatch(id),
    getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
  };
  return { claude, sent };
}

async function postText(t: ReturnType<typeof makeTestApp>, cookie: string, photoId: string, text: string): Promise<string> {
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId, entranceId: null, replyToId: null, text }));
  const res = await postForm(t, "/api/narrations", form, cookie);
  return ((await res.json()) as { narration: { id: string } }).narration.id;
}

async function insertMusubi(familyId: string, id: string, photoIds: string[]) {
  await d1
    .prepare("INSERT INTO musubi (id, family_id, created_by, guessed_reason, guessed_evidence_record_ids, model, prompt_version, created_at) VALUES (?, ?, 'guessed', '架空', '[]', 'm', 'musubi_guess/v1', 1)")
    .bind(id, familyId)
    .run();
  for (const p of photoIds) {
    await d1
      .prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES (?, ?, ?, 'guessed', 1)")
      .bind(id, p, familyId)
      .run();
  }
}

/** 孫と祖母。祖母が X を語り、孫が Y を語った。むすび {X, Y}（guessed）。別の家族にも、むすびがある */
async function setup() {
  const fake = recordingClaude();
  const t = makeTestApp(d1, { claude: onlyPurpose(fake.claude, "entrance") });
  const f = await createFamily(t);
  const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
  const elder = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
  const x = await addPhoto(t, gc.cookie, 201);
  const y = await addPhoto(t, gc.cookie, 202);
  await postText(t, gc.cookie, y.id, "架空の夜店の話");
  await postText(t, elder.cookie, x.id, "架空の盆踊りの話");
  await t.flush();
  const muId = `mu-${crypto.randomUUID()}`;
  await insertMusubi(f.familyId, muId, [x.id, y.id]);

  // 別の家族（同じ D1）。この家族のむすびと写真は、上の家族の入力に混ざってはいけない
  const g = await createFamily(t);
  const ga = await addMember(t, g.cookie, { calledAs: "架空のよそ" });
  const gp1 = await addPhoto(t, ga.cookie, 301);
  const gp2 = await addPhoto(t, ga.cookie, 302);
  const otherMu = `mu-other-${crypto.randomUUID()}`;
  await insertMusubi(g.familyId, otherMu, [gp1.id, gp2.id]);

  return { t, fake, familyId: f.familyId, elder, gc, x: x.id, y: y.id, muId, otherIds: [gp1.id, gp2.id, otherMu] };
}

describe("毎朝の処理: v3 を名指しで呼ぶ（0046）", () => {
  it("g1a の写真を先頭に渡し、receiver_present と input_musubi_ids を保存する。家族向けの API には出さない", async () => {
    const s = await setup();
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true, version: "v3" });
    expect(r.via).toBe("claude");
    const sent = s.fake.sent[0]!;
    // 候補の先頭は Y（祖母が語った X と同じむすびで、孫の言葉がある）
    expect([...sent.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1])[0]).toBe(s.y);
    expect(sent).toContain(`<same_event with="${s.x}" status="guessed" receiver_talked="`);
    for (const id of s.otherIds) expect(sent).not.toContain(id);

    const row = await d1
      .prepare("SELECT * FROM entrances WHERE family_id = ? AND member_id = ?")
      .bind(s.familyId, s.elder.id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ kind: "claude", photo_id: s.y, prompt_version: "entrance/v3", receiver_present: "no" });
    expect(JSON.parse(row!.input_musubi_ids as string)).toEqual([s.muId]);

    s.t.setNow(NOW);
    const res = await s.t.app.request("/api/entrances/today", { headers: { Cookie: s.elder.cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const secret of [s.muId, "receiverPresent", "receiver_present", "inputMusubiIds", "input_musubi_ids", "musubi", "same_event", "entrance/v3"]) {
      expect(body).not.toContain(secret);
    }
    const e = (JSON.parse(body) as { entrance: Record<string, unknown> }).entrance;
    expect(Object.keys(e).sort()).toEqual(["focus", "forDate", "id", "memberId", "photo", "question", "questionAudioUrl", "quote"]);
  });

  it("毎朝の処理（既定）は v3: むすびを渡し、receiver_present と input_musubi_ids を保存する", async () => {
    const s = await setup();
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(s.fake.sent.length).toBe(2);
    expect(s.fake.sent.some((text) => text.includes(`<same_event with="`))).toBe(true);
    const rows = (
      await d1.prepare("SELECT prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE family_id = ?").bind(s.familyId).all<Record<string, unknown>>()
    ).results;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row).toMatchObject({ prompt_version: "entrance/v3", receiver_present: "no" });
      expect(Array.isArray(JSON.parse(row.input_musubi_ids as string))).toBe(true);
    }
    expect(rows.flatMap((row) => JSON.parse(row.input_musubi_ids as string) as string[])).toContain(s.muId);
  });

  it("v2 は名指しで呼べる: むすびを渡さず、新しい列は null", async () => {
    const s = await setup();
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true, version: "v2" });
    expect(r.via).toBe("claude");
    expect(s.fake.sent.length).toBe(1);
    expect(s.fake.sent[0]).not.toContain("same_event");
    const row = await d1
      .prepare("SELECT prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE family_id = ? AND member_id = ?")
      .bind(s.familyId, s.elder.id)
      .first<Record<string, unknown>>();
    expect(row).toEqual({ prompt_version: "entrance/v2", receiver_present: null, input_musubi_ids: null });
  });
});
