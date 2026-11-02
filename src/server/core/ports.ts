// アプリが外の世界に頼るもののインターフェース。
// ハンドラと core はこれだけを見る。D1・R2（Workers）でも、better-sqlite3・ローカルのファイル（VPS）でも実装できる形にする。
// 理由は docs/decisions/0002-cloudflare-workers.md
import type { z } from "zod";
import type { Clock } from "../../shared/api";

/** 写真と録音の保存先。非公開で持つ。返すのは、合言葉を確かめた後だけ。 */
export interface PhotoStore {
  /**
   * 大きなファイルをメモリに載せないよう、ReadableStream や Blob（File）のまま渡せる形にする。
   * R2 は長さの分からない ReadableStream を受けないので、multipart で受けたものは File のまま渡す。
   */
  put(key: string, body: ReadableStream | Blob | ArrayBuffer | Uint8Array, meta: StoredObjectMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export interface StoredObjectMeta {
  contentType: string;
}

export interface StoredObject extends StoredObjectMeta {
  body: ReadableStream;
  size: number;
}

// ---- データベースの行（中心が扱う形） ----

export interface FamilyRow {
  id: string;
  name: string | null;
  isDemo: boolean;
  clock: Clock | null; // null なら本当の日本時間で動く
  createdAt: number;
}

export interface MemberRow {
  id: string;
  familyId: string;
  role: "elder" | "family";
  relation: string;
  calledAs: string;
  speechStyle: "standard" | "dialect";
  dialectRegion: string | null;
  setUpByMemberId: string | null;
  createdAt: number;
}
export type MemberFields = Omit<MemberRow, "id" | "familyId" | "createdAt">;

export interface PhotoRow {
  id: string;
  familyId: string;
  ownerMemberId: string;
  storageKey: string;
  contentHash: string;
  width: number;
  height: number;
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: number;
}

export type TranscriptStatus = "pending" | "done" | "failed";

export interface NarrationRow {
  id: string;
  familyId: string;
  speakerMemberId: string;
  photoId: string;
  entranceId: string | null;
  replyToId: string | null;
  requestId: string | null;
  kind: "voice" | "text";
  audioKey: string | null;
  audioContentType: string | null;
  durationMs: number | null;
  /** 家族が語ったそのまま（文字起こし、または打った文字） */
  transcript: string | null;
  transcriptStatus: TranscriptStatus;
  /** Claude が整えた文字（推測の側）。今日はまだ作らない */
  cleanedText: string | null;
  forDate: string;
  createdAt: number;
}
export type NewNarration = Omit<NarrationRow, "cleanedText">;

export interface EntranceRow {
  id: string;
  familyId: string;
  memberId: string;
  forDate: string;
  photoId: string;
  focus: { x: number; y: number; w: number; h: number } | null;
  quoteNarrationId: string | null;
  quoteStart: number | null; // null なら全文
  quoteEnd: number | null;
  question: string | null;
  kind: "claude" | "fixed";
  shownAt: number | null;
  createdAt: number;
}
/** 固定の入り口（Claude を使わない）。question も model も持たない。 */
export type NewFixedEntrance = Pick<
  EntranceRow,
  "id" | "familyId" | "memberId" | "forDate" | "photoId" | "quoteNarrationId" | "createdAt"
>;

// ---- リポジトリ ----
// 家族の中のものを引くときは、必ず familyId を渡す（ほかの家族のものは見えない = 404）。

export interface FamilyRepository {
  /** 家族と、最初の招待の合言葉（のハッシュ）を一緒に作る。 */
  create(family: Omit<FamilyRow, "createdAt">, invite: { id: string; tokenHash: string }, now: number): Promise<void>;
  get(familyId: string): Promise<FamilyRow | null>;
  /** 取り消されていない招待の合言葉のハッシュから家族を引く。 */
  findByActiveInviteHash(tokenHash: string): Promise<FamilyRow | null>;
  /** 今の合言葉を取り消し、新しいものに替える（一度に行う）。 */
  regenerateInvite(familyId: string, invite: { id: string; tokenHash: string }, now: number): Promise<void>;
  setClock(familyId: string, clock: Clock): Promise<void>;
  /** 毎朝の処理の対象: 時計を持たない（本当の時刻で動く）家族 */
  listIdsWithoutClock(): Promise<string[]>;
}

export interface MemberRepository {
  list(familyId: string): Promise<MemberRow[]>;
  get(familyId: string, memberId: string): Promise<MemberRow | null>;
  create(row: MemberRow): Promise<void>;
  update(familyId: string, memberId: string, fields: MemberFields): Promise<MemberRow | null>;
}

export interface PhotoRepository {
  findByOwnerHash(familyId: string, ownerMemberId: string, contentHash: string): Promise<PhotoRow | null>;
  /** 同じ持ち主・同じ content_hash がすでにあれば入れずに false を返す。 */
  insertIfAbsent(row: PhotoRow): Promise<boolean>;
  get(familyId: string, photoId: string): Promise<PhotoRow | null>;
  list(familyId: string, ownerMemberId?: string): Promise<PhotoRow[]>;
}

export interface NarrationRepository {
  /** 同じ requestId がすでにあれば入れずに false を返す。 */
  insertIfAbsent(row: NewNarration): Promise<boolean>;
  get(familyId: string, narrationId: string): Promise<NarrationRow | null>;
  findByRequestId(familyId: string, requestId: string): Promise<NarrationRow | null>;
  listByPhoto(familyId: string, photoId: string): Promise<NarrationRow[]>;
  /** 語りのある写真の語りすべて（新しい語りのある写真から順に並べるのは呼ぶ側） */
  listAll(familyId: string): Promise<NarrationRow[]>;
  /** 文字起こしの結果を入れる。pending のときだけ書き換える。 */
  setTranscript(familyId: string, narrationId: string, status: "done" | "failed", transcript: string | null): Promise<void>;
}

export interface EntranceRepository {
  get(familyId: string, memberId: string, forDate: string): Promise<EntranceRow | null>;
  getById(familyId: string, entranceId: string): Promise<EntranceRow | null>;
  listByMember(familyId: string, memberId: string): Promise<EntranceRow[]>;
  /** (member_id, for_date) がすでにあれば入れずに false を返す。 */
  insertFixedIfAbsent(row: NewFixedEntrance): Promise<boolean>;
  /** 初めて見せた時刻を入れる（すでにあれば変えない）。 */
  markShown(familyId: string, entranceId: string, now: number): Promise<void>;
}

// ---- 写真の初回整理（photo_guess） ----
// 説明は Claude の推測。家族には見せない（家族向けの API の形に入れない）。入り口づくりの材料にだけ使う。

export interface PhotoGuessRow {
  id: string;
  photoId: string;
  familyId: string;
  description: string;
  model: string;
  promptVersion: string;
  createdAt: number;
}

/** 説明を作っている途中の写真の記録（「取る」ことで、同じ写真を二度呼ばない・二度 Batch に入れない） */
export interface PhotoGuessClaim {
  photoId: string;
  familyId: string;
  promptVersion: string;
  /** Batch に入れたもの。一枚ずつ呼んでいるものは null */
  batchId: string | null;
  attempts: number;
}

/** 取り直してよい作業の記録の条件 */
export interface ClaimOpts {
  /** 失敗したもの、または Batch なしで、これより前に取ったまま残っているもの */
  staleBefore: number;
  /** Batch に入れたまま、これより前に取ったまま残っているもの */
  batchStaleBefore: number;
  /** 失敗で、試した回数がこれ未満のもの */
  maxAttempts: number;
}

export interface PhotoGuessRepository {
  /** この版の説明も、作業中の記録もない写真（作業中でも取り直せるものは含む）。古い順に limit 枚まで */
  listCandidates(
    familyId: string,
    promptVersion: string,
    limit: number,
    opts: ClaimOpts,
  ): Promise<PhotoRow[]>;
  /**
   * 写真を「取る」。取れたものの photoId だけを返す。
   * まだ記録のない写真か、取り直してよい写真（ClaimOpts）だけを取る。
   */
  claim(familyId: string, photoIds: string[], promptVersion: string, opts: ClaimOpts & { now: number }): Promise<string[]>;
  /** 取った写真を Batch に結びつける */
  attachBatch(familyId: string, photoIds: string[], promptVersion: string, batchId: string): Promise<void>;
  /** 説明を入れ、作業の記録を消す（一度に）。同じ写真・同じ版の説明がすでにあれば入れない */
  saveGuess(row: PhotoGuessRow): Promise<void>;
  /** 取ったのをやめる（試した回数に数えない。Claude を呼べなかったときや、今回の Batch に載せきれなかったとき） */
  release(familyId: string, photoIds: string[], promptVersion: string): Promise<void>;
  /** 失敗にする（Batch からも外す）。attempts が上限に届いたものは、それ以上取らない */
  markFailed(familyId: string, photoIds: string[], promptVersion: string): Promise<void>;
  /** 回収を待っている Batch（familyId を渡せばその家族だけ） */
  listOpenBatches(familyId?: string): Promise<{ batchId: string; familyId: string; promptVersion: string }[]>;
  /** その Batch に入っている写真の記録 */
  listClaimsByBatch(batchId: string): Promise<PhotoGuessClaim[]>;
  listByFamily(familyId: string): Promise<PhotoGuessRow[]>;
}

/** データベースのリポジトリの集まり。 */
export interface Repositories {
  families: FamilyRepository;
  members: MemberRepository;
  photos: PhotoRepository;
  narrations: NarrationRepository;
  entrances: EntranceRepository;
  photoGuesses: PhotoGuessRepository;
}

// ---- 文字起こし ----

export interface TranscribeInput {
  audio: Blob;
  /** 方言の地域（「鹿児島」）。標準の話し方なら null */
  dialectRegion: string | null;
  /**
   * 綴りを固定したい、家族自身に由来する語（今は members の呼ばれ方だけ。0013）。
   * Claude の推測や、位置から引いた地名は入れない。API の決まりに合わせた絞り込みは実装が行う。
   */
  keywords: string[];
}

/** 文字起こし。外から来るデータなので、実装は応答を検証してから返す。失敗は投げずに種類で返す。 */
export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<{ ok: true; text: string } | { ok: false; reason: TranscribeFailure }>;
}
export type TranscribeFailure = "not_configured" | "timeout" | "rate_limited" | "upstream" | "rejected" | "invalid_response";

/** 開発用の確かめ（POST /api/check/transcribe）で、文字起こしを生のまま呼ぶ。応答は検証せずに人に見せる */
export interface TranscribeProbe {
  probe(input: { audio: Blob; model: string; fields: [string, string][] }): Promise<TranscribeProbeResult>;
}
export interface TranscribeProbeResult {
  /** HTTP status。届かなかったときは null */
  status: number | null;
  networkError: string | null;
  elapsedMs: number;
  /** 実際に付けたファイル名 */
  fileName: string;
  /** JSON なら解釈したもの、そうでなければ文字列（先頭だけ） */
  body: unknown;
}

// ---- Claude ----
// 用途ごとの関数ではなく、汎用の形にする。用途の中身（プロンプト、スキーマ、検査）は呼ぶ側が持つ。
// 応答は外から来るデータとして、実装が zod で検証してから返す。失敗は投げずに種類で返す。全か無か。

/** Claude を使う用途。用途 → モデルは core/claude.ts の対応表で一か所に持つ */
export type ClaudePurpose = "photo_guess" | "clean_transcript" | "entrance";

/** プロンプト（system に入れる）。src/server/prompts/ が用途ごとに今の版を一つ持つ */
export interface ClaudePrompt {
  purpose: ClaudePurpose;
  /** 保存に入れる版の文字列。"<用途>/v<N>"（例 "entrance/v1"） */
  version: string;
  text: string;
}

/** user の一通に入れるもの。画像は縮小済みのバイト列を base64 にしたもの（core/claude.ts の bytesToBase64） */
export type ClaudeContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

export interface ClaudeCallRequest<T> {
  prompt: ClaudePrompt;
  content: ClaudeContentPart[];
  /** 構造化出力のスキーマ。送る形にも、受け取った後の検証にも使う */
  schema: z.ZodType<T>;
  /**
   * スキーマを通った後の、中身の検査（引用の ID が実在するか、試す言い回しがないか、など）。
   * 違反の種類（短い英字。ログに出る）を返すと失敗として扱い、再試行の対象にする。問題なければ null。
   * 違反の種類に、受け取った本文を入れない。
   */
  check?: (value: T) => string | null;
  /** 処理の ID（ログで追うため） */
  traceId?: string;
}

/** 保存とログに使う、呼び出しの記録。本文は持たない */
export interface ClaudeCallMeta {
  purpose: ClaudePurpose;
  /** 応答に書かれたモデル（応答がなければ要求したモデル） */
  model: string;
  promptVersion: string;
  /** 全試行の合計 */
  inputTokens: number;
  outputTokens: number;
  /** 何回送ったか（送る前に止めたら 0） */
  attempts: number;
}

export type ClaudeFailure =
  | "not_configured"
  | "timeout"
  | "network"
  | "rate_limited"
  | "upstream"
  | "rejected"
  | "auth"
  | "too_large"
  | "refused"
  | "truncated"
  | "invalid_response"
  | "check_failed";

export type ClaudeCallResult<T> =
  | { ok: true; value: T; meta: ClaudeCallMeta }
  | { ok: false; reason: ClaudeFailure; /** check_failed（と送る前に止めた rejected）の、違反の種類 */ violation?: string; meta: ClaudeCallMeta };

/** Batch API に入れる一件。customId は 1〜64 文字の英数字・_・-（写真の ID など） */
export interface ClaudeBatchItem {
  customId: string;
  content: ClaudeContentPart[];
}

export type ClaudeBatchStatus = "in_progress" | "canceling" | "ended";

export interface ClaudeBatchInfo {
  batchId: string;
  status: ClaudeBatchStatus;
  counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
}

/** Batch の結果の一行。行ごとに全か無か */
export type ClaudeBatchRow<T> =
  | { customId: string; ok: true; value: T; meta: ClaudeCallMeta }
  | {
      customId: string;
      ok: false;
      /** errored / canceled / expired は upstream・rejected などに読み替える */
      reason: ClaudeFailure | "canceled" | "expired";
      violation?: string;
      meta: ClaudeCallMeta;
    };

export type ClaudeOpResult<T> = { ok: true; value: T } | { ok: false; reason: ClaudeFailure };

/** Claude の呼び出し。家族が画面を開いている最中には呼ばない（入り口は毎朝の処理で作る） */
export interface ClaudeClient {
  call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>>;
  /** 同じプロンプト・同じスキーマで、多くの件をまとめて頼む（半額。返るまで最長 24 時間） */
  createBatch<T>(req: { prompt: ClaudePrompt; schema: z.ZodType<T>; items: ClaudeBatchItem[]; traceId?: string }): Promise<ClaudeOpResult<ClaudeBatchInfo>>;
  getBatch(batchId: string, traceId?: string): Promise<ClaudeOpResult<ClaudeBatchInfo>>;
  /** status が ended になってから呼ぶ。prompt は createBatch に渡したもの（meta の版に使う） */
  getBatchResults<T>(req: {
    batchId: string;
    prompt: ClaudePrompt;
    schema: z.ZodType<T>;
    check?: (value: T) => string | null;
    traceId?: string;
  }): Promise<ClaudeOpResult<ClaudeBatchRow<T>[]>>;
}

// ---- 設定と依存 ----

export interface AppConfig {
  /** production / preview / development。本番かどうかで、時計を使える家族が変わる */
  appEnv: string;
  /** POST /api/families を守る Bearer。ないときは家族を作れない */
  createFamilyToken: string | null;
}

/** レスポンスを返した後に続ける処理。Workers では waitUntil、VPS ではそのまま待たずに走らせる。 */
export type RunInBackground = (task: Promise<unknown>) => void;

/** アプリが使う依存のすべて。入り口の層（platform/）が作って渡す。 */
export interface AppDeps {
  repos: Repositories;
  photos: PhotoStore;
  transcriber: Transcriber;
  claude: ClaudeClient;
  /** 開発用の確かめ。キーがなければ null */
  transcribeProbe: TranscribeProbe | null;
  runInBackground: RunInBackground;
  config: AppConfig;
  now: () => Date;
}
