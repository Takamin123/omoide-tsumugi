// 入り口 v3（0046）の境界: g1a と g0・g1・7 日の除外・avoid の組み合わせ、同じ組が二つのむすびにあるとき、
// 受け取る人の語りが Y を出した時刻とちょうど同じとき、つながりの検査の表記ゆれ、既定が v3 であることと、名指しの v2 がむすびと記録を読まないこと、
// v3 で検査に落ちたときに新しい列を残さないこと。Claude は偽物。データは架空
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import {
  buildEntranceInput,
  checkEntranceLinks,
  ensureMorningEntrance,
  pickEntranceCandidates,
  sameEventLinks,
  type MusubiForEntrance,
} from "../src/server/core/entrance-claude";
import type { AppDeps, ClaudeCallRequest, ClaudeCallResult, ClaudeClient, MusubiPhotoStatus, PhotoRow } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, makeTestApp, onlyPurpose, postForm, startD1 } from "./helpers";

const photo = (id: string, owner = "o"): PhotoRow => ({
  id,
  familyId: "f",
  ownerMemberId: owner,
  storageKey: `k-${id}`,
  contentHash: id,
  width: 10,
  height: 10,
  takenAt: null,
  latitude: null,
  longitude: null,
  createdAt: 0,
});
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const mu = (id: string, photos: [string, MusubiPhotoStatus][]): MusubiForEntrance => ({
  id,
  photos: photos.map(([photoId, status]) => ({ photoId, status, decidedByMemberId: status === "guessed" ? null : "m", decidedAt: status === "guessed" ? null : 1 })),
});
const me = "me";
const ids = (r: ReturnType<typeof pickEntranceCandidates>) => r.map((c) => c.photo.id);

