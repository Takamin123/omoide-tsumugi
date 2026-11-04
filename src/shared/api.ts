// クライアントとサーバーの約束（API の形）。両方がこのファイルの zod スキーマと型を使う。
// サーバーは日本語の文を返さない。エラーは { error: ErrorKind } の種類だけを返し、文はクライアントが持つ。
import { z } from "zod";

// ---- 共通 ----

export const errorKinds = [
  "unauthorized", // 合言葉がない・無効（401）
  "forbidden", // 合言葉は有効だが、この端末の人にはできない（403。cookie はそのまま。0036）
  "not_found", // ない、またはほかの家族のもの（404）
  "invalid_request", // 検証に失敗（400）。受け取った値は返さない
  "duplicate", // 同じものがすでにある（409。写真は 200 で duplicate: true を返すので使わない）
  "not_demo", // デモの家族ではない（404 と同じ扱いでよいが、種類は分ける）
  "demo_seed_mismatch", // デモの初期化: 家族の人の呼ばれ方と役が種と合わない（409。何も変えていない。0038）
  "demo_seed_missing", // デモの初期化: 種の写真・録音が置かれていない（409。何も変えていない。0038）
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
  /** その人のリンクが今使える（作ってあり、作り直されていない）か。0036 */
  hasLink: boolean;
};

export type FamilyView = {
  // clock は時計を持たない家族では今の日本時間から作る。
  // canAdvanceClock: デモの時計を進められるか（本番ではデモの家族だけ、手元・プレビューではどの家族も）
  family: { id: string; isDemo: boolean; clock: Clock; canAdvanceClock: boolean };
  members: Member[];
  /**
   * この端末の人（リンクが指す人）。null は「最初の人のリンク」で開いた端末で、まだ誰も入っていない家族。
   * このときできるのは GET /api/family と、最初の一人を入れる POST /api/members だけ（ほかは 403 forbidden）。0036
   */
  me: Member | null;
};

/**
 * POST /api/families（Authorization: Bearer <CREATE_FAMILY_TOKEN>）
 * 家族の場を作り、「最初の人のリンク」の合言葉を返す。cookie も付ける。
 * このリンクは一度きりで、最初の一人が自分を入れた（POST /api/members）時点で使えなくなる。0036
 */
export const createFamilyInputSchema = z.object({ isDemo: z.boolean().default(false) });
export type CreateFamilyResult = { familyId: string; token: string };

/** POST /api/session { token } → 204 と cookie。無効なら 401。リンクを開いた端末は、そのリンクの人になる */
export const sessionInputSchema = z.object({ token: z.string().min(20).max(100) });

/**
 * POST /api/members/:id/link → { token }。その人のリンクを作る（作り直す）。0036
 * - できるのは role = family の人だけ（ほかは 403 forbidden）。対象がその家族にいなければ 404
 * - その人の前のリンクだけが使えなくなる。ほかの人のリンクはそのまま
 * - 対象が自分なら、この端末の cookie も新しいものに替わる
 */
export type MemberLinkResult = { token: string };

// GET  /api/family → FamilyView
// POST /api/members（memberInputSchema）→ 201 Member
//   - 最初の人のリンクの端末（me が null）: 家族に人が一人もいないときだけ（いれば 403 forbidden）。role は family だけ（elder は 400）。
//     setUpByMemberId は null。入れたら、その人のリンクを作り、新しい合言葉を cookie に置く（本文には返さない）。最初の人のリンクは使えなくなる
//   - それ以外: role = family の人だけ（ほかは 403 forbidden）
// PATCH /api/members/:id（memberInputSchema）→ Member
//   - role = family の人だけ（ほかは 403 forbidden）。自分の role は変えられない（403 forbidden）。ほかの欄は自分でも直せる

// ---- 写真 ----

/**
 * POST /api/photos（multipart/form-data）
 *   file: 縮小した JPEG
 *   meta: JSON 文字列（photoMetaSchema）
 * → 201 { photo, duplicate: false, link } / 200 { photo, duplicate: true, link }（同じ持ち主・同じ content_hash）
 * 持ち主は、この端末の人（cookie のリンクの人）
 * meta.withPhotoId があれば「この写真に追加する」（0048）: 写真の登録と、withPhotoId の写真との家族の手のむすび
 * （created_by = family、両方 confirmed、決めた人 = この端末の人）への入れ込みを一つの batch で行う。
 * withPhotoId がこの家族の写真でなければ 404 not_found で、写真を保存しない。重複の写真でもつながりは作る。
 */
