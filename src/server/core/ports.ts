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
  /**
   * Claude が整えた文字（推測の側）。声の語りの transcript から、句読点・改行を入れ、フィラーと言い直しを削っただけのもの（0018）。
   * 整形できなかったら null（表示は transcript）。一度入れたら変えない（引用の位置が動くため）
   */
  cleanedText: string | null;
  cleanedModel: string | null;
  cleanedPromptVersion: string | null;
  /**
   * 聞き間違いかもしれない範囲。cleanedText の位置（UTF-16 の添字、[start, end)）。重ならず、昇順。
   * 表示ではサーバーが「……」に置き換える。クライアントには出さない。
   * 整形があるときは、印がなくても空の配列。cleanedText があるのに null なら、読めなかったもの（表示は transcript に倒す）
   */
  uncertainSpans: UncertainSpan[] | null;
  forDate: string;
  createdAt: number;
}
export interface UncertainSpan {
  start: number;
  end: number;
}
export type NewNarration = Omit<NarrationRow, "cleanedText" | "cleanedModel" | "cleanedPromptVersion" | "uncertainSpans">;
/** 整形の結果。cleanedModel と cleanedPromptVersion は必ず一緒に入れる（出所） */
export interface NarrationCleaned {
  cleanedText: string;
  cleanedModel: string;
  cleanedPromptVersion: string;
  uncertainSpans: UncertainSpan[];
}

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
  /** 以下は Claude の入り口の記録（固定の入り口では null）。運営と開発だけが見る。家族向けの API の形に入れない（0017） */
  reason: string | null;
  model: string | null;
  promptVersion: string | null;
  /** Claude に渡した語りの ID（プロンプトの全文は保存しない。組み直すため） */
  inputNarrationIds: string[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * 問いかけの読み上げの音声（0019、0029）。kind='claude' の入り口だけが持つ。毎朝の処理が作る。なければ null。
   * key は PhotoStore の鍵。model と voice は出所（作ったときの設定）。家族向けの API には URL だけを出す
   */
  questionAudioKey: string | null;
  questionAudioModel: string | null;
  questionAudioVoice: string | null;
  shownAt: number | null;
  createdAt: number;
}
/** 入り口に付ける読み上げの音声の記録 */
export interface EntranceQuestionAudio {
  key: string;
  model: string;
  voice: string;
}
/** 固定の入り口（Claude を使わない）。question も model も持たない。 */
export type NewFixedEntrance = Pick<
  EntranceRow,
  "id" | "familyId" | "memberId" | "forDate" | "photoId" | "quoteNarrationId" | "createdAt"
>;
/** Claude の入り口。question・model・promptVersion は必ず入れる */
export type NewClaudeEntrance = Pick<
  EntranceRow,
  "id" | "familyId" | "memberId" | "forDate" | "photoId" | "focus" | "quoteNarrationId" | "quoteStart" | "quoteEnd" | "reason" | "createdAt"
> & {
  question: string;
  model: string;
  promptVersion: string;
  inputNarrationIds: string[];
  inputTokens: number;
  outputTokens: number;
};

// ---- リポジトリ ----
// 家族の中のものを引くときは、必ず familyId を渡す（ほかの家族のものは見えない = 404）。

/** リンク（合言葉）を作るときの値。平文の合言葉は持たない */
export interface NewInviteLink {
  id: string;
  tokenHash: string;
}

/** 有効なリンクが指すもの。member が null なら「最初の人のリンク」（家族を作ったときの一度きり。0036） */
export interface ActiveLink {
  family: FamilyRow;
  member: MemberRow | null;
}

export interface FamilyRepository {
  /** 家族と、最初の人のリンク（のハッシュ）を一緒に作る。 */
  create(family: Omit<FamilyRow, "createdAt">, firstLink: NewInviteLink, now: number): Promise<void>;
  get(familyId: string): Promise<FamilyRow | null>;
  /** 取り消されていないリンクのハッシュから、家族と人を引く。 */
  findActiveLink(tokenHash: string): Promise<ActiveLink | null>;
  setClock(familyId: string, clock: Clock): Promise<void>;
  /** 毎朝の処理の対象: 時計を持たない（本当の時刻で動く）家族 */
  listIdsWithoutClock(): Promise<string[]>;
}

