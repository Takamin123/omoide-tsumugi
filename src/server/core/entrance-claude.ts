// 入り口づくり（Sonnet、構造化出力）。判断は docs/decisions/0017（と 0020、0023）。
// - 候補はルールで 6 枚まで絞る（同じ写真を続けて出さないことは、プロンプトではなくここで止める）
// - 同じ日にほかの家族へ出した写真は、なるべく候補から外す（0042）
// - 渡すのは、縮小済みの画像、写真の説明（推測として）、持ち主の呼ばれ方、撮影日（年月日）、提示の履歴、語り、家族の一覧、受け取る人
// - 渡さない: 緯度経度（あるかどうかも）、storageKey と URL、合言葉。語りは新しいものから 20,000 字まで
// - 受け取った後に機械的に検査する（checkEntrance）。違反は 1 回だけ再試行（ClaudeClient の check）。だめなら固定の入り口
// - 引用は Claude に文字列そのものを返させ、位置はアプリが探す（locateQuote）
// - 毎朝の処理（Cron とデモの時計のボタン）からだけ呼ぶ。家族が画面を開いたときには呼ばない
// - entrance/v3（0046）: むすび（同じ出来事の推測）を、候補の並び（g1a）と Claude への入力（<same_event>）にだけ使う。
//   問いかけの中身には使わない（つながりの断定・別の写真の記録の語を検査で止める）。ENTRANCE_VERSION で切り替え、既定は v3（人間、2026-11-04）
import { z } from "zod";
import { ENTRANCE_PROMPTS, type EntranceVersion } from "../prompts";
import { bytesToBase64, notConfiguredClaude } from "./claude";
import { QUESTION_MAX_CHARS, charCount, exceedsChars, findTestingPhrase } from "./claude-checks";
import { displayText, locateQuote, quoteSource } from "./clean-transcript";
import { addDays } from "./clock";
import { compareTaken, ensureFixedEntrance, type EnsureResult } from "./entrances";
import type {
  AppDeps,
  ClaudeCallResult,
  ClaudeContentPart,
  ClaudeFailure,
  EntranceRow,
  FamilyRow,
  MemberRow,
  MusubiRow,
  NarrationRow,
  NewClaudeEntrance,
  PhotoRow,
  RecordRow,
} from "./ports";

/**
 * 家族の流れで使う入り口の版（0046）。v3 は、むすびの g1a と <same_event>、receiver_present、つながりの検査を足した版。
 * 既定は v3（人間の決定、2026-11-04。マイグレーション 0006 が先に要る）。v2 は version を名指しすれば呼べる
 */
export const ENTRANCE_VERSION: EntranceVersion = "v3";

/** 候補の写真の枚数の上限（画像を渡す枚数。費用と時間が枚数に比例する） */
export const MAX_ENTRANCE_CANDIDATES = 6;
/** 前の何日に出した写真を、候補から外すか（ほかの家族の新しい語りがある写真は外さない） */
export const ENTRANCE_RECENT_DAYS = 7;
/** 渡す語りの合計の文字数の上限（新しいものから） */
export const ENTRANCE_NARRATION_MAX_CHARS = 20_000;
/** 添える家族の言葉の文字数の上限 */
export const ENTRANCE_QUOTE_MAX_CHARS = 80;
/** reason の文字数の上限 */
export const ENTRANCE_REASON_MAX_CHARS = 200;
/** focus の幅と高さの下限（顔を切り抜くような小さな枠を出させない） */
export const ENTRANCE_FOCUS_MIN = 0.25;
/** 一枚の画像の base64 の長さの上限（API の上限 5MB。超える写真は候補から外す） */
export const ENTRANCE_MAX_IMAGE_BASE64_CHARS = 5 * 1024 * 1024;
/** 小数の足し算の誤差（0.3 + 0.7 が 1 をわずかに超えるなど） */
const FOCUS_EPSILON = 1e-6;

/**
 * 問いかけに入れない語（部分一致。0017）。findTestingPhrase とあわせて使う。
 * 迷うものは止める側に倒す。止まっても固定の入り口に倒れるだけで済む
 */
export const ENTRANCE_QUESTION_FORBIDDEN: readonly string[] = [
  "覚えて",
  "ご記憶",
  "思い出せ",
  "分かりますか",
  "わかりますか",
  "知っていますか",
  "誰ですか",
  "どこですか",
  "いつですか",
  "何年",
  "正しい",
  "当て",
  "クイズ",
  "写真を",
  "送って",
  "見せて",
  "撮って",
  "AI",
  "私",
  "分析",
  "!",
];
/** 問いかけの冒頭に置かない相づち（0017） */
export const ENTRANCE_QUESTION_FORBIDDEN_OPENERS: readonly string[] = ["わあ", "わぁ", "素敵", "すてき", "いいですね", "なるほど"];
/**
 * 問いかけで、写真どうしのつながり・順序を言う語（entrance/v3。0046）。選んだ写真の語り（渡した文字）にない語が
 * 問いかけにあれば止める。迷ったら止める側（止まっても固定の入り口に倒れるだけ）
 */
