// デモの初期化（0038）。デモの家族（is_demo）を、種（src/server/demo/seed.ts）の状態に戻す。
// - 残す: families の行、members、invite_links（一行も書かない）。戻す: 写真・語り・入り口・推測の表と、それらが指す保存先のファイル
// - 種は人を呼ばれ方で指す。家族の人の呼ばれ方と role が種と一致しなければ、何も変えずに止める
// - 種の写真と録音は保存先の demo/seed/ から families/<id>/ の新しい鍵に写す。欠けていれば、写した分を消して止める
// - D1 の「消す＋入れる＋時計を合わせる」は一つの batch。古いファイルは batch の後に消す
// - 最後に毎朝の処理（runMorning。Cron・時計のボタンと同じ関数）をその家族について呼ぶ。写真の説明は Batch にしない（一枚ずつ）
// - ログと戻り値は ID と件数だけ（名前・本文・保存先の鍵は出さない）
import type { Clock } from "../../shared/api";
import { SEED_CLEANED } from "../demo/seed-cleaned";
import {
  SEED_ENTRANCES,
  SEED_MEMBERS,
  SEED_NARRATIONS,
  SEED_PHOTOS,
  SEED_PHOTO_REGISTERED,
  SEED_VOICE_DURATION_MS,
  seedPhotoKey,
  seedVoiceKey,
  type SeedCalledAs,
} from "../demo/seed";
import { addDays, jstDate } from "./clock";
import { locateQuote } from "./clean-transcript";
import { runMorning, type MorningSummary } from "./morning";
import { PHOTO_GUESS_DEMO_RESET_BUDGET_MS } from "./photo-guess";
import { RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS } from "./record-extraction";
import type { AppDeps, DemoResetTable, EntranceRow, MemberRow, NarrationRow, PhotoRow } from "./ports";

export interface DemoResetSummary {
  familyId: string;
  asOfDate: string;
  deleted: { rows: Record<DemoResetTable, number>; files: number };
  inserted: { photos: number; narrations: number; entrances: number; files: number };
  morning: MorningSummary | null;
}

export type DemoResetResult =
  | { ok: true; summary: DemoResetSummary }
  | { ok: false; reason: "not_found" | "demo_seed_mismatch" | "demo_seed_missing" };

/** 日本時間の日付と HH:MM から、UTC のミリ秒 */
export const jstMs = (date: string, hm: string): number => Date.parse(`${date}T${hm}:00+09:00`);

/**
 * 家族の人を、種の呼ばれ方に結びつける。人数・呼ばれ方・role がすべて一致したときだけ（重なる呼ばれ方も不一致）
 */
export function matchSeedMembers(members: readonly MemberRow[]): Map<SeedCalledAs, MemberRow> | null {
  if (members.length !== SEED_MEMBERS.length) return null;
  const byCalledAs = new Map<string, MemberRow>();
  for (const m of members) {
    if (byCalledAs.has(m.calledAs)) return null;
    byCalledAs.set(m.calledAs, m);
  }
  const out = new Map<SeedCalledAs, MemberRow>();
  for (const s of SEED_MEMBERS) {
    const m = byCalledAs.get(s.calledAs);
    if (!m || m.role !== s.role) return null;
    out.set(s.calledAs, m);
  }
  return out;
}