describe("pickEntranceCandidates: g1a の境界（0046）", () => {
  // X: 受け取る人が語った写真。Y: X と同じむすびで、ほかの家族の語りがある。W: まだ出していない写真
  const photos = [photo("X"), photo("Y"), photo("W")];
  const yOther = { photoId: "Y", speakerMemberId: "o", createdAt: day("2026-10-01") };
  const ms = [mu("m", [["X", "guessed"], ["Y", "guessed"]])];

  it("受け取る人の語りが、Y を最後に出した時刻とちょうど同じなら g1a にしない（より新しいときだけ）", () => {
    const at = day("2026-10-20");
    const past = [{ photoId: "Y", forDate: "2026-10-20", createdAt: at }];
    const same = [yOther, { photoId: "X", speakerMemberId: me, createdAt: at }];
    // Y は 7 日より前に出したので g4（W の後）
    expect(ids(pickEntranceCandidates(photos, same, past, me, "2026-11-03", new Set(), ms))).toEqual(["W", "X", "Y"]);
    const later = [yOther, { photoId: "X", speakerMemberId: me, createdAt: at + 1 }];
    expect(ids(pickEntranceCandidates(photos, later, past, me, "2026-11-03", new Set(), ms))[0]).toBe("Y");
  });

  it("7 日の境目: 最後に出した日がちょうど 7 日前なら外し、8 日前なら g1a にする（g4 と同じ境目）", () => {
    const ns = [yOther, { photoId: "X", speakerMemberId: me, createdAt: day("2026-11-09") }];
    const at7 = [{ photoId: "Y", forDate: "2026-11-03", createdAt: day("2026-11-03") }];
    expect(ids(pickEntranceCandidates(photos, ns, at7, me, "2026-11-10", new Set(), ms))).not.toContain("Y");
    const at8 = [{ photoId: "Y", forDate: "2026-11-02", createdAt: day("2026-11-02") }];
    expect(ids(pickEntranceCandidates(photos, ns, at8, me, "2026-11-10", new Set(), ms))[0]).toBe("Y");
  });

  it("前の 7 日に出したが、ほかの家族の新しい語りがあれば g1 のまま（g1a の後に並ぶ）", () => {
    const ps = [photo("X"), photo("Y"), photo("X2"), photo("Y2")];
    const ns = [
      { photoId: "X", speakerMemberId: me, createdAt: day("2026-11-02") },
      { photoId: "Y", speakerMemberId: "o", createdAt: day("2026-11-02") + 5 },
      { photoId: "X2", speakerMemberId: me, createdAt: day("2026-10-01") },
      { photoId: "Y2", speakerMemberId: "o", createdAt: day("2026-09-01") },
    ];
    const past = [{ photoId: "Y", forDate: "2026-11-01", createdAt: day("2026-11-01") }];
    const r = pickEntranceCandidates(ps, ns, past, me, "2026-11-03", new Set(), [
      mu("m1", [["X", "guessed"], ["Y", "guessed"]]),
      mu("m2", [["X2", "guessed"], ["Y2", "guessed"]]),
    ]);
    // Y2 は g1a、Y は g1（7 日以内なので g1a にならないが、g1 の免除で残る）
    expect(ids(r).slice(0, 2)).toEqual(["Y2", "Y"]);
  });

  it("g0 に入る写真は g1a に重ねて出さない（一度だけ、g0 の位置）", () => {
    const ns = [
      { id: "ny-me", photoId: "Y", speakerMemberId: me, createdAt: day("2026-10-01"), replyToId: null },
      { id: "ny-o", photoId: "Y", speakerMemberId: "o", createdAt: day("2026-10-02"), replyToId: "ny-me" },
      { id: "nx-me", photoId: "X", speakerMemberId: me, createdAt: day("2026-11-01"), replyToId: null },
    ];
    const r = ids(pickEntranceCandidates(photos, ns, [], me, "2026-11-03", new Set(), ms));
    expect(r[0]).toBe("Y");
    expect(r.filter((id) => id === "Y")).toHaveLength(1);
  });

  it("受け取る人の返事も、X への語りとして数える", () => {
    const ns = [
      { id: "nx-o", photoId: "X", speakerMemberId: "o", createdAt: day("2026-10-01"), replyToId: null },
      { id: "nx-me", photoId: "X", speakerMemberId: me, createdAt: day("2026-10-05"), replyToId: "nx-o" },
      { id: "ny-o", photoId: "Y", speakerMemberId: "o", createdAt: day("2026-09-01"), replyToId: null },
    ];
    // むすびがなければ X（新しいほかの家族の語り）が先。むすびがあれば Y が g1a で先
    expect(ids(pickEntranceCandidates(photos, ns, [], me, "2026-11-03"))[0]).toBe("X");
    expect(ids(pickEntranceCandidates(photos, ns, [], me, "2026-11-03", new Set(), ms))[0]).toBe("Y");
  });

  it("avoid で全部が外れたら、g1a を含む元の並びに戻す", () => {
    const ns = [yOther, { photoId: "X", speakerMemberId: me, createdAt: day("2026-11-01") }];
    const r = pickEntranceCandidates(photos, ns, [], me, "2026-11-03", new Set(["X", "Y", "W"]), ms);
    expect(ids(r)[0]).toBe("Y");
  });

  it("avoid に X（相手の写真）があっても、Y は g1a のまま", () => {
    const ns = [yOther, { photoId: "X", speakerMemberId: me, createdAt: day("2026-11-01") }];
    expect(ids(pickEntranceCandidates(photos, ns, [], me, "2026-11-03", new Set(["X"]), ms))[0]).toBe("Y");
  });

  it("一枚の Y が二つの X につながるとき、確かめたつながりを先に数える（語りが古くても）", () => {
    const ps = [photo("X1"), photo("X2"), photo("Y"), photo("Yb"), photo("Xb")];
    const ns = [
      { photoId: "X1", speakerMemberId: me, createdAt: day("2026-11-02") },
      { photoId: "X2", speakerMemberId: me, createdAt: day("2026-10-01") },
      { photoId: "Xb", speakerMemberId: me, createdAt: day("2026-11-01") },
      { photoId: "Y", speakerMemberId: "o", createdAt: day("2026-09-01") },
      { photoId: "Yb", speakerMemberId: "o", createdAt: day("2026-09-01") },
    ];
    const r = pickEntranceCandidates(ps, ns, [], me, "2026-11-03", new Set(), [
      mu("m1", [["X1", "guessed"], ["Y", "guessed"]]),
      mu("m2", [["X2", "confirmed"], ["Y", "confirmed"]]),
      mu("m3", [["Xb", "guessed"], ["Yb", "guessed"]]),
    ]);
    // Y は confirmed で数える（X2）。Yb は guessed なので後
    expect(ids(r).slice(0, 2)).toEqual(["Y", "Yb"]);
  });

  it("家族の写真でない X（むすびだけにある写真）は数えない", () => {
    const ns = [yOther, { photoId: "GHOST", speakerMemberId: me, createdAt: day("2026-11-01") }];
    const r = pickEntranceCandidates(photos, ns, [], me, "2026-11-03", new Set(), [mu("m", [["GHOST", "guessed"], ["Y", "guessed"]])]);
    expect(ids(r)).toEqual(ids(pickEntranceCandidates(photos, ns, [], me, "2026-11-03")));
  });

  it("三枚のむすびで一枚が rejected でも、残り二枚で生きている", () => {
    const ns = [yOther, { photoId: "X", speakerMemberId: me, createdAt: day("2026-11-01") }];
    const r = pickEntranceCandidates(photos, ns, [], me, "2026-11-03", new Set(), [mu("m", [["X", "guessed"], ["Y", "guessed"], ["W", "rejected"]])]);
    expect(ids(r)[0]).toBe("Y");
  });

  it("むすびを渡さないときと空のむすびを渡すときは、同じ並び（v2 の並び）", () => {
    const ns = [yOther, { photoId: "X", speakerMemberId: me, createdAt: day("2026-11-01") }, { photoId: "W", speakerMemberId: "o", createdAt: day("2026-10-15") }];
    const past = [{ photoId: "W", forDate: "2026-10-10", createdAt: day("2026-10-10") }];
    expect(pickEntranceCandidates(photos, ns, past, me, "2026-11-03", new Set(), [])).toEqual(pickEntranceCandidates(photos, ns, past, me, "2026-11-03"));
  });
});