export const ENTRANCE_LINK_WORDS: readonly string[] = [
  "同じ日",
  "同じ旅",
  "同じとき",
  "同じ時",
  "同じ場所",
  "同じところ",
  "同じ出来事",
  "同じ行事",
  "同じ宿",
  "続き",
  "つづき",
  "初日",
  "二日目",
  "三日目",
  // 算用数字の書き方（全角は NFKC で半角にそろう）
  "2日目",
  "3日目",
  "翌日",
  "次の日",
  "前の日",
  "前日",
];
/** 別の写真の記録の語として数える、記録の値の最小の字数（一字の値は誤検出が多い） */
export const ENTRANCE_OTHER_RECORD_MIN_CHARS = 2;

/** 問いかけの終わり方（このどれかで終わる） */
export const ENTRANCE_QUESTION_ENDINGS: readonly string[] = ["か", "か？", "ください"];

// ---- 構造化出力 ----

const focusSchema = z.object({
  x: z.number().describe("左端（画像の幅に対する比率 0〜1）"),
  y: z.number().describe("上端（画像の高さに対する比率 0〜1）"),
  w: z.number().describe("幅（比率。0.25 以上）"),
  h: z.number().describe("高さ（比率。0.25 以上）"),
});

/** reason を先に書かせる（選んだ理由を考えてから、写真・範囲・引用・問いかけを決める）。entrance/v2 の形 */
export const entranceSchema = z.object({
  reason: z.string().describe("運営と開発だけが読む。どの候補をなぜ選んだか、focus の理由、材料にした語りの ID。200 字以内"),
  photo_id: z.string().describe("候補の中から選んだ写真の photo_id"),
  focus: focusSchema.nullable().describe("最初に見せる範囲。写真の全体でよければ null"),
  quote: z
    .object({
      narration_id: z.string().describe("引用する語りの narration_id（選んだ写真の、引用できる語り）"),
      text: z.string().describe("その語りの本文から、一字も変えずに写した連続した部分。80 字以内"),
    })
    .nullable()
    .describe("添える家族の言葉。ふさわしいものがなければ null"),
  question: z.string().describe("受け取る人への問いかけ。一文、60 字以内"),
});
export type EntranceOutput = z.infer<typeof entranceSchema>;

/** entrance/v3 の形。receiver_present を reason の前に（その場にいたかを決めてから、問いかけを書く。0024・0046） */
export const entranceSchemaV3 = z.object({
  receiver_present: z
    .enum(["yes", "no", "unknown"])
    .describe("受け取る人が、選んだ写真のその場にいたか。推測でよい。問いかけには書かない"),
  ...entranceSchema.shape,
});
export type EntranceOutputV3 = z.infer<typeof entranceSchemaV3>;

// ---- 候補の絞り込み ----

type PastEntrance = Pick<EntranceRow, "photoId" | "forDate" | "createdAt">;
/** むすび（同じ出来事の推測）。写真ごとの状態を持つ */
export type MusubiForEntrance = Pick<MusubiRow, "id" | "photos">;

/** 候補の写真と同じむすびにある、別の写真（0046） */
export interface SameEventLink {
  musubiId: string;
  withPhotoId: string;
  /** 両方の写真が confirmed なら confirmed。それ以外は guessed（推測を含むつながり） */
  status: "guessed" | "confirmed";
}

/**
 * 生きているむすび: rejected の写真と、この家族の写真でないものを外して、2 枚以上残るもの（musubi-guess.ts の existing と同じ扱い）。
 * 写真 ID → 同じむすびのほかの写真
 */
export function sameEventLinks(musubi: readonly MusubiForEntrance[], familyPhotoIds: ReadonlySet<string>): Map<string, SameEventLink[]> {
  const out = new Map<string, SameEventLink[]>();
  for (const m of musubi) {
    const live = m.photos.filter((p) => p.status !== "rejected" && familyPhotoIds.has(p.photoId));
    if (live.length < 2) continue;
    for (const a of live) {
      for (const b of live) {
        if (a.photoId === b.photoId) continue;
        const list = out.get(a.photoId) ?? [];
        // 同じ写真の組が二つのむすびに出たら、確かめた側を残す
        const prev = list.find((l) => l.withPhotoId === b.photoId);
        const status = a.status === "confirmed" && b.status === "confirmed" ? "confirmed" : "guessed";
        if (prev) {
          if (status === "confirmed" && prev.status !== "confirmed") Object.assign(prev, { musubiId: m.id, status });
          continue;
        }
        list.push({ musubiId: m.id, withPhotoId: b.photoId, status });
        out.set(a.photoId, list);
      }
    }
  }
  return out;
}
type NarrationForPick = Pick<NarrationRow, "photoId" | "speakerMemberId" | "createdAt"> &
  Partial<Pick<NarrationRow, "id" | "replyToId">>;

export interface EntranceCandidate {
  photo: PhotoRow;
  /** この人の入り口に出した回数と、最後の日付 */
  shownCount: number;
  lastShownDate: string | null;
}

