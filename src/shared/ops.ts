// 運営の記録の画面（/ops/record）の、クライアントとサーバーの約束。
// 見るのは運営と開発だけ。家族の画面には出さない。合言葉ではなく運営の鍵（OPS_RECORD_TOKEN の Bearer）で守る（0017、0025、0030）。
// 家族が語ったもの（told）と、Claude の推測（guessed）を、形の上でも分けて持つ。

export type OpsRect = { x: number; y: number; w: number; h: number };

export type OpsMember = { id: string; role: "elder" | "family"; relation: string; calledAs: string };

export type OpsPhoto = {
  id: string;
  ownerMemberId: string;
  width: number;
  height: number;
  takenAt: string | null;
  /** 登録した時刻（ミリ秒） */
  createdAt: number;
  /** 運営の鍵で開く写真。Authorization を付けて読む（img の src に鍵を載せない） */
  imageUrl: string;
};

export type OpsEntrance = {
  id: string;
  forDate: string;
  memberId: string;
  kind: "claude" | "fixed";
  photoId: string;
  shownAt: number | null;
  createdAt: number;
  /** 家族が語ったもの（出所つき）。引用の範囲と、そこを切り出した文字 */
  told: {
    quote: {
      narrationId: string;
      speakerMemberId: string | null;
      start: number | null;
      end: number | null;
      /** 引用の位置を数える文字（文字の語りは transcript、声の語りは cleaned_text）の [start, end) をそのまま切り出したもの。印は置き換えない */
      rawText: string | null;
      /** 家族の画面に出た文字（印は「……」）。引用できなければ null */
      shownText: string | null;
    } | null;
  };
  /** Claude が決めたこと・推測（家族の画面に出ない reason を含む） */
  guessed: {
    focus: OpsRect | null;
    question: string | null;
    reason: string | null;
    model: string | null;
    promptVersion: string | null;
    inputNarrationIds: string[] | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
};

export type OpsNarration = {
  id: string;
  photoId: string;
  speakerMemberId: string;
  entranceId: string | null;
  kind: "voice" | "text";
  hasAudio: boolean;
  /** 声の長さ（ミリ秒）。文字の語りと、分からないものは null */
  durationMs: number | null;
  forDate: string;
  createdAt: number;
  transcriptStatus: "pending" | "done" | "failed";
  /** 家族が語ったそのまま（文字起こし、または打った文字） */
  transcript: string | null;
  /** Claude が整えた文字と聞き間違いの印（生の範囲。cleaned_text の位置） */
  cleaned: {
    text: string;
    uncertainSpans: { start: number; end: number }[] | null;
    model: string | null;
    promptVersion: string | null;
  } | null;
};

export type OpsPhotoGuess = {
  id: string;
  photoId: string;
  description: string;
  model: string;
  promptVersion: string;
  createdAt: number;
};

/** GET /api/ops/families/:familyId/record */
export type OpsFamilyRecord = {
  family: { id: string; isDemo: boolean; createdAt: number };
  members: OpsMember[];
  photos: OpsPhoto[];
  entrances: OpsEntrance[];
  narrations: OpsNarration[];
  photoGuesses: OpsPhotoGuess[];
};