export const photoMetaSchema = z.object({
  // 持ち主は、この端末の人（cookie のリンクの人）。クライアントからは送らない。0036
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
  // 「この写真に追加する」のつなぐ先の写真（0048）。省けば今までどおり棚に入れるだけ
  withPhotoId: z.string().min(1).optional(),
});
export type PhotoMeta = z.infer<typeof photoMetaSchema>;

export type Photo = {
  id: string;
  ownerMemberId: string;
  width: number;
  height: number;
  takenAt: string | null;
  hasLocation: boolean; // 緯度経度そのものはクライアントに返さない
  /**
   * 写真の位置から引いた市区町村の名前（「三重県伊勢市」）。画面では「あたり」を付けて出す。
   * 位置がない、日本の外、近くに市区町村の代表点がないときは null。サーバーが一覧から引く（外のサービスは使わない）。0047
   */
  place: string | null;
  imageUrl: string; // /api/photos/:id/image（合言葉を確かめてから返す。Cache-Control: private, no-store）
};
/**
 * 「この写真に追加する」でつないだ結果（0048）。withPhotoId がなければ null。
 * 送った写真が withPhotoId の写真そのもの（同じ持ち主・同じ content_hash の重複）のときも、つながないので null。
 * linked: 今回新しくつないだか（既に同じ家族のむすびにいたら false）。musubiId: 入れた家族のむすび（「はずす」に使う）
 */
export type PhotoLink = { musubiId: string; linked: boolean };
export type UploadPhotoResult = { photo: Photo; duplicate: boolean; link: PhotoLink | null };

/** 「この写真に追加する」で一度に送れる枚数の上限（0048。クライアントで確かめる） */
export const MAX_ADD_TO_PHOTO = 10;

// DELETE /api/musubi/:musubiId/photos/:photoId → 204（「はずす」。0048）
//   家族の手のむすび（created_by = family）の、この端末の人が決めた行だけ消せる。それ以外・ほかの家族・ないものは 404 not_found。
//   写真そのものは消さない

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
    // 話した人は、この端末の人（cookie のリンクの人）。クライアントからは送らない。0036
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
// GET /api/feed → { items: { photo: Photo; narrations: FeedNarration[]; addedPhotos: Photo[] }[] }
//   addedPhotos: その写真と同じ家族の手のむすび（created_by = family）にいる、confirmed のほかの写真（0048）。古く足した順。
//   機械の推測のむすび（guessed）は一切出さない（新しい語りのある写真から順）

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

// GET /api/entrances/today → { entrance: Entrance | null }（この端末の人の入り口）
//   なければその場で固定の入り口を作って保存する（Claude は呼ばない）。写真が一枚もなければ null
// GET /api/entrances/:id/question-audio → 問いかけの読み上げの音声（ないもの、ほかの家族のものは 404）

// ---- デモ ----

/**
 * POST /api/demo/clock/advance → { clock }。朝→昼→夜→翌朝。翌朝になったら毎朝の処理と同じ関数を呼ぶ。
 * 使えるのは FamilyView.family.canAdvanceClock が真の家族だけ。ほかは 404 { error: "not_demo" }
 */
export type AdvanceClockResult = { clock: Clock };

/**
 * POST /api/demo/families/:familyId/reset（Authorization: Bearer <DEMO_RESET_TOKEN>）。0038
 * デモの家族（is_demo）を、種の写真・語り・入り口の状態に戻し、最後に毎朝の処理と同じ関数を呼ぶ。返すのは ID と件数だけ。
 * 家族がない・デモでない → 404 not_found。人が種と合わない → 409 demo_seed_mismatch。素材がない → 409 demo_seed_missing（どれも何も変えない）
 */
export type DemoResetResult = {
  familyId: string;
  /** 戻した「今日」（日本時間）。時計はこの日の朝 */
  asOfDate: string;
  deleted: { rows: Record<string, number>; files: number };
  inserted: { photos: number; narrations: number; entrances: number; files: number };
  /** 毎朝の処理の結果（ID と件数だけ）。全員が失敗したときは null */
  morning: {
    runId: string;
    created: number;
    existing: number;
    byClaude: number;
    fallbacks: { memberId: string; reason: string; violation?: string }[];
    noPhoto: number;
    failed: { memberId: string; kind: string }[];
    speech: { made: number; failed: { memberId: string; reason: string }[] };
  } | null;
};