/** 種から入れる行を組む（ID は毎回新しく作る）。鍵は families/<id>/ の下 */
export function buildSeedRows(familyId: string, asOfDate: string, people: Map<SeedCalledAs, MemberRow>) {
  const prefix = `families/${familyId}/`;
  const person = (c: SeedCalledAs) => people.get(c)!.id;
  const dayOf = (daysAgo: number) => addDays(asOfDate, -daysAgo);

  const photoIds = new Map<string, string>();
  const registered = dayOf(SEED_PHOTO_REGISTERED.daysAgo);
  const photos: { row: PhotoRow; seedKey: string }[] = SEED_PHOTOS.map((p, i) => {
    const id = crypto.randomUUID();
    photoIds.set(p.label, id);
    return {
      seedKey: seedPhotoKey(p),
      row: {
        id,
        familyId,
        ownerMemberId: person(p.owner),
        storageKey: `${prefix}photos/${id}.jpg`,
        contentHash: p.contentHash,
        width: p.width,
        height: p.height,
        takenAt: p.takenAt,
        // 架空の位置（台本の筋に合う市区町村の公開の代表点。実際の撮影場所ではない。seed.ts）
        latitude: p.latitude,
        longitude: p.longitude,
        // 並びを決めるため、一枚ごとに 1 秒ずらす
        createdAt: jstMs(registered, SEED_PHOTO_REGISTERED.at) + i * 1000,
      },
    };
  });

  const entranceIds = new Map(SEED_ENTRANCES.map((e) => [e.label, crypto.randomUUID()] as const));
  const narrationIds = new Map(SEED_NARRATIONS.map((n) => [n.label, crypto.randomUUID()] as const));

  const narrations: { row: NarrationRow; seedKey: string | null }[] = SEED_NARRATIONS.map((n) => {
    const id = narrationIds.get(n.label)!;
    const forDate = dayOf(n.daysAgo);
    const voice = n.kind === "voice";
    const cleaned = voice ? SEED_CLEANED[n.label] : undefined;
    if (voice && !cleaned) throw new Error("demo_seed_cleaned_missing");
    return {
      seedKey: voice ? seedVoiceKey(n) : null,
      row: {
        id,
        familyId,
        speakerMemberId: person(n.speaker),
        photoId: photoIds.get(n.photo)!,
        entranceId: n.entrance ? entranceIds.get(n.entrance)! : null,
        replyToId: n.replyTo ? narrationIds.get(n.replyTo)! : null,
        requestId: null,
        kind: n.kind,
        audioKey: voice ? `${prefix}audio/${id}` : null,
        // 写すときに保存先の種類で埋める
        audioContentType: null,
        durationMs: voice ? (SEED_VOICE_DURATION_MS[n.label] ?? null) : null,
        transcript: n.text,
        transcriptStatus: "done",
        cleanedText: cleaned?.cleanedText ?? null,
        cleanedModel: cleaned?.cleanedModel ?? null,
        cleanedPromptVersion: cleaned?.cleanedPromptVersion ?? null,
        uncertainSpans: cleaned ? cleaned.uncertainSpans : null,
        forDate,
        createdAt: jstMs(forDate, n.at),
      },
    };
  });

  const narrationByLabel = new Map(SEED_NARRATIONS.map((n, i) => [n.label, narrations[i]!.row] as const));
  const entrances: EntranceRow[] = SEED_ENTRANCES.map((e) => {
    const forDate = dayOf(e.daysAgo);
    const from = narrationByLabel.get(e.quote.narration)!;
    // 引用の位置は、その語りの quoteSource（文字の語りは transcript、声の語りは整えた文字）の中で探す
    const at = locateQuote(from, e.quote.text);
    if (!at.ok) throw new Error("demo_seed_quote_not_found");
    return {
      id: entranceIds.get(e.label)!,
      familyId,
      memberId: person(e.member),
      forDate,
      photoId: photoIds.get(e.photo)!,
      focus: null,
      quoteNarrationId: from.id,
      quoteStart: at.start,
      quoteEnd: at.end,
      // 固定の入り口（Claude の言葉・推測は持たない）
      question: null,
      kind: "fixed",
      reason: null,
      model: null,
      promptVersion: null,
      inputNarrationIds: null,
      inputTokens: null,
      outputTokens: null,
      inputMusubiIds: null,
      receiverPresent: null,
      questionAudioKey: null,
      questionAudioModel: null,
      questionAudioVoice: null,
      shownAt: jstMs(forDate, e.shownAt),
      createdAt: jstMs(forDate, e.createdAt),
    };
  });

  return { photos, narrations, entrances };
}

/**
 * デモの家族を種の状態に戻す。何度呼んでも同じ状態になる（ID と時刻の基準は呼ぶたびに新しい）。
 * 家族がない・デモでない・人が種と合わない・素材がない、のときは何も変えずに理由を返す
 */