export interface MemberRepository {
  list(familyId: string): Promise<MemberRow[]>;
  get(familyId: string, memberId: string): Promise<MemberRow | null>;
  create(row: MemberRow): Promise<void>;
  /**
   * 直す。いなければ null。直した後に role = family の人が家族に一人もいなくなるなら、直さずに "no_family_left"
   * （家族のことを触れる人がいなくなり、誰もリンクを作れなくなる。0036）。確かめと直すのは一つの文で行う（同時に直しても抜けない）
   */
  update(familyId: string, memberId: string, fields: MemberFields): Promise<MemberRow | null | "no_family_left">;
  /**
   * 最初の一人を入れる。家族に人がまだいないときだけ、一度に「人を入れる → その人のリンクを作る → 最初の人のリンクを取り消す」。
   * 入れられたら true（ほかの端末が先に入れていたら false で、何も入れない）
   */
  addFirst(row: MemberRow, link: NewInviteLink, now: number): Promise<boolean>;
  /** その人の有効なリンクを取り消し、新しいリンクを作る（一度に）。ほかの人のリンクには触れない */
  replaceLink(familyId: string, memberId: string, link: NewInviteLink, now: number): Promise<void>;
  /** 有効なリンクを持つ人の ID */
  listIdsWithActiveLink(familyId: string): Promise<string[]>;
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
  /**
   * 整形の結果を入れる。声の語りで、文字起こしが done で、まだ整形していないときだけ書き換える（整形し直さない）。
   * 書き換えたら true
   */
  setCleaned(familyId: string, narrationId: string, cleaned: NarrationCleaned): Promise<boolean>;
}