/**
 * 候補の写真を、0017 の順に MAX_ENTRANCE_CANDIDATES 枚まで選ぶ。
 * 0. ほかの家族が、この人の語りに返事をした写真で、その返事の後にこの人の入り口に出していないもの（返事の新しい順。0042）。
 *    一段だけ（返事の返事は追わない）
 * 1a. むすびが渡されたとき（entrance/v3。0046）: 同じ生きているむすびの写真 X について、この人自身が語った（返事を含む）時刻が、
 *    この写真をこの人に最後に出した時刻より新しく、この写真にほかの家族の語りがあるもの。確かめたつながりを先に、同じなら X への語りの新しい順。
 *    前の 7 日に出した写真は入れない（0・1 のような免除はしない）
 * 1. ほかの家族が語った写真で、その語りの後にこの人の入り口に出していないもの（語りの新しい順）
 * 2. ほかの家族の写真で、まだ出していないもの（撮影日の古い順）
 * 3. 自分の写真で、まだ出していないもの（撮影日の古い順）
 * 4. 最後に出したのがいちばん古いもの
 * 前の ENTRANCE_RECENT_DAYS 日に出した写真は、0・1 以外では候補にしない。forDate 以降の入り口は数えない
 * avoidPhotoIds（同じ家族で、今日すでにほかの人の入り口に出した写真）は 0〜4 から外す。
 * 外すと 0 枚になるなら外さない（元の並び）。重ねないのは「なるべく」（0042）
 */
export function pickEntranceCandidates(
  photos: PhotoRow[],
  narrations: NarrationForPick[],
  past: PastEntrance[],
  memberId: string,
  forDate: string,
  avoidPhotoIds: ReadonlySet<string> = new Set(),
  musubi: readonly MusubiForEntrance[] = [],
): EntranceCandidate[] {
  const shown = new Map<string, { count: number; lastDate: string; lastAt: number }>();
  for (const e of past) {
    if (e.forDate >= forDate) continue;
    const s = shown.get(e.photoId);
    if (!s) shown.set(e.photoId, { count: 1, lastDate: e.forDate, lastAt: e.createdAt });
    else {
      s.count++;
      if (e.forDate > s.lastDate) s.lastDate = e.forDate;
      if (e.createdAt > s.lastAt) s.lastAt = e.createdAt;
    }
  }
  const latestOther = new Map<string, number>();
  // この人の語りへの、ほかの家族の返事（写真ごとに最新の時刻）
  const speakerOf = new Map<string, string>();
  for (const n of narrations) if (n.id) speakerOf.set(n.id, n.speakerMemberId);
  const latestReply = new Map<string, number>();
  // この人自身の語り（返事を含む）の、写真ごとの最新の時刻
  const latestOwn = new Map<string, number>();
  for (const n of narrations) {
    if (n.speakerMemberId === memberId) {
      const o = latestOwn.get(n.photoId);
      if (o === undefined || n.createdAt > o) latestOwn.set(n.photoId, n.createdAt);
      continue;
    }
    const prev = latestOther.get(n.photoId);
    if (prev === undefined || n.createdAt > prev) latestOther.set(n.photoId, n.createdAt);
    if (n.replyToId && speakerOf.get(n.replyToId) === memberId) {
      const r = latestReply.get(n.photoId);
      if (r === undefined || n.createdAt > r) latestReply.set(n.photoId, n.createdAt);
    }
  }
  const recentFrom = addDays(forDate, -ENTRANCE_RECENT_DAYS);
  const byTaken = [...photos].sort(compareTaken);

  const links = sameEventLinks(musubi, new Set(photos.map((p) => p.id)));

  const g0: PhotoRow[] = [];
  const g1a: { photo: PhotoRow; confirmed: boolean; talkedAt: number }[] = [];
  const g1: PhotoRow[] = [];
  const g2: PhotoRow[] = [];
  const g3: PhotoRow[] = [];
  const g4: PhotoRow[] = [];
  for (const p of byTaken) {
    const s = shown.get(p.id);
    const told = latestOther.get(p.id);
    const replied = latestReply.get(p.id);
    if (replied !== undefined && (!s || replied > s.lastAt)) {
      g0.push(p);
      continue;
    }
    // 1a: 同じむすびの別の写真について、この人が最後に出した後に語っている
    if (told !== undefined && (!s || s.lastDate < recentFrom)) {
      let best: { confirmed: boolean; talkedAt: number } | null = null;
      for (const l of links.get(p.id) ?? []) {
        const talkedAt = latestOwn.get(l.withPhotoId);
        if (talkedAt === undefined || (s && talkedAt <= s.lastAt)) continue;
        const c = { confirmed: l.status === "confirmed", talkedAt };
        if (!best || (c.confirmed && !best.confirmed) || (c.confirmed === best.confirmed && c.talkedAt > best.talkedAt)) best = c;
      }
      if (best) {
        g1a.push({ photo: p, ...best });
        continue;
      }
    }
    if (told !== undefined && (!s || told > s.lastAt)) g1.push(p);
    else if (!s) (p.ownerMemberId !== memberId ? g2 : g3).push(p);
    else if (s.lastDate < recentFrom) g4.push(p);
  }
  g0.sort((a, b) => latestReply.get(b.id)! - latestReply.get(a.id)!);
  g1a.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.talkedAt - a.talkedAt);
  g1.sort((a, b) => latestOther.get(b.id)! - latestOther.get(a.id)!);
  // 最後に出した日の古い順（同じなら撮影日の古い順。sort は安定）
  g4.sort((a, b) => shown.get(a.id)!.lastDate.localeCompare(shown.get(b.id)!.lastDate));

  const ordered = [...g0, ...g1a.map((x) => x.photo), ...g1, ...g2, ...g3, ...g4];
  const kept = ordered.filter((p) => !avoidPhotoIds.has(p.id));
  return (kept.length > 0 ? kept : ordered).slice(0, MAX_ENTRANCE_CANDIDATES).map((photo) => {
    const s = shown.get(photo.id);
    return { photo, shownCount: s?.count ?? 0, lastShownDate: s?.lastDate ?? null };
  });
}

