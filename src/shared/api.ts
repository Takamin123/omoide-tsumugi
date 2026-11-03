// クライアントとサーバーの約束（API の形）。両方がこのファイルの zod スキーマと型を使う。
// サーバーは日本語の文を返さない。エラーは { error: ErrorKind } の種類だけを返し、文はクライアントが持つ。
import { z } from "zod";

// ---- 共通 ----

export const errorKinds = [
  "unauthorized", // 合言葉がない・無効（401）
  "not_found", // ない、またはほかの家族のもの（404）
  "invalid_request", // 検証に失敗（400）。受け取った値は返さない
  "duplicate", // 同じものがすでにある（409。写真は 200 で duplicate: true を返すので使わない）
  "not_demo", // デモの家族ではない（404 と同じ扱いでよいが、種類は分ける）
  "too_large", // 413
  "internal", // 500
] as const;
export const errorKindSchema = z.enum(errorKinds);
export type ErrorKind = z.infer<typeof errorKindSchema>;
export type ErrorBody = { error: ErrorKind };

/** 日本時間の日付 YYYY-MM-DD */
export const jstDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const timeSlotSchema = z.enum(["morning", "noon", "night"]);
export type TimeSlot = z.infer<typeof timeSlotSchema>;
export const clockSchema = z.object({ date: jstDateSchema, slot: timeSlotSchema });
export type Clock = z.infer<typeof clockSchema>;

// ---- 家族と一人ひとり ----

export const memberRoleSchema = z.enum(["elder", "family"]);
export const speechStyleSchema = z.enum(["standard", "dialect"]);

export const memberInputSchema = z
  .object({
    role: memberRoleSchema,
    relation: z.string().trim().min(1).max(20), // 続柄（祖母、母、孫）
    calledAs: z.string().trim().min(1).max(20), // 家族からの呼ばれ方（ばあば）
    speechStyle: speechStyleSchema,
    dialectRegion: z.string().trim().min(1).max(20).nullable(), // 方言の地域（鹿児島）
    setUpByMemberId: z.string().nullable(), // 代わりに設定を入れた人
  })
  .refine((m) => (m.speechStyle === "dialect") === (m.dialectRegion !== null), {
    path: ["dialectRegion"],
  });
export type MemberInput = z.infer<typeof memberInputSchema>;

export type Member = {
  id: string;
  role: z.infer<typeof memberRoleSchema>;
  relation: string;
  calledAs: string;
  speechStyle: z.infer<typeof speechStyleSchema>;
  dialectRegion: string | null;
  setUpByMemberId: string | null;
};

export type FamilyView = {
  // clock は時計を持たない家族では今の日本時間から作る。
  // canAdvanceClock: デモの時計を進められるか（本番ではデモの家族だけ、手元・プレビューではどの家族も）
  family: { id: string; isDemo: boolean; clock: Clock; canAdvanceClock: boolean };
  members: Member[];
};

/**
 * POST /api/families（Authorization: Bearer <CREATE_FAMILY_TOKEN>）
 * 家族の場を作り、招待の合言葉を返す。cookie も付ける。
 */
export const createFamilyInputSchema = z.object({ isDemo: z.boolean().default(false) });
export type CreateFamilyResult = { familyId: string; token: string };

/** POST /api/session { token } → 204 と cookie。無効なら 401 */
export const sessionInputSchema = z.object({ token: z.string().min(20).max(100) });

/** POST /api/invite/regenerate → { token }。古い合言葉は無効になり、cookie は新しいものに替わる */
export type RegenerateInviteResult = { token: string };

// GET  /api/family → FamilyView
// POST /api/members（memberInputSchema）→ Member
// PATCH /api/members/:id（memberInputSchema）→ Member

// ---- 写真 ----

/**
 * POST /api/photos（multipart/form-data）
 *   file: 縮小した JPEG
 *   meta: JSON 文字列（photoMetaSchema）
 * → 201 { photo, duplicate: false } / 200 { photo, duplicate: true }（同じ持ち主・同じ content_hash）
 */
export const photoMetaSchema = z.object({
  ownerMemberId: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/), // 縮小の前の元ファイルの SHA-256
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  takenAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    .nullable(), // EXIF の撮影日時（日本時間とみなす）
  // ブラウザで小数第 2 位（約 1 km）に丸めた値。生の値は送らない。サーバーも丸めを確かめる
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});
export type PhotoMeta = z.infer<typeof photoMetaSchema>;

export type Photo = {
  id: string;
  ownerMemberId: string;
  width: number;
  height: number;
  takenAt: string | null;
  hasLocation: boolean; // 緯度経度そのものはクライアントに返さない
  imageUrl: string; // /api/photos/:id/image（合言葉を確かめてから返す。Cache-Control: private, no-store）
};
export type UploadPhotoResult = { photo: Photo; duplicate: boolean };