describe("sameEventLinks: 同じ組が二つのむすびにあるとき", () => {
  const fam = new Set(["a", "b"]);
  it("guessed と confirmed のどちらが先でも confirmed のむすびを残し、組は一つだけ", () => {
    const g = mu("mg", [["a", "guessed"], ["b", "guessed"]]);
    const c = mu("mc", [["a", "confirmed"], ["b", "confirmed"]]);
    for (const order of [[g, c], [c, g]]) {
      const links = sameEventLinks(order, fam);
      expect(links.get("a")).toEqual([{ musubiId: "mc", withPhotoId: "b", status: "confirmed" }]);
      expect(links.get("b")).toEqual([{ musubiId: "mc", withPhotoId: "a", status: "confirmed" }]);
    }
  });
  it("両方 guessed なら先のむすびを残す。入力のむすびの ID も一つだけ", () => {
    const links = sameEventLinks([mu("m1", [["a", "guessed"], ["b", "guessed"]]), mu("m2", [["a", "guessed"], ["b", "guessed"]])], fam);
    expect(links.get("a")).toEqual([{ musubiId: "m1", withPhotoId: "b", status: "guessed" }]);
    const input = buildEntranceInput({
      receiverId: me,
      members: [{ id: me, role: "elder", relation: "祖母", calledAs: "架空のばあば" }],
      candidates: [{ photo: photo("a"), image: null, guess: null, shownCount: 0, lastShownDate: null }],
      narrations: [],
      sameEvent: { musubi: [mu("m1", [["a", "guessed"], ["b", "guessed"]]), mu("m2", [["a", "guessed"], ["b", "guessed"]])], familyPhotoIds: fam },
    });
    expect(input.inputMusubiIds).toEqual(["m1"]);
    const text = input.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    expect(text.match(/<same_event /g)).toHaveLength(1);
  });
});