// ---- Claude に渡すもの ----

type ImagePart = Extract<ClaudeContentPart, { type: "image" }>;
export type NarrationForEntrance = Pick<
  NarrationRow,
  "id" | "speakerMemberId" | "photoId" | "replyToId" | "kind" | "transcript" | "cleanedText" | "uncertainSpans" | "forDate" | "createdAt"
>;

export interface EntranceMaterial {
  receiverId: string;
  members: Pick<MemberRow, "id" | "role" | "relation" | "calledAs">[];
  candidates: {
    photo: Pick<PhotoRow, "id" | "ownerMemberId" | "takenAt">;
    /** 縮小済みの画像。null なら説明だけを渡す（出し比べだけ。本番では画像のない写真は候補から外す） */
    image: ImagePart | null;
    /** 写真の説明（Claude の推測） */
    guess: string | null;
    shownCount: number;
    lastShownDate: string | null;
  }[];
  /** 候補の写真の語り（並べ替えと字数の上限はここで行う） */
  narrations: NarrationForEntrance[];
  /**
   * entrance/v3（0046）: むすびと、その家族の写真の ID。あれば候補ごとに <same_event> を渡す。
   * 家族の写真でないもの・rejected の写真は外す（sameEventLinks）。なければ v2 と同じ入力
   */
  sameEvent?: { musubi: readonly MusubiForEntrance[]; familyPhotoIds: ReadonlySet<string> };
}

/** 受け取った後の検査に使う、渡したものの記録 */
export interface EntranceCheckContext {
  candidateIds: ReadonlySet<string>;
  /** 画像を渡した写真（focus を許す） */
  imagedIds: ReadonlySet<string>;
  /** 渡した語り。quotable は引用してよいか */
  narrations: ReadonlyMap<string, { narration: NarrationForEntrance; quotable: boolean }>;
  /** 写真ごとの、渡した語りの文字（引用不可のものも含む）。つながりの検査に使う（0046） */
  passedTexts: ReadonlyMap<string, readonly string[]>;
  /** <same_event> の with として渡した写真（候補でないものを含む） */
  linkedPhotoIds: ReadonlySet<string>;
}

export interface EntranceInput {
  content: ClaudeContentPart[];
  context: EntranceCheckContext;
  /** 渡した語りの ID（入り口と一緒に保存する） */
  inputNarrationIds: string[];
  /** <same_event> として渡したむすびの ID（entrance/v3。入り口と一緒に保存する） */
  inputMusubiIds: string[];
}

/** 渡す本文と、引用してよいか。文字がなければ null（渡さない） */
function narrationForPrompt(n: NarrationForEntrance): { text: string; quotable: boolean } | null {
  // 引用できる: 文字の語りと、使える整形のある声の語り（表示用の文字。印の範囲は「……」）
  if (quoteSource(n)) {
    const text = displayText(n);
    return text ? { text, quotable: true } : null;
  }
  // 未整形の声の語り: 文脈だけ
  return n.transcript && n.transcript.length > 0 ? { text: n.transcript, quotable: false } : null;
}

const takenDate = (takenAt: string | null) => (takenAt ? takenAt.slice(0, 10) : null);
const ROLE_LABEL: Record<MemberRow["role"], string> = { elder: "elder（祖父母の世代）", family: "family" };

/**
 * user の一通を組む。写真ごとに、説明の文字のすぐ後に画像を置く。
 * 渡さないもの: 緯度経度（あるかどうかも）、storageKey と URL、合言葉、語りの音声
 */
