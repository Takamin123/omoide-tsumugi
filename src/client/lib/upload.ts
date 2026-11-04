// 写真を送る道。写真を家族に共有する画面（screens/AddPhotos）と「この写真に追加する」（parts/AddToPhoto。0048）が同じものを使う。
// 一枚ずつ順に: EXIF → SHA-256 → 縮小（lib/photos.ts の preparePhoto）→ 送る。
// 準備と送るのは差し替えられる（テストで偽物を渡す）。
import { MAX_ADD_TO_PHOTO, type Photo, type PhotoLink, type PhotoMeta, type UploadPhotoResult } from "../../shared/api";
import { api, ApiError } from "./api";
import { preparePhoto, UnreadableImageError } from "./photos";
import { emptyTally, tallyOne, type UploadTally } from "./pure";

export type UploadOutcome = "added" | "duplicate" | "unreadable" | "failed";

export type UploadDeps = {
  prepare: (file: File) => Promise<{ blob: Blob; meta: PhotoMeta }>;
  upload: (blob: Blob, meta: PhotoMeta) => Promise<UploadPhotoResult>;
};

const defaultDeps: UploadDeps = { prepare: preparePhoto, upload: (blob, meta) => api.uploadPhoto(blob, meta) };

/**
 * 一枚分。読めなかった・送れなかったは数えて続ける。リンクが切れた（401）ときだけ投げて、残りを送らずに止める。
 * withPhotoId を渡すと、その写真につなぐ（0048）
 */
export async function uploadOne(
  file: File,
  withPhotoId: string | undefined,
  deps: UploadDeps = defaultDeps,
): Promise<{ result: UploadPhotoResult | null; failure: "unreadable" | "failed" | null }> {
  let prepared;
  try {
    prepared = await deps.prepare(file);
  } catch (e) {
    return { result: null, failure: e instanceof UnreadableImageError ? "unreadable" : "failed" };
  }
  try {
    const meta: PhotoMeta = withPhotoId ? { ...prepared.meta, withPhotoId } : prepared.meta;
    return { result: await deps.upload(prepared.blob, meta), failure: null };
  } catch (e) {
    if (e instanceof ApiError && e.kind === "unauthorized") throw e;
    return { result: null, failure: "failed" };
  }
}

/** 写真を家族に共有する画面の一枚分の数え方（棚に入れるだけ。同じ写真の二度目は「すでにある写真」） */
export function shelfOutcome(r: Awaited<ReturnType<typeof uploadOne>>): UploadOutcome {
  if (r.failure) return r.failure;
  return r.result?.duplicate ? "duplicate" : "added";
}

/**
 * 「この写真に追加する」の一枚分の数え方（0048）。この写真とのつながりで数える:
 * 今回つないだ（linked）なら「追加した写真」（棚に既にあった写真でも、列に新しく現れる）、
 * すでにつながっていたら「すでにある写真」、つながりが返らなければ「送れなかった写真」
 */
export function linkOutcome(r: Awaited<ReturnType<typeof uploadOne>>): UploadOutcome {
  if (r.failure) return r.failure;
  const link = r.result?.link;
  if (!link) return "failed";
  return link.linked ? "added" : "duplicate";
}

/** 今回つないだ写真（「はずす」で消す分） */
export type LinkedPhoto = { photo: Photo; musubiId: string };

export type AddToPhotoProgress = { tally: UploadTally; linked: LinkedPhoto[] };

/**
 * 「この写真に追加する」: 選んだ写真を一枚ずつ順に送り、photoId の写真につなぐ（0048）。
 * MAX_ADD_TO_PHOTO 枚を超えたら一枚も送らない。一枚ごとに onProgress を呼ぶ。リンクが切れたら（401）投げる
 */
export async function addToPhoto(
  files: File[],
  photoId: string,
  onProgress: (p: AddToPhotoProgress) => void,
  deps: UploadDeps = defaultDeps,
): Promise<{ kind: "limit" } | { kind: "done"; progress: AddToPhotoProgress }> {
  if (files.length > MAX_ADD_TO_PHOTO) return { kind: "limit" };
  let progress: AddToPhotoProgress = { tally: emptyTally(files.length), linked: [] };
  onProgress(progress);
  for (const file of files) {
    const r = await uploadOne(file, photoId, deps);
    const outcome = linkOutcome(r);
    const link: PhotoLink | null | undefined = r.result?.link;
    progress = {
      tally: tallyOne(progress.tally, outcome),
      linked: outcome === "added" && r.result && link ? [...progress.linked, { photo: r.result.photo, musubiId: link.musubiId }] : progress.linked,
    };
    onProgress(progress);
  }
  return { kind: "done", progress };
}

/**
 * 「はずす」: 今回つないだ写真を一枚ずつ外す（0048）。もう無い（404）なら外れたとみなす。
 * 外せなかった分を返す（列に残し、「はずす」も残す）。最初の失敗の例外も返す（文にするため）
 */
export async function removeLinked(
  linked: LinkedPhoto[],
  remove: (musubiId: string, photoId: string) => Promise<void> = (m, p) => api.removeFromMusubi(m, p),
): Promise<{ left: LinkedPhoto[]; error: unknown }> {
  const left: LinkedPhoto[] = [];
  let error: unknown = null;
  for (const l of linked) {
    try {
      await remove(l.musubiId, l.photo.id);
    } catch (e) {
      if (e instanceof ApiError && e.kind === "not_found") continue;
      if (error === null) error = e;
      left.push(l);
    }
  }
  return { left, error };
}