describe("checkEntranceLinks: 表記ゆれ（NFKC・空白）", () => {
  const ctx = { passedTexts: new Map([["Y", ["夜店で 金魚 を すくった"]]]), candidateIds: new Set(["Y", "Z"]), linkedPhotoIds: new Set(["X"]) };
  it("全角の空白をはさんだつながりの語も止める", () => {
    expect(checkEntranceLinks("同じ　日の夜は、どんなふうでしたか", "Y", ctx, [])).toBe("question_asserts_link");
  });
  it("半角カナ・全角英数の記録の値も、NFKC でそろえて止める", () => {
    const recs = [
      { photoId: "X", value: "ﾎﾞﾝｵﾄﾞﾘ", origin: "told" as const },
      { photoId: "Z", value: "ＡＢＣ食堂", origin: "told" as const },
    ];
    expect(checkEntranceLinks("ボンオドリのあとは、どんなふうでしたか", "Y", ctx, recs)).toBe("question_other_photo_words");
    expect(checkEntranceLinks("ABC食堂では、どんなふうでしたか", "Y", ctx, recs)).toBe("question_other_photo_words");
  });
  it("選んだ写真の語りに空白入りで出てくる語は、空白を除いて照合して通す", () => {
    const recs = [{ photoId: "X", value: "金魚", origin: "told" as const }];
    expect(checkEntranceLinks("金魚は、そのあとどうなりましたか", "Y", ctx, recs)).toBeNull();
  });
  it("つながりの語が、選んでいない候補の語りにだけあっても止める", () => {
    const c2 = { ...ctx, passedTexts: new Map([["Y", ["夜店"]], ["Z", ["翌日は雨"]]]) };
    expect(checkEntranceLinks("翌日は、どんなふうでしたか", "Y", c2, [])).toBe("question_asserts_link");
    expect(checkEntranceLinks("翌日は、どんなふうでしたか", "Z", c2, [])).toBeNull();
  });
  it("写真のない記録（photoId が null）は数えない", () => {
    expect(checkEntranceLinks("盆踊りのあとは、どんなふうでしたか", "Y", ctx, [{ photoId: null, value: "盆踊り", origin: "told" }])).toBeNull();
  });
  it("問いかけの末尾の句点は、照合の前に落とす", () => {
    expect(checkEntranceLinks("続きを聞かせてください。", "Y", ctx, [])).toBe("question_asserts_link");
  });
});

// ---- 毎朝の処理（D1） ----

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const NOW = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00

function scriptedClaude(question: string) {
  const versions: string[] = [];
  const claude: ClaudeClient = {
    async call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>> {
      versions.push(req.prompt.version);
      const text = req.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      const first = [...text.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1]!)[0]!;
      const base = { reason: "架空の理由", photo_id: first, focus: null, quote: null, question };
      const value = (req.prompt.version === "entrance/v3" ? { receiver_present: "yes", ...base } : base) as T;
      const meta = { purpose: req.prompt.purpose, model: "claude-fake", promptVersion: req.prompt.version, inputTokens: 1, outputTokens: 1, attempts: 1 };
      const violation = req.check?.(value) ?? null;
      if (violation) return { ok: false, reason: "check_failed", violation, meta };
      return { ok: true, value, meta };
    },
    createBatch: (req) => notConfiguredClaude.createBatch(req),
    getBatch: (id) => notConfiguredClaude.getBatch(id),
    getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
  };
  return { claude, versions };
}

async function postText(t: ReturnType<typeof makeTestApp>, cookie: string, photoId: string, text: string) {
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId, entranceId: null, replyToId: null, text }));
  const res = await postForm(t, "/api/narrations", form, cookie);
  expect(res.ok).toBe(true);
}