export function buildEntranceInput(m: EntranceMaterial): EntranceInput {
  const called = new Map(m.members.map((x) => [x.id, x.calledAs]));
  const candidateIds = new Set(m.candidates.map((c) => c.photo.id));

  // 語りは新しいものから、合わせて ENTRANCE_NARRATION_MAX_CHARS 字まで
  const usable = m.narrations
    .filter((n) => candidateIds.has(n.photoId))
    .map((n) => ({ n, p: narrationForPrompt(n) }))
    .filter((x): x is { n: NarrationForEntrance; p: { text: string; quotable: boolean } } => x.p !== null)
    .sort((a, b) => b.n.createdAt - a.n.createdAt || (a.n.id < b.n.id ? -1 : 1));
  const included = new Map<string, { narration: NarrationForEntrance; quotable: boolean; text: string }>();
  let chars = 0;
  for (const { n, p } of usable) {
    if (chars + p.text.length > ENTRANCE_NARRATION_MAX_CHARS) break;
    chars += p.text.length;
    included.set(n.id, { narration: n, quotable: p.quotable, text: p.text });
  }

  const receiver = m.members.find((x) => x.id === m.receiverId);
  const content: ClaudeContentPart[] = [];
  content.push({
    type: "text",
    text: [
      "<receiver>",
      `member_id: ${m.receiverId}`,
      `呼ばれ方: ${receiver?.calledAs ?? "分からない"}`,
      `続柄: ${receiver?.relation ?? "分からない"}`,
      `role: ${receiver ? ROLE_LABEL[receiver.role] : "分からない"}`,
      "</receiver>",
      "<family>",
      ...m.members.map((x) => `- member_id: ${x.id} / 呼ばれ方: ${x.calledAs} / 続柄: ${x.relation} / role: ${ROLE_LABEL[x.role]}`),
      "</family>",
      `<candidates count="${m.candidates.length}">`,
    ].join("\n"),
  });

  // 同じ出来事の推測（v3）。受け取る人自身が with の写真について最後に語った日も添える
  const links = m.sameEvent ? sameEventLinks(m.sameEvent.musubi, m.sameEvent.familyPhotoIds) : new Map<string, SameEventLink[]>();
  const receiverTalked = new Map<string, NarrationForEntrance>();
  for (const n of m.narrations) {
    if (n.speakerMemberId !== m.receiverId) continue;
    const prev = receiverTalked.get(n.photoId);
    if (!prev || n.createdAt > prev.createdAt) receiverTalked.set(n.photoId, n);
  }
  const musubiIds = new Set<string>();
  const linkedPhotoIds = new Set<string>();

  const imagedIds = new Set<string>();
  for (const c of m.candidates) {
    const lines = [
      `<photo photo_id="${c.photo.id}">`,
      `持ち主: ${called.get(c.photo.ownerMemberId) ?? "分からない"}`,
      `撮影日: ${takenDate(c.photo.takenAt) ?? "分からない"}`,
      `この人の入り口に出した回数: ${c.shownCount}${c.lastShownDate ? `（最後は ${c.lastShownDate}）` : ""}`,
      `画像: ${c.image ? "この後に添付" : "なし（説明だけ）"}`,
    ];
    if (c.guess) lines.push("<guess>", c.guess, "</guess>");
    const ns = [...included.values()]
      .filter((x) => x.narration.photoId === c.photo.id)
      .sort((a, b) => a.narration.createdAt - b.narration.createdAt || (a.narration.id < b.narration.id ? -1 : 1));
    if (ns.length === 0) lines.push("語り: まだない");
    for (const x of ns) {
      const n = x.narration;
      const attrs = [
        `narration_id="${n.id}"`,
        `speaker="${called.get(n.speakerMemberId) ?? "分からない"}"`,
        ...(n.speakerMemberId === m.receiverId ? [`by_receiver="yes"`] : []),
        `date="${n.forDate}"`,
        `quotable="${x.quotable ? "yes" : "no"}"`,
        ...(n.replyToId && included.has(n.replyToId) ? [`reply_to="${n.replyToId}"`] : []),
      ];
      lines.push(`<narration ${attrs.join(" ")}>`, x.text, "</narration>");
    }
    for (const l of links.get(c.photo.id) ?? []) {
      const talked = receiverTalked.get(l.withPhotoId);
      lines.push(`<same_event with="${l.withPhotoId}" status="${l.status}"${talked ? ` receiver_talked="${talked.forDate}"` : ""}/>`);
      musubiIds.add(l.musubiId);
      linkedPhotoIds.add(l.withPhotoId);
    }
    lines.push("</photo>");
    content.push({ type: "text", text: lines.join("\n") });
    if (c.image) {
      content.push(c.image);
      imagedIds.add(c.photo.id);
    }
  }
  content.push({ type: "text", text: "</candidates>" });

  const passedTexts = new Map<string, string[]>();
  for (const x of included.values()) {
    const list = passedTexts.get(x.narration.photoId) ?? [];
    list.push(x.text);
    passedTexts.set(x.narration.photoId, list);
  }

  return {
    content,
    context: {
      candidateIds,
      imagedIds,
      narrations: new Map([...included].map(([id, x]) => [id, { narration: x.narration, quotable: x.quotable }])),
      passedTexts,
      linkedPhotoIds,
    },
    inputNarrationIds: [...included.keys()],
    inputMusubiIds: [...musubiIds],
  };
}

// ---- 受け取った後の検査 ----

const EMOJI = /\p{Extended_Pictographic}/u;
/** 文の終わりの印（問いかけの末尾を除いて、これがあれば二文以上） */
const SENTENCE_END = /[。．.？?！!\n]/;