// GET /api/photos?ownerMemberId= → { photos: Photo[] }

// ---- 語り ----

/** 語りの録音の長さとして受け取る上限（1 時間）。これを超える値は測り違いとして送らない */
export const MAX_VOICE_DURATION_MS = 60 * 60_000;

/**
 * POST /api/narrations（multipart/form-data）
 *   meta: JSON 文字列（narrationMetaSchema）
 *   audio: 録音（kind = voice のとき）。マイクの録音も、デモで送る録音済みファイルも同じ入り口を通る
 * → 202 { narration }（文字起こしと整形は返した後に背景で行う）
 */
export const narrationMetaSchema = z
  .object({
    kind: z.enum(["voice", "text"]),
    speakerMemberId: z.string(),
    photoId: z.string(),
    entranceId: z.string().nullable(),
    replyToId: z.string().nullable(), // 家族同士のやり取りで、どの語りへの返事か
    text: z.string().trim().min(1).max(2000).nullable(), // kind = text のとき
    // 語り一つごとにクライアントが作る UUID。同じ requestId の再送には、作ってある語りを 202 で返す
    requestId: z.uuid().optional(),
    // 録音の長さ（ミリ秒）。クライアントが測る。測れなければ null か省く。画面の「（13 秒）」にだけ使う
    durationMs: z.number().int().min(0).max(MAX_VOICE_DURATION_MS).nullable().optional(),
  })
  .refine((n) => (n.kind === "text") === (n.text !== null), { path: ["text"] });
export type NarrationMeta = z.infer<typeof narrationMetaSchema>;

export type Narration = {
  id: string;
  speakerMemberId: string;
  photoId: string;
  entranceId: string | null;
  replyToId: string | null;
  kind: "voice" | "text";
  audioUrl: string | null; // /api/narrations/:id/audio
  /** 録音の長さ（ミリ秒）。分からなければ null */
  durationMs: number | null;
  transcriptStatus: "pending" | "done" | "failed";
  /** 画面に出す文字。整えた文字があればそれ、なければ文字起こし。どちらもなければ null */
  text: string | null;
  forDate: string;
  createdAt: number;
};

/**
 * 入り口への答えの語りの「元の言葉」（その入り口に添えた家族の言葉）。/api/feed だけが付ける（0035）。
 * text は引用そのもの（「……」の置き換え済み）。長すぎる（80 字を超える）ときは null で、画面は呼ばれ方だけを出す。
 * 入り口の種類や理由などの記録は載せない
 */
export type QuotedFrom = { narrationId: string; speakerMemberId: string; text: string | null };
export type FeedNarration = Narration & { quotedFrom: QuotedFrom | null };

// GET /api/narrations?photoId= → { narrations: Narration[] }
// GET /api/feed → { items: { photo: Photo; narrations: FeedNarration[] }[] }（新しい語りのある写真から順）

// ---- 入り口 ----

export type Entrance = {
  id: string;
  memberId: string;
  forDate: string;
  photo: Photo;
  focus: { x: number; y: number; w: number; h: number } | null;
  /**
   * 添える家族の言葉。本文はサーバーが語りから引く。
   * 元の語りが声なら audioUrl（語り全体の録音。/api/narrations/:id/audio）と durationMs、文字なら両方 null（0015）
   */
  quote: {
    narrationId: string;
    speakerMemberId: string;
    text: string;
    audioUrl: string | null;
    durationMs: number | null;
  } | null;
  /** Claude の問いかけ。null のときクライアントの固定の一文を出す */
  question: string | null;
  /**
   * 問いかけの読み上げの音声（/api/entrances/:id/question-audio。合言葉を確かめてから返す。Cache-Control: private, no-store）。
   * 音声があるときだけ文字列。押して聞く（自動では流さない）。そばに「AI の声で読みます」を出す（0019）
   */
  questionAudioUrl?: string | null;
};

// GET /api/entrances/today?memberId= → { entrance: Entrance | null }
//   なければその場で固定の入り口を作って保存する（Claude は呼ばない）。写真が一枚もなければ null
// GET /api/entrances/:id/question-audio → 問いかけの読み上げの音声（ないもの、ほかの家族のものは 404）

// ---- デモ ----

/**
 * POST /api/demo/clock/advance → { clock }。朝→昼→夜→翌朝。翌朝になったら毎朝の処理と同じ関数を呼ぶ。
 * 使えるのは FamilyView.family.canAdvanceClock が真の家族だけ。ほかは 404 { error: "not_demo" }
 */
export type AdvanceClockResult = { clock: Clock };