async function setup(question: string) {
  const fake = scriptedClaude(question);
  const t = makeTestApp(d1, { claude: onlyPurpose(fake.claude, "entrance") });
  const f = await createFamily(t);
  const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
  const elder = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
  const x = await addPhoto(t, gc.cookie, 401);
  const y = await addPhoto(t, gc.cookie, 402);
  await postText(t, gc.cookie, y.id, "架空の夜店の話");
  await postText(t, elder.cookie, x.id, "架空の盆踊りの話");
  await t.flush();
  await d1
    .prepare("INSERT INTO musubi (id, family_id, created_by, guessed_reason, guessed_evidence_record_ids, model, prompt_version, created_at) VALUES (?, ?, 'guessed', '架空', '[]', 'm', 'musubi_guess/v1', 1)")
    .bind(`mu-${f.familyId}`, f.familyId)
    .run();
  for (const p of [x.id, y.id]) {
    await d1.prepare("INSERT INTO musubi_photos (musubi_id, photo_id, family_id, status, created_at) VALUES (?, ?, ?, 'guessed', 1)").bind(`mu-${f.familyId}`, p, f.familyId).run();
  }
  return { t, fake, familyId: f.familyId, elder };
}

/** むすびと記録を読んだら落ちる repos（v2 が読まないことを確かめる） */
function withoutMusubiReads(deps: AppDeps): AppDeps {
  const boom = () => Promise.reject(new Error("v2 はむすび・記録を読まない"));
  return {
    ...deps,
    repos: {
      ...deps.repos,
      musubi: { ...deps.repos.musubi, listByFamily: boom },
      records: { ...deps.repos.records, listByFamily: boom },
    },
  };
}