/** 問いかけの前後の空白と、末尾の句点一つを落とす（「ください。」で再試行しない。0023）。保存もこの形 */
export function normalizeQuestion(question: string): string {
  const q = question.trim();
  return q.endsWith("。") ? q.slice(0, -1).trimEnd() : q;
}

/** 問いかけの検査。違反の種類だけを返す（本文は返さない） */
export function checkEntranceQuestion(question: string): string | null {
  const q = normalizeQuestion(question);
  if (q.length === 0) return "question_empty";
  if (exceedsChars(q, QUESTION_MAX_CHARS)) return "question_too_long";
  const ending = ENTRANCE_QUESTION_ENDINGS.find((e) => q.endsWith(e));
  if (!ending) return "question_ending";
  if (SENTENCE_END.test(q.slice(0, q.length - ending.length))) return "question_not_one_sentence";
  const normalized = q.normalize("NFKC").toUpperCase();
  if (ENTRANCE_QUESTION_FORBIDDEN.some((w) => normalized.includes(w.normalize("NFKC").toUpperCase()))) return "question_forbidden";
  if (EMOJI.test(q)) return "question_forbidden";
  if (ENTRANCE_QUESTION_FORBIDDEN_OPENERS.some((w) => q.startsWith(w))) return "question_forbidden";
  if (findTestingPhrase(q)) return "question_testing";
  return null;
}

/** 受け取った入り口の検査（全か無か）。違反の種類だけを返す。問題なければ null */
export function checkEntrance(v: EntranceOutput, ctx: EntranceCheckContext): string | null {
  if (!ctx.candidateIds.has(v.photo_id)) return "photo_not_candidate";

  if (v.focus) {
    if (!ctx.imagedIds.has(v.photo_id)) return "focus_without_image";
    const { x, y, w, h } = v.focus;
    if (![x, y, w, h].every(Number.isFinite)) return "focus_range";
    if (x < 0 || y < 0 || x + w > 1 + FOCUS_EPSILON || y + h > 1 + FOCUS_EPSILON) return "focus_range";
    if (w < ENTRANCE_FOCUS_MIN || h < ENTRANCE_FOCUS_MIN) return "focus_too_small";
  }

  if (v.quote) {
    const entry = ctx.narrations.get(v.quote.narration_id);
    if (!entry) return "quote_unknown_narration";
    if (entry.narration.photoId !== v.photo_id) return "quote_other_photo";
    if (!entry.quotable) return "quote_not_citable";
    if (v.quote.text.trim().length === 0) return "quote_empty";
    if (exceedsChars(v.quote.text, ENTRANCE_QUOTE_MAX_CHARS)) return "quote_too_long";
    const at = locateQuote(entry.narration, v.quote.text);
    if (!at.ok) return `quote_${at.violation}`;
  }

  const qv = checkEntranceQuestion(v.question);
  if (qv) return qv;

  if (v.reason.trim().length === 0) return "reason_empty";
  if (exceedsChars(v.reason, ENTRANCE_REASON_MAX_CHARS)) return "reason_too_long";
  return null;
}

/** 照合のための表記そろえ（NFKC、空白を除く） */
const fold = (t: string) =>
  t
    .normalize("NFKC")
    .replace(/\s+/g, "")
    // カタカナをひらがなに、英字を大文字に（「アジサイ」と「あじさい」、「disney」と「Disney」を同じに数える）
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toUpperCase();

/**
 * entrance/v3 の、むすびに関わる問いかけの検査（0046）。違反の種類だけを返す
 * - question_asserts_link: つながり・順序の語（ENTRANCE_LINK_WORDS）が、選んだ写真の渡した語りのどれにもないのに問いかけにある
 * - question_other_photo_words: 渡した写真（候補と same_event の相手）のうち、選んだ写真以外の写真の told の記録の値（2 字以上）が
 *   問いかけにあり、選んだ写真の渡した語りにはない
 */
export function checkEntranceLinks(
  question: string,
  photoId: string,
  ctx: Pick<EntranceCheckContext, "passedTexts" | "candidateIds" | "linkedPhotoIds">,
  records: readonly Pick<RecordRow, "photoId" | "value" | "origin">[],
): string | null {
  const q = fold(normalizeQuestion(question));
  const own = (ctx.passedTexts.get(photoId) ?? []).map(fold);
  const inOwn = (w: string) => own.some((t) => t.includes(w));
  if (ENTRANCE_LINK_WORDS.some((w) => q.includes(fold(w)) && !inOwn(fold(w)))) return "question_asserts_link";
  for (const r of records) {
    if (r.origin !== "told" || !r.photoId || r.photoId === photoId) continue;
    if (!ctx.candidateIds.has(r.photoId) && !ctx.linkedPhotoIds.has(r.photoId)) continue;
    const v = fold(r.value);
    if (charCount(v) < ENTRANCE_OTHER_RECORD_MIN_CHARS) continue;
    if (q.includes(v) && !inOwn(v)) return "question_other_photo_words";
  }
  return null;
}