export async function resetDemoFamily(deps: AppDeps, familyId: string): Promise<DemoResetResult> {
  const { repos, photos: store } = deps;
  const runId = crypto.randomUUID();
  const started = Date.now();
  const log = (fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ event: "demo_reset", runId, familyId, ...fields, ms: Date.now() - started }));

  const family = await repos.families.get(familyId);
  if (!family || !family.isDemo) return { ok: false, reason: "not_found" };
  const people = matchSeedMembers(await repos.members.list(familyId));
  if (!people) {
    log({ status: "demo_seed_mismatch" });
    return { ok: false, reason: "demo_seed_mismatch" };
  }

  const now = deps.now();
  const asOfDate = jstDate(now);
  const prefix = `families/${familyId}/`;
  const before = await repos.demoReset.snapshot(familyId);
  const seed = buildSeedRows(familyId, asOfDate, people);

  // 種のファイルを新しい鍵に写す。一つでも欠けたら、写した分を消して止める
  const copied: string[] = [];
  const removeCopied = async () => {
    for (const k of copied) await store.delete(k).catch(() => {});
  };
  const copy = async (from: string, to: string, accept: (contentType: string) => boolean): Promise<string | null> => {
    const obj = await store.get(from);
    if (!obj) return null;
    if (!accept(obj.contentType)) {
      await obj.body.cancel().catch(() => {});
      return null;
    }
    // 一つずつメモリに載せて写す（写真は縮小済みで数百 KB、録音は数十秒）
    const bytes = await new Response(obj.body).arrayBuffer();
    await store.put(to, bytes, { contentType: obj.contentType });
    copied.push(to);
    return obj.contentType;
  };
  try {
    for (const p of seed.photos) {
      if (!(await copy(p.seedKey, p.row.storageKey, (t) => t === "image/jpeg"))) {
        await removeCopied();
        log({ status: "demo_seed_missing", kind: "photo" });
        return { ok: false, reason: "demo_seed_missing" };
      }
    }
    for (const n of seed.narrations) {
      if (!n.seedKey || !n.row.audioKey) continue;
      const type = await copy(n.seedKey, n.row.audioKey, (t) => t.startsWith("audio/"));
      if (!type) {
        await removeCopied();
        log({ status: "demo_seed_missing", kind: "voice" });
        return { ok: false, reason: "demo_seed_missing" };
      }
      n.row.audioContentType = type;
    }
  } catch (e) {
    await removeCopied();
    throw e;
  }

  const clock: Clock = { date: asOfDate, slot: "morning" };
  try {
    await repos.demoReset.replaceContent(
      familyId,
      { photos: seed.photos.map((p) => p.row), entrances: seed.entrances, narrations: seed.narrations.map((n) => n.row) },
      clock,
    );
  } catch (e) {
    await removeCopied();
    throw e;
  }

  // 古いファイルを消す。families/<id>/ の外を指す鍵には触れない（ほかの家族・種のファイルを消さない）
  let deletedFiles = 0;
  for (const key of before.storedKeys) {
    if (!key.startsWith(prefix)) continue;
    try {
      await store.delete(key);
      deletedFiles++;
    } catch {
      // 残ったファイルは家族の削除（scripts/delete-family.mjs）の接頭の掃除で消える
    }
  }

  let morning: MorningSummary | null = null;
  try {
    // 写真を入れ直した直後なので、写真の説明は Batch にせず一枚ずつその場で作り、そろってから入り口を作る
    morning = await runMorning(deps, now, {
      familyId,
      photoGuess: { noBatch: true, budgetMs: PHOTO_GUESS_DEMO_RESET_BUDGET_MS },
      // 語り 12 本を順に取り出す（一本の中央 3.8 秒）。既定の 60 秒では残りが翌朝に回り、今日の入り口とむすびの材料が欠ける
      recordExtraction: { budgetMs: RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS },
    });
  } catch (e) {
    // 外の本文を出さない: 毎朝の処理が投げる決まった種類のほかは、名前だけ
    const kind = e instanceof Error ? (e.message === "morning_all_failed" ? e.message : e.name) : "unknown";
    log({ status: "morning_failed", kind });
  }

  const summary: DemoResetSummary = {
    familyId,
    asOfDate,
    deleted: { rows: before.rows, files: deletedFiles },
    inserted: {
      photos: seed.photos.length,
      narrations: seed.narrations.length,
      entrances: seed.entrances.length,
      files: copied.length,
    },
    morning,
  };
  log({ status: "done", deleted: summary.deleted, inserted: summary.inserted, morningRunId: morning?.runId ?? null });
  return { ok: true, summary };
}
