// 運営の記録の画面（/ops/record）の入り口。読み取りだけ。見るのは運営と開発だけ（0017、0025）。
// 全環境で同じ規則（0030）: デモの家族は鍵だけで開く。デモでない家族は、親の同意を得て OPS_RECORD_FAMILIES に
// 載せた家族だけ開く。載っていなければ、存在しないものとして 404。
// 合言葉の cookie でも、家族を作る鍵（CREATE_FAMILY_TOKEN）でも開かない。運営の鍵（OPS_RECORD_TOKEN の Bearer）で守る。
// 鍵の確かめは auth.ts の一か所（requireInvite）で行い、ここでも重ねて確かめる（パスの書き方で一か所目を外れても開かない）。
// 本文・説明・理由はログに出さない。
import { Hono, type MiddlewareHandler } from "hono";
import type { OpsEntrance, OpsFamilyRecord, OpsNarration } from "../../shared/ops";
import { quoteSource, quoteText } from "../core/clean-transcript";
import type { AppConfig, FamilyRow, NarrationRow, OpsEntranceRow } from "../core/ports";
import { hasOpsKey } from "./auth";
import type { AppEnv } from "./env";
import { fail } from "./http";
import { privateBody } from "./photos";

const requireOpsKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await hasOpsKey(c))) return fail(c, "unauthorized");
  return next();
};

/** 運営が見てよい家族か。デモの家族か、同意を得て許可の一覧に載せた家族だけ（0030） */
export const opsMayView = (family: FamilyRow, config: AppConfig): boolean =>
  family.isDemo || config.opsRecordFamilies.includes(family.id);

/** 運営が見てよい家族を読む。ない家族と、見てはいけない家族は、どちらも null（同じ 404 にする） */
async function viewableFamily(deps: AppEnv["Variables"]["deps"], familyId: string): Promise<FamilyRow | null> {
  const family = await deps.repos.families.get(familyId);
  return family && opsMayView(family, deps.config) ? family : null;
}

/**
 * 引用の範囲を、位置を数える文字（quoteSource。文字の語りは transcript、声の語りは cleaned_text）からそのまま切り出す。印は置き換えない。
 * 範囲がなければ全文（整えた文字があればそれ、なければ transcript）。
 * 範囲があるのに位置を数える文字がない（声で整形がない・印が壊れている）か、範囲が外れていれば、ほかの文字を切らずに null
 */
function rawSlice(n: NarrationRow, start: number | null, end: number | null): string | null {
  if (start === null || end === null) return n.cleanedText ?? n.transcript;
  const c = quoteSource(n);
  if (!c) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > c.text.length) return null;
  return c.text.slice(start, end);
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
      inputMusubiIds: e.inputMusubiIds,
      receiverPresent: e.receiverPresent,
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
    durationMs: n.durationMs,
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
    const deps = c.get("deps");
    const { repos } = deps;
    const familyId = c.req.param("familyId");
    const family = await viewableFamily(deps, familyId);
    if (!family) return fail(c, "not_found");

    const [members, photos, entrances, narrations, guesses, musubi] = await Promise.all([
      repos.members.list(familyId),
      repos.photos.list(familyId),
      repos.opsRecords.listEntrances(familyId),
      repos.narrations.listAll(familyId),
      repos.photoGuesses.listByFamily(familyId),
      repos.musubi.listByFamily(familyId),
    ]);
    const byId = new Map(narrations.map((n) => [n.id, n]));
    // むすびは、入り口 v3 で Claude に渡したものだけ。推測の理由と根拠の記録は返さない（画面で使わない）
    const passedMusubi = new Set(entrances.flatMap((e) => e.inputMusubiIds ?? []));
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
        createdAt: p.createdAt,
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
      musubi: musubi
        .filter((m) => passedMusubi.has(m.id))
        .map((m) => ({ id: m.id, photos: m.photos.map((p) => ({ photoId: p.photoId, status: p.status })) })),
    };
    c.header("Cache-Control", "private, no-store");
    console.log(
      JSON.stringify({
        event: "ops_record",
        familyId,
        entrances: record.entrances.length,
        narrations: record.narrations.length,
        photoGuesses: record.photoGuesses.length,
        musubi: record.musubi.length,
      }),
    );
    return c.json(record);
  })

  // focus の枠を重ねるための写真。録音は返さない
  .get("/ops/families/:familyId/photos/:photoId/image", async (c) => {
    const deps = c.get("deps");
    const familyId = c.req.param("familyId");
    if (!(await viewableFamily(deps, familyId))) return fail(c, "not_found");
    const photo = await deps.repos.photos.get(familyId, c.req.param("photoId"));
    if (!photo) return fail(c, "not_found");
    const obj = await deps.photos.get(photo.storageKey);
    if (!obj) return fail(c, "not_found");
    return privateBody(obj.body, obj.contentType, obj.size);
  });