/** entrance/v3 の検査（全か無か）: v2 の検査に、つながりの検査を足す */
export function checkEntranceV3(
  v: EntranceOutputV3,
  ctx: EntranceCheckContext,
  records: readonly Pick<RecordRow, "photoId" | "value" | "origin">[],
): string | null {
  return checkEntrance(v, ctx) ?? checkEntranceLinks(v.question, v.photo_id, ctx, records);
}

// ---- 作る ----

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function loadImage(deps: Pick<AppDeps, "photos">, photo: PhotoRow): Promise<ImagePart | null> {
  const obj = await deps.photos.get(photo.storageKey);
  if (!obj) return null;
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const base64 = bytesToBase64(bytes);
  if (base64.length > ENTRANCE_MAX_IMAGE_BASE64_CHARS) return null;
  const mediaType = (IMAGE_TYPES.has(obj.contentType) ? obj.contentType : "image/jpeg") as ImagePart["mediaType"];
  return { type: "image", mediaType, base64 };
}

/** ログに出すエラーの種類。Error の名前だけ（メッセージは出さない）。名前が識別子の形でなければ "Error"、Error でなければ typeof */
function errorName(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(err.name) ? err.name : "Error";
}

/** Claude の入り口が作れなかった理由（ログに出す種類） */
export type EntranceClaudeFailure = ClaudeFailure | "no_candidates" | "no_images" | "past_deadline" | "same_event_unavailable";

export type MakeClaudeEntranceResult =
  | { ok: true; row: NewClaudeEntrance }
  | { ok: false; reason: EntranceClaudeFailure; violation?: string; inputTokens: number; outputTokens: number };

/** Claude で入り口を一つ作る（保存はしない）。投げるのはデータベースや保存先の失敗だけ */
export async function makeClaudeEntrance(
  deps: Pick<AppDeps, "repos" | "photos" | "claude">,
  family: Pick<FamilyRow, "id">,
  member: Pick<MemberRow, "id">,
  forDate: string,
  now: number,
  traceId?: string,
  version: EntranceVersion = ENTRANCE_VERSION,
): Promise<MakeClaudeEntranceResult> {
  const { repos } = deps;
  const v3 = version === "v3";
  const none = (reason: EntranceClaudeFailure): MakeClaudeEntranceResult => ({ ok: false, reason, inputTokens: 0, outputTokens: 0 });
  // むすびと記録は v3 だけが使う（v2 では読まない）。読めなければ v3 の検査ができないので Claude を呼ばず、固定の入り口に倒す
  // （むすびの読み出しが落ちても毎朝の処理は続け、全員に入り口を出す。0044）
  // 落ちたときは、どちらの読み出しか（musubi / records）とエラーの名前だけを残す（メッセージは入力値を含みうるので出さない）。
  // morning_done の fallbacks の same_event_unavailable と、処理の ID で突き合わせる
  let sameEventReadFailed = false;
  const readForV3 = <T>(which: "musubi" | "records", read: () => Promise<T[]>): Promise<T[]> =>
    v3
      ? Promise.resolve()
          .then(read)
          .catch((err: unknown) => {
            sameEventReadFailed = true;
            console.log(
              JSON.stringify({
                event: "entrance_same_event_read_failed",
                traceId: traceId ?? null,
                familyId: family.id,
                memberId: member.id,
                forDate,
                read: which,
                errorType: errorName(err),
              }),
            );
            return [];
          })
      : Promise.resolve([]);
  const [photos, past, narrations, members, guesses, today, musubi, records] = await Promise.all([
    repos.photos.list(family.id),
    repos.entrances.listByMember(family.id, member.id),
    repos.narrations.listAll(family.id),
    repos.members.list(family.id),
    repos.photoGuesses.listByFamily(family.id),
    repos.entrances.listByDate(family.id, forDate),
    readForV3("musubi", () => repos.musubi.listByFamily(family.id)),
    readForV3("records", () => repos.records.listByFamily(family.id)),
  ]);
  if (sameEventReadFailed) return none("same_event_unavailable");
  // 今日すでにほかの人の入り口に出した写真（毎朝の処理は一人ずつ順なので、先に作った人の分。0042）
  const usedToday = new Set(today.filter((e) => e.memberId !== member.id).map((e) => e.photoId));
  const picked = pickEntranceCandidates(photos, narrations, past, member.id, forDate, usedToday, musubi);
  if (picked.length === 0) return none("no_candidates");

  // 新しい説明を使う（listByFamily は古い順）
  const guessOf = new Map<string, string>();
  for (const g of guesses) guessOf.set(g.photoId, g.description);

  const candidates: EntranceMaterial["candidates"] = [];
  for (const c of picked) {
    // 画像が読めない写真は候補から外す（画面にも出せない）
    const image = await loadImage(deps, c.photo);
    if (!image) continue;
    candidates.push({ photo: c.photo, image, guess: guessOf.get(c.photo.id) ?? null, shownCount: c.shownCount, lastShownDate: c.lastShownDate });
  }
  if (candidates.length === 0) return none("no_images");

  const input = buildEntranceInput({
    receiverId: member.id,
    members,
    candidates,
    narrations,
    ...(v3 ? { sameEvent: { musubi, familyPhotoIds: new Set(photos.map((p) => p.id)) } } : {}),
  });
  const prompt = ENTRANCE_PROMPTS[version];
  const trace = traceId ? { traceId } : {};
  const r: ClaudeCallResult<EntranceOutput | EntranceOutputV3> = v3
    ? await deps.claude.call({ prompt, content: input.content, schema: entranceSchemaV3, check: (v) => checkEntranceV3(v, input.context, records), ...trace })
    : await deps.claude.call({ prompt, content: input.content, schema: entranceSchema, check: (v) => checkEntrance(v, input.context), ...trace });
  if (!r.ok) {
    return { ok: false, reason: r.reason, ...(r.violation ? { violation: r.violation } : {}), inputTokens: r.meta.inputTokens, outputTokens: r.meta.outputTokens };
  }
  const v = r.value;
  let quote: { narrationId: string; start: number; end: number } | null = null;
  if (v.quote) {
    const entry = input.context.narrations.get(v.quote.narration_id)!;
    const at = locateQuote(entry.narration, v.quote.text);
    // check を通ったので見つかるはず。見つからなければ使わない（全か無か）
    if (!at.ok) return { ok: false, reason: "check_failed", violation: `quote_${at.violation}`, inputTokens: r.meta.inputTokens, outputTokens: r.meta.outputTokens };
    quote = { narrationId: v.quote.narration_id, start: at.start, end: at.end };
  }
  return {
    ok: true,
    row: {
      id: crypto.randomUUID(),
      familyId: family.id,
      memberId: member.id,
      forDate,
      photoId: v.photo_id,
      focus: v.focus,
      quoteNarrationId: quote?.narrationId ?? null,
      quoteStart: quote?.start ?? null,
      quoteEnd: quote?.end ?? null,
      question: normalizeQuestion(v.question),
      reason: v.reason,
      model: r.meta.model,
      promptVersion: prompt.version,
      inputNarrationIds: input.inputNarrationIds,
      inputTokens: r.meta.inputTokens,
      outputTokens: r.meta.outputTokens,
      ...(v3 ? { inputMusubiIds: input.inputMusubiIds, receiverPresent: (v as EntranceOutputV3).receiver_present } : {}),
      createdAt: now,
    },
  };
}

