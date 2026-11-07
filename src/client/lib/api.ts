// サーバーを呼ぶ小さな関数。形は src/shared/api.ts の約束に合わせる。
// サーバーはエラーの種類（ErrorKind）だけを返す。文はクライアント（words.ts）が持つ。
import {
  errorKindSchema,
  type AdvanceClockResult,
  type DemoGuideResult,
  type DemoResetResult,
  type Entrance,
  type ErrorKind,
  type FamilyView,
  type FeedResult,
  type Member,
  type MemberInput,
  type Narration,
  type NarrationMeta,
  type Photo,
  type PhotoMeta,
  type MemberLinkResult,
  type UploadPhotoResult,
} from "../../shared/api";

export class ApiError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly status: number,
  ) {
    super(kind);
  }
}

function kindFromStatus(status: number): ErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "invalid_request";
  if (status === 409) return "duplicate";
  if (status === 413) return "too_large";
  return "internal";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError("internal", 0);
  }
  if (!res.ok) {
    let kind = kindFromStatus(res.status);
    try {
      const parsed = errorKindSchema.safeParse(((await res.json()) as { error?: unknown }).error);
      if (parsed.success) kind = parsed.data;
    } catch {
      // 本文が JSON でなければ、ステータスから決めた種類のまま
    }
    throw new ApiError(kind, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** FamilyView に、バックエンドが足す canAdvanceClock を読む形を重ねたもの */
export type FamilyViewWithClock = FamilyView & { family: FamilyView["family"] & { canAdvanceClock?: boolean } };

export const api = {
  createFamily: (createToken: string, isDemo: boolean) =>
    call<{ familyId: string; token: string }>("/api/families", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${createToken}` },
      body: JSON.stringify({ isDemo }),
    }),
  startSession: (token: string) => call<void>("/api/session", json("POST", { token })),
  getFamily: () => call<FamilyViewWithClock>("/api/family"),
  addMember: (input: MemberInput) => call<Member>("/api/members", json("POST", input)),
  updateMember: (id: string, input: MemberInput) =>
    call<Member>(`/api/members/${encodeURIComponent(id)}`, json("PATCH", input)),
  /** その人のリンクを作る（作り直す）。自分なら cookie も替わる（0036） */
  createMemberLink: (memberId: string) =>
    call<MemberLinkResult>(`/api/members/${encodeURIComponent(memberId)}/link`, { method: "POST" }),

  uploadPhoto: (file: Blob, meta: PhotoMeta) => {
    const form = new FormData();
    form.append("file", file, "photo.jpg");
    form.append("meta", JSON.stringify(meta));
    return call<UploadPhotoResult>("/api/photos", { method: "POST", body: form });
  },
  /** 「この写真に追加する」でつないだ写真を外す（「はずす」。0048）。写真そのものは棚に残る */
  removeFromMusubi: (musubiId: string, photoId: string) =>
    call<void>(`/api/musubi/${encodeURIComponent(musubiId)}/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" }),
  listPhotos: (ownerMemberId: string) =>
    call<{ photos: Photo[] }>(`/api/photos?ownerMemberId=${encodeURIComponent(ownerMemberId)}`),

  /** 語りを送る。声のときは audio を付ける。マイクの録音も、録音済みのファイルもここを通る */
  sendNarration: (meta: NarrationMeta & { requestId?: string }, audio?: Blob) => {
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    if (audio) form.append("audio", audio, audioFileName(audio.type));
    return call<{ narration: Narration }>("/api/narrations", { method: "POST", body: form });
  },
  /** 送った直後の声の語りを消す（「録り直す」。0050）。消せなければ 404。自動で送り直さない */
  deleteNarration: (id: string) => call<void>(`/api/narrations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** repliesSeenAt: この端末の人が返事のタブを最後に開いた時刻（null はまだ開いていない。0058） */
  getFeed: () =>
    call<FeedResult>("/api/feed"),
  /** 返事のタブを開いた（0058）。失敗しても画面には出さない */
  markRepliesSeen: () => call<void>("/api/replies/seen", { method: "POST" }),
  /** この端末の人の今日の入り口 */
  todayEntrance: () => call<{ entrance: Entrance | null }>("/api/entrances/today"),

  /** 翌朝へ。from は画面の日付（別の押しが先に進めていたら、サーバーは何もしない。0062） */
  advanceClock: (from: string) => call<AdvanceClockResult>("/api/demo/clock/advance", json("POST", { from })),
  /** 審査員の案内のリンクを受け取る。鍵は URL の検索語ではなく本文で送る（0062） */
  demoGuide: (key: string) => call<DemoGuideResult>("/api/demo/guide", json("POST", { key })),
  /** 審査員が新しい家族を作る。この端末は、その家族の最初の人のリンクで開いた状態になる（0062） */
  demoGuideCreateFamily: (key: string) => call<void>("/api/demo/guide/families", json("POST", { key })),
  /** デモの家族を最初の状態に戻す（運営だけ。鍵は渡すだけで残さない。0038） */
  resetDemo: (familyId: string, resetToken: string) =>
    call<DemoResetResult>(`/api/demo/families/${encodeURIComponent(familyId)}/reset`, {
      method: "POST",
      headers: { authorization: `Bearer ${resetToken}` },
    }),
};

function audioFileName(type: string): string {
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "voice.m4a";
  if (type.includes("ogg")) return "voice.ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "voice.mp3";
  if (type.includes("wav")) return "voice.wav";
  return "voice.webm";
}
