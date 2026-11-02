// 運営の記録の画面（/ops/record）の入り口。読み取りだけ。見るのは運営と開発だけ（0017、0024）。
// 本番（APP_ENV=production）では 404。手元とプレビューのデモの家族で使う。
// 合言葉の cookie では開かない。運営の鍵（CREATE_FAMILY_TOKEN の Bearer）で守る。
// 確かめは auth.ts の一か所（requireInvite）で行い、ここでも重ねて確かめる（パスの書き方で一か所目を外れても開かない）。
// 本文・説明・理由はログに出さない。
import { Hono, type MiddlewareHandler } from "hono";
import type { OpsEntrance, OpsFamilyRecord, OpsNarration } from "../../shared/ops";
import { quoteText } from "../core/clean-transcript";
import type { NarrationRow, OpsEntranceRow } from "../core/ports";
import { hasOpsKey } from "./auth";
import { devToolsOpen, type AppEnv } from "./env";
import { fail } from "./http";
import { privateBody } from "./photos";

const requireOpsKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await hasOpsKey(c))) return fail(c, "unauthorized");
  // 本番では、鍵が合っていても開かない（実際の家族の語りを運営が読むことは、人間に聞くまで行わない。0024）
  if (!devToolsOpen(c.get("deps").config)) return fail(c, "not_found");
  return next();
};

/** 引用の範囲を cleaned_text からそのまま切り出す（範囲がなければ全文。整形がなければ transcript）。印は置き換えない */
function rawSlice(n: NarrationRow, start: number | null, end: number | null): string | null {
  // 範囲は cleaned_text の位置（0017、0018）。範囲があるのに整形がなければ、ほかの文字を切らずに null
  if (start === null || end === null) return n.cleanedText ?? n.transcript;
  const base = n.cleanedText;
  if (base === null) return null;
  if (start < 0 || end <= start || end > base.length) return null;
  return base.slice(start, end);
}

function entranceRecord(e: OpsEntranceRow, byId: Map<string, NarrationRow>): OpsEntrance {
  const from = e.quoteNarrationId ? byId.get(e.quoteNarrationId) : undefined;
  return {
    id: e.id,
    forDate: e.forDate,
    memberId: e.memberId,
    kind: e.kind,
    photoId: e.photoId,
    shownAt: e.shownAt,
    createdAt: e.createdAt,
    told: {
      quote: e.quoteNarrationId
        ? {
            narrationId: e.quoteNarrationId,
            speakerMemberId: from?.speakerMemberId ?? null,
            start: e.quoteStart,
            end: e.quoteEnd,
            rawText: from ? rawSlice(from, e.quoteStart, e.quoteEnd) : null,
            shownText: from ? quoteText(from, e.quoteStart, e.quoteEnd) : null,
          }
        : null,
    },
    guessed: {
      focus: e.focus,
      question: e.question,
      reason: e.reason,
      model: e.model,
      promptVersion: e.promptVersion,
      inputNarrationIds: e.inputNarrationIds,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
    },
  };
}

function narrationRecord(n: NarrationRow): OpsNarration {
  return {
    id: n.id,
    photoId: n.photoId,
    speakerMemberId: n.speakerMemberId,
    entranceId: n.entranceId,
    kind: n.kind,
    hasAudio: n.audioKey !== null,
    forDate: n.forDate,
    createdAt: n.createdAt,
    transcriptStatus: n.transcriptStatus,
    transcript: n.transcript,
    cleaned:
      n.cleanedText === null
        ? null
        : { text: n.cleanedText, uncertainSpans: n.uncertainSpans, model: n.cleanedModel, promptVersion: n.cleanedPromptVersion },
  };
}

const opsImageUrl = (familyId: string, photoId: string) =>
  `/api/ops/families/${encodeURIComponent(familyId)}/photos/${encodeURIComponent(photoId)}/image`;

export const ops = new Hono<AppEnv>()
  // ここで "*" に掛けると、同じ "/" に載るほかの入り口にも掛かるので、/ops の下だけにする
  .use("/ops/*", requireOpsKey)

  .get("/ops/families/:familyId/record", async (c) => {
    const { repos } = c.get("deps");
    const familyId = c.req.param("familyId");
    const family = await repos.families.get(familyId);
    if (!family) return fail(c, "not_found");

    const [members, photos, entrances, narrations, guesses] = await Promise.all([
      repos.members.list(familyId),
      repos.photos.list(familyId),
      repos.opsRecords.listEntrances(familyId),
      repos.narrations.listAll(familyId),
      repos.photoGuesses.listByFamily(familyId),
    ]);
    const byId = new Map(narrations.map((n) => [n.id, n]));
    const record: OpsFamilyRecord = {
      family: { id: family.id, isDemo: family.isDemo, createdAt: family.createdAt },
      members: members.map((m) => ({ id: m.id, role: m.role, relation: m.relation, calledAs: m.calledAs })),
      // 緯度経度と保存先のキーは返さない
      photos: photos.map((p) => ({
        id: p.id,
        ownerMemberId: p.ownerMemberId,
        width: p.width,
        height: p.height,
        takenAt: p.takenAt,
        imageUrl: opsImageUrl(familyId, p.id),
      })),
      entrances: entrances.map((e) => entranceRecord(e, byId)),
      narrations: narrations.map(narrationRecord),
      photoGuesses: guesses.map((g) => ({
        id: g.id,
        photoId: g.photoId,
        description: g.description,
        model: g.model,
        promptVersion: g.promptVersion,
        createdAt: g.createdAt,
      })),
    };
    c.header("Cache-Control", "private, no-store");
    console.log(
      JSON.stringify({
        event: "ops_record",
        familyId,
        entrances: record.entrances.length,
        narrations: record.narrations.length,
        photoGuesses: record.photoGuesses.length,
      }),
    );
    return c.json(record);
  })

  // focus の枠を重ねるための写真。録音は返さない
  .get("/ops/families/:familyId/photos/:photoId/image", async (c) => {
    const deps = c.get("deps");
    const photo = await deps.repos.photos.get(c.req.param("familyId"), c.req.param("photoId"));
    if (!photo) return fail(c, "not_found");
    const obj = await deps.photos.get(photo.storageKey);
    if (!obj) return fail(c, "not_found");
    return privateBody(obj.body, obj.contentType, obj.size);
  });