export interface EntranceRepository {
  get(familyId: string, memberId: string, forDate: string): Promise<EntranceRow | null>;
  getById(familyId: string, entranceId: string): Promise<EntranceRow | null>;
  listByMember(familyId: string, memberId: string): Promise<EntranceRow[]>;
  /** その家族の、その日の入り口の全員分（同じ日にほかの人へ出した写真を避けるため。0042） */
  listByDate(familyId: string, forDate: string): Promise<EntranceRow[]>;
  /** (member_id, for_date) がすでにあれば入れずに false を返す。 */
  insertFixedIfAbsent(row: NewFixedEntrance): Promise<boolean>;
  /** (member_id, for_date) がすでにあれば入れずに false を返す。 */
  insertClaudeIfAbsent(row: NewClaudeEntrance): Promise<boolean>;
  /** 初めて見せた時刻を入れる（すでにあれば変えない）。 */
  markShown(familyId: string, entranceId: string, now: number): Promise<void>;
  /**
   * 問いかけの読み上げの音声を入れる。kind='claude' で、まだ音声がなく、まだ家族に見せていない（shown_at が null）ときだけ。
   * 入れたら true（入らなければ、呼ぶ側が保存した音声を消す）
   */
  setQuestionAudio(familyId: string, entranceId: string, audio: EntranceQuestionAudio): Promise<boolean>;
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

// ---- 記録の取り出し（extract_records。0039） ----
// 家族が語った言葉から、人・場所・時期・出来事を、語りの本文そのままで抜き出したもの（origin = 'told'）。
// 値は語りの本文の連続した部分（言い換え・正規化しない）。位置は quoteSource の位置。家族には見せない（今は材料だけ）

export type RecordKind = "person" | "place" | "time" | "event";

export interface RecordRow {
  id: string;
  familyId: string;
  photoId: string | null;
  kind: RecordKind;
  value: string;
  origin: "told" | "guessed";
  toldByMemberId: string | null;
  narrationId: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: number;
}

/** 語りから取り出した記録（told）。出所は語り手と語り。model と promptVersion は持たない（records_origin の CHECK） */
export interface NewToldRecord {
  id: string;
  familyId: string;
  photoId: string;
  kind: RecordKind;
  value: string;
  toldByMemberId: string;
  narrationId: string;
  quoteStart: number;
  quoteEnd: number;
  createdAt: number;
}

export interface RecordExtractionRow {
  narrationId: string;
  familyId: string;
  promptVersion: string;
  model: string | null;
  state: "done" | "failed";
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
}

/** 取り出しの一回の記録（保存のときに渡す） */
export type RecordExtractionAttempt = Omit<RecordExtractionRow, "state" | "attempts">;

export interface RecordRepository {
  listByFamily(familyId: string): Promise<RecordRow[]>;
}

export interface RecordExtractionRepository {
  /**
   * まだ取り出していない語り（作業の行がない、または failed で attempts が maxAttempts 未満）。古い順に limit 件まで。
   * 声の語りで整形がまだのものも返す（使えるかは呼ぶ側が quoteSource で決める）
   */
  listPending(familyId: string, maxAttempts: number, limit: number): Promise<NarrationRow[]>;
  /**
   * 取り出せたことを入れる（一度に）。done の行がまだないときだけ records を入れ、作業の行を done にする。
   * records が空でも done を残す
   */
  saveDone(attempt: RecordExtractionAttempt, records: NewToldRecord[]): Promise<void>;
  /** 失敗にする（attempts を一つ増やす）。done の行は変えない */
  markFailed(attempt: RecordExtractionAttempt): Promise<void>;
  listByFamily(familyId: string): Promise<RecordExtractionRow[]>;
}

// ---- むすびの推測（musubi_guess。0044） ----
// むすびは「同じ出来事」のまとまり（0010）。Claude の推測は guessed として持ち、根拠の記録（records の told）の ID を必ず付ける。
// 確定・却下は家族の手だけ（決めた人と時刻）。家族向けの API の形には入れない（今は材料だけ）

export type MusubiPhotoStatus = "guessed" | "confirmed" | "rejected";

export interface MusubiPhotoRow {
  photoId: string;
  status: MusubiPhotoStatus;
  decidedByMemberId: string | null;
  decidedAt: number | null;
}

export interface MusubiRow {
  id: string;
  familyId: string;
  createdBy: "guessed" | "family";
  /** Claude の自由文。運営と開発だけが見る */
  guessedReason: string | null;
  guessedEvidenceRecordIds: string[] | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: number;
  photos: MusubiPhotoRow[];
}

/** 推測のむすび（写真はすべて status = 'guessed' で入れる） */
export interface NewGuessedMusubi {
  id: string;
  familyId: string;
  photoIds: string[];
  evidenceRecordIds: string[];
  reason: string;
  createdAt: number;
}

export interface MusubiGuessRunRow {
  familyId: string;
  /** 渡した told の記録 ID の集合のハッシュ。版は入れない（版が上がっただけでは呼び直さない） */
  inputKey: string;
  promptVersion: string;
  model: string | null;
  state: "done" | "failed";
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
}
export type MusubiGuessAttempt = Omit<MusubiGuessRunRow, "state" | "attempts">;

export interface MusubiRepository {
  /** その家族のむすびと、それぞれの写真（作った順） */
  listByFamily(familyId: string): Promise<MusubiRow[]>;
  getRun(familyId: string, inputKey: string): Promise<MusubiGuessRunRow | null>;
  /**
   * 推測を入れる（一度に）。同じ入力の done の行がまだないときだけ musubi・musubi_photos を入れ、作業の行を done にする。
   * 写真はその家族のものだけが入る。0 件でも done を残す
   */
  saveGuessed(attempt: MusubiGuessAttempt, musubi: NewGuessedMusubi[]): Promise<void>;
  /** 失敗にする（attempts を一つ増やす）。done の行は変えない */
  markFailed(attempt: MusubiGuessAttempt): Promise<void>;
  listRuns(familyId: string): Promise<MusubiGuessRunRow[]>;
}

// ---- 運営の記録の画面（運営と開発だけが見る。家族向けの API には使わない） ----

/**
 * 入り口の行の全部（Claude の推測の側も含む）。名前は schema.ts の entrances の列に合わせる。
 * reason・model などは家族に見せない（0017）。運営の記録の画面だけが読む
 */
export interface OpsEntranceRow extends EntranceRow {
  reason: string | null;
  model: string | null;
  promptVersion: string | null;
  inputNarrationIds: string[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface OpsRecordRepository {
  /** その家族の入り口をすべて（日付の新しい順） */
  listEntrances(familyId: string): Promise<OpsEntranceRow[]>;
}

// ---- デモの初期化（0038） ----

/** 初期化で消して入れ直す表（家族の中身）。families・members・invite_links は残す（一行も書かない） */
export const DEMO_RESET_TABLES = [
  "records",
  "record_extractions",
  "musubi_photos",
  "musubi",
  "musubi_guess_runs",
  "photo_guess_requests",
  "photo_guesses",
  "narrations",
  "entrances",
  "photos",
] as const;
export type DemoResetTable = (typeof DEMO_RESET_TABLES)[number];

/** 初期化の前の、その家族の中身の件数と、行が指す保存先の鍵（写真・録音・問いかけの音声） */
export interface DemoContentSnapshot {
  rows: Record<DemoResetTable, number>;
  storedKeys: string[];
}

/** 初期化で入れる行。入り口は固定の入り口だけ（question・model・reason は null） */
export interface DemoSeedRows {
  photos: PhotoRow[];
  entrances: EntranceRow[];
  narrations: NarrationRow[];
}

export interface DemoResetRepository {
  snapshot(familyId: string): Promise<DemoContentSnapshot>;
  /**
   * その家族の中身（DEMO_RESET_TABLES）を消し、種の行を入れ、時計を合わせる。すべてを一つの batch で（全か無か）。
   * デモの家族かどうかは呼ぶ側（core/demo-reset.ts）が確かめる
   */
  replaceContent(familyId: string, seed: DemoSeedRows, clock: Clock): Promise<void>;
}

/** データベースのリポジトリの集まり。 */
export interface Repositories {
  families: FamilyRepository;
  members: MemberRepository;
  photos: PhotoRepository;
  narrations: NarrationRepository;
  entrances: EntranceRepository;
  photoGuesses: PhotoGuessRepository;
  records: RecordRepository;
  recordExtractions: RecordExtractionRepository;
  musubi: MusubiRepository;
  opsRecords: OpsRecordRepository;
  demoReset: DemoResetRepository;
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
export type ClaudePurpose = "photo_guess" | "clean_transcript" | "entrance" | "extract_records" | "musubi_guess";

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

// ---- 読み上げ（試しの段階。0019） ----

/**
 * 開発用の確かめ（POST /api/check/speech）で、読み上げを生のまま呼ぶ。人が入れた値をそのまま送る。
 * 音声はメモリに載せず、ストリームのまま返す。失敗の応答は検証せずに人に見せる。
 */
export interface SpeechProbe {
  probe(input: SpeechProbeInput): Promise<SpeechProbeResult>;
}
export interface SpeechProbeInput {
  model: string;
  input: string;
  voice: string;
  /** null なら送らない */
  instructions: string | null;
  speed: number;
  responseFormat: string;
}
export type SpeechProbeResult =
  | {
      ok: true;
      status: number;
      /** 応答の頭が届くまでの時間 */
      elapsedMs: number;
      contentType: string;
      audio: ReadableStream<Uint8Array>;
    }
  | {
      ok: false;
      /** HTTP status。届かなかったときは null */
      status: number | null;
      networkError: string | null;
      elapsedMs: number;
      /** JSON なら解釈したもの、そうでなければ文字列（先頭だけ） */
      body: unknown;
    };

/**
 * 問いかけの読み上げ（本番。0019、0029）。毎朝の処理だけが呼ぶ。家族が画面を開いたときには呼ばない。
 * SpeechProbe と違い、応答を検証してから返す（音声の形式と大きさ）。失敗は投げずに種類で返す。全か無か。
 * 時間切れ・再試行は implementation-policy 2 のとおり。ただし deadline を過ぎる呼び出しや再試行はしない
 */
export interface Speaker {
  speak(input: SpeakInput): Promise<SpeakResult>;
}
export interface SpeechSettings {
  model: string;
  voice: string;
  speed: number;
  /** 声への指示 */
  instructions: string;
  /** 受け取る形式（OpenAI の response_format） */
  format: "mp3";
}
export interface SpeakInput {
  /** 読む文（検査を通った問いかけ）。ログに出さない */
  text: string;
  settings: SpeechSettings;
  /** この時刻（ミリ秒）を過ぎる待ちや呼び出しはしない */
  deadline?: number;
  /** 処理の ID（ログで追うため） */
  traceId?: string;
}
export type SpeechFailure =
  | "timeout"
  | "network"
  | "rate_limited"
  | "upstream"
  | "rejected"
  | "auth"
  | "invalid_response"
  | "past_deadline";
export type SpeakResult =
  | { ok: true; audio: Uint8Array; contentType: string; attempts: number }
  | { ok: false; reason: SpeechFailure; attempts: number };

// ---- 設定と依存 ----

export interface AppConfig {
  /** production / preview / development。本番かどうかで、時計を使える家族が変わる */
  appEnv: string;
  /** POST /api/families を守る Bearer。ないときは家族を作れない */
  createFamilyToken: string | null;
  /**
   * 運営の記録の画面（/api/ops/*）を守る Bearer。CREATE_FAMILY_TOKEN とは別の鍵（0027、0030）。
   * ないとき、短すぎるとき、CREATE_FAMILY_TOKEN と同じ値のときは誰も開けない
   */
  opsRecordToken: string | null;
  /** 運営が記録を見てよい、デモでない家族の ID（親の同意を得た家族だけ。0030）。デモの家族は載せなくても開く */
  opsRecordFamilies: readonly string[];
  /**
   * デモの初期化（POST /api/demo/families/:familyId/reset）を守る Bearer（0038）。
   * ないとき、短すぎるとき、CREATE_FAMILY_TOKEN・OPS_RECORD_TOKEN と同じ値のときは誰も戻せない
   */
  demoResetToken: string | null;
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
  /** 開発用の読み上げの確かめ。キーがなければ null */
  speechProbe: SpeechProbe | null;
  /** 問いかけの読み上げ（毎朝の処理）。キーがなければ null（音声を作らない） */
  speaker: Speaker | null;
  runInBackground: RunInBackground;
  config: AppConfig;
  now: () => Date;
}
