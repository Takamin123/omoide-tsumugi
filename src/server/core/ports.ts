// アプリが外の世界に頼るもののインターフェース。
// ハンドラと core はこれだけを見る。D1・R2（Workers）でも、better-sqlite3・ローカルのファイル（VPS）でも実装できる形にする。
// 理由は docs/decisions/0002-cloudflare-workers.md
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

/** データベースのリポジトリの集まり。 */
export interface Repositories {
  families: FamilyRepository;
  members: MemberRepository;
  photos: PhotoRepository;
  narrations: NarrationRepository;
  entrances: EntranceRepository;
}

// ---- 文字起こし ----

export interface TranscribeInput {
  audio: Blob;
  /** 方言の地域（「鹿児島」）。標準の話し方なら null */
  dialectRegion: string | null;
}

/** 文字起こし。外から来るデータなので、実装は応答を検証してから返す。失敗は投げずに種類で返す。 */
export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<{ ok: true; text: string } | { ok: false; reason: TranscribeFailure }>;
}
export type TranscribeFailure = "not_configured" | "timeout" | "rate_limited" | "upstream" | "rejected" | "invalid_response";

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
  runInBackground: RunInBackground;
  config: AppConfig;
  now: () => Date;
}