describe("毎朝の処理: 版の既定と、v3 の全か無か（0046）", () => {
  it("既定（v3）は、むすびと記録を読んで Claude の入り口を作り、receiver_present と input_musubi_ids を残す", async () => {
    const s = await setup("この日のことを、聞かせてください");
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true });
    expect(r.via).toBe("claude");
    expect(s.fake.versions).toEqual(["entrance/v3"]);
    const row = await d1.prepare("SELECT kind, prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE member_id = ?").bind(s.elder.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ kind: "claude", prompt_version: "entrance/v3", receiver_present: "yes" });
    expect(JSON.parse(row!.input_musubi_ids as string)).toEqual([`mu-${s.familyId}`]);
  });

  for (const which of ["musubi", "records"] as const) {
    it(`既定（v3）で ${which} の読み出しが落ちたら、Claude を呼ばずに固定の入り口に倒す（投げない）`, async () => {
      const s = await setup("この日のことを、聞かせてください");
      const boom = () => Promise.reject(new Error("架空の読み出しの失敗"));
      const deps: AppDeps = { ...s.t.deps, repos: { ...s.t.deps.repos, [which]: { ...s.t.deps.repos[which], listByFamily: boom } } };
      const r = await ensureMorningEntrance(deps, { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true });
      expect(r).toMatchObject({ via: "fixed", fallback: "same_event_unavailable" });
      expect(s.fake.versions).toEqual([]);
      const row = await d1.prepare("SELECT kind, prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE member_id = ?").bind(s.elder.id).first();
      expect(row).toEqual({ kind: "fixed", prompt_version: null, receiver_present: null, input_musubi_ids: null });
    });
  }

  it("読み出しが落ちたら、どちらの読み出しかとエラーの名前だけをログに残す（メッセージ・本文は出さない）", async () => {
    const s = await setup("この日のことを、聞かせてください");
    class D1LikeError extends Error {
      override name = "D1LikeError";
    }
    const boom = () => Promise.reject(new D1LikeError("架空の失敗_MSG_4e2"));
    const odd = () => Promise.reject(Object.assign(new Error("架空の失敗_MSG_8a1"), { name: "名前 に 空白" }));
    const deps: AppDeps = {
      ...s.t.deps,
      repos: {
        ...s.t.deps.repos,
        musubi: { ...s.t.deps.repos.musubi, listByFamily: boom },
        records: { ...s.t.deps.repos.records, listByFamily: odd },
      },
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const r = await ensureMorningEntrance(deps, { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), {
        useClaude: true,
        traceId: "trace-x",
      });
      expect(r).toMatchObject({ via: "fixed", fallback: "same_event_unavailable" });
      const lines = spy.mock.calls.map((c) => String(c[0]));
      const parse = (l: string): Record<string, unknown> | null => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      };
      const failed = lines.map(parse).filter((l) => l?.event === "entrance_same_event_read_failed");
      expect(failed).toHaveLength(2);
      const base = { traceId: "trace-x", familyId: s.familyId, memberId: s.elder.id, forDate: "2026-11-03" };
      expect(failed).toContainEqual({ event: "entrance_same_event_read_failed", ...base, read: "musubi", errorType: "D1LikeError" });
      // 識別子の形でない名前は出さない
      expect(failed).toContainEqual({ event: "entrance_same_event_read_failed", ...base, read: "records", errorType: "Error" });
      const all = lines.join("\n");
      expect(all).not.toContain("架空の失敗");
      expect(all).not.toContain("名前 に 空白");
    } finally {
      spy.mockRestore();
    }
  });

  it("片方だけ落ちたらログは 1 行。Error でないものが投げられたら、その typeof だけを残す", async () => {
    const s = await setup("この日のことを、聞かせてください");
    const deps: AppDeps = {
      ...s.t.deps,
      repos: { ...s.t.deps.repos, records: { ...s.t.deps.repos.records, listByFamily: () => Promise.reject("架空の文字列_MSG_b19") } },
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const r = await ensureMorningEntrance(deps, { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true });
      expect(r).toMatchObject({ via: "fixed", fallback: "same_event_unavailable" });
      const lines = spy.mock.calls.map((c) => String(c[0]));
      const failed = lines
        .map((l) => {
          try {
            return JSON.parse(l) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((l) => l?.event === "entrance_same_event_read_failed");
      expect(failed).toEqual([
        { event: "entrance_same_event_read_failed", traceId: null, familyId: s.familyId, memberId: s.elder.id, forDate: "2026-11-03", read: "records", errorType: "string" },
      ]);
      expect(lines.join("\n")).not.toContain("架空の文字列");
    } finally {
      spy.mockRestore();
    }
  });

  it("名指しの v2 は読み出しをしないので、読み出しの失敗のログも出さない", async () => {
    const s = await setup("この日のことを、聞かせてください");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await ensureMorningEntrance(withoutMusubiReads(s.t.deps), { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true, version: "v2" });
      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("entrance_same_event_read_failed"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("名指しの v2 は、むすびと記録を読まずに Claude の入り口を作り、新しい列は null", async () => {
    const s = await setup("この日のことを、聞かせてください");
    const r = await ensureMorningEntrance(withoutMusubiReads(s.t.deps), { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true, version: "v2" });
    expect(r.via).toBe("claude");
    expect(s.fake.versions).toEqual(["entrance/v2"]);
    const row = await d1.prepare("SELECT kind, prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE member_id = ?").bind(s.elder.id).first();
    expect(row).toEqual({ kind: "claude", prompt_version: "entrance/v2", receiver_present: null, input_musubi_ids: null });
  });

  it("v3 でつながりの検査に落ちたら固定の入り口に倒し、receiver_present と input_musubi_ids は残さない", async () => {
    const s = await setup("同じ旅の夜は、どんなふうでしたか");
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder.id }, "2026-11-03", NOW.getTime(), { useClaude: true, version: "v3" });
    expect(r.via).toBe("fixed");
    expect(r.violation).toBe("question_asserts_link");
    const row = await d1.prepare("SELECT kind, question, prompt_version, receiver_present, input_musubi_ids FROM entrances WHERE member_id = ?").bind(s.elder.id).first();
    expect(row).toEqual({ kind: "fixed", question: null, prompt_version: null, receiver_present: null, input_musubi_ids: null });
  });
});