export type MorningEntranceResult = {
  result: EnsureResult;
  /** claude: Claude の入り口を作った。fixed: 固定の入り口に倒した。existing: すでにあった */
  via: "claude" | "fixed" | "existing";
  /** 固定に倒した理由の種類 */
  fallback?: EntranceClaudeFailure;
  violation?: string;
};

/**
 * 毎朝の処理の一人分。その日の入り口があればそれを返す。なければ Claude の入り口を試し、だめなら固定の入り口。
 * Claude を使わないとき: キーがない、時間の予算を過ぎた（useClaude = false）
 * 家族には失敗を知らせない。ログは ID と種類と数だけ
 */
export async function ensureMorningEntrance(
  deps: Pick<AppDeps, "repos" | "photos" | "claude">,
  family: Pick<FamilyRow, "id">,
  member: Pick<MemberRow, "id">,
  forDate: string,
  now: number,
  opts: { useClaude: boolean; traceId?: string; version?: EntranceVersion },
): Promise<MorningEntranceResult> {
  const version = opts.version ?? ENTRANCE_VERSION;
  const existing = await deps.repos.entrances.get(family.id, member.id, forDate);
  if (existing) return { result: { entrance: existing, created: false }, via: "existing" };

  let fallback: EntranceClaudeFailure;
  let violation: string | undefined;
  if (deps.claude === notConfiguredClaude) fallback = "not_configured";
  else if (!opts.useClaude) fallback = "past_deadline";
  else {
    const made = await makeClaudeEntrance(deps, family, member, forDate, now, opts.traceId, version);
    console.log(
      JSON.stringify({
        event: "entrance_claude",
        traceId: opts.traceId ?? null,
        familyId: family.id,
        memberId: member.id,
        forDate,
        ok: made.ok,
        promptVersion: ENTRANCE_PROMPTS[version].version,
        ...(made.ok
          ? { entranceId: made.row.id, photoId: made.row.photoId, model: made.row.model, inputTokens: made.row.inputTokens, outputTokens: made.row.outputTokens }
          : { reason: made.reason, ...(made.violation ? { violation: made.violation } : {}), inputTokens: made.inputTokens, outputTokens: made.outputTokens }),
      }),
    );
    if (made.ok) {
      const inserted = await deps.repos.entrances.insertClaudeIfAbsent(made.row);
      const entrance = await deps.repos.entrances.get(family.id, member.id, forDate);
      if (!entrance) throw new Error("entrance_missing_after_insert");
      return { result: { entrance, created: inserted }, via: inserted ? "claude" : "existing" };
    }
    fallback = made.reason;
    violation = made.violation;
  }
  const result = await ensureFixedEntrance(deps, family, member, forDate, now);
  return { result, via: result && !result.created ? "existing" : "fixed", fallback, ...(violation ? { violation } : {}) };
}
