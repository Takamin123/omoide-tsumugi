// 写真。縮小済みの JPEG を受け取り、保存先へ流す。同じ持ち主・同じ content_hash は一つにまとめる。
import { Hono } from "hono";
import { PHOTO_GUESS_BACKGROUND_BUDGET_MS, runPhotoGuesses } from "../core/photo-guess";
import { photoMetaSchema, type PhotoMeta, type UploadPhotoResult } from "../../shared/api";
import { currentMember } from "./auth";
import type { AppEnv } from "./env";
import { checkContentLength, fail, parseJsonString, parseWith, readForm } from "./http";
import { photoView } from "./views";

/** 縮小済みの写真の上限（multipart 全体） */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** 小数第 2 位（約 1 km）に丸めてあるか。生の値は持たない */
export function isRoundedCoordinate(v: number): boolean {
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}

function locationIsValid(meta: PhotoMeta): boolean {
  if ((meta.latitude === null) !== (meta.longitude === null)) return false;
  if (meta.latitude === null || meta.longitude === null) return true;
  return isRoundedCoordinate(meta.latitude) && isRoundedCoordinate(meta.longitude);
}

async function isJpeg(file: File): Promise<boolean> {
  if (file.type !== "image/jpeg") return false;
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

export const photos = new Hono<AppEnv>()
  .post("/photos", async (c) => {
    const size = checkContentLength(c, MAX_PHOTO_BYTES);
    if (size === "too_large") return fail(c, "too_large");
    if (size === "missing") return fail(c, "invalid_request");
    const form = await readForm(c);
    if (!form) return fail(c, "invalid_request");
    const meta = parseWith(photoMetaSchema, parseJsonString(form.get("meta")));
    const file = form.get("file");
    if (!meta || !(file instanceof File) || !locationIsValid(meta)) return fail(c, "invalid_request");
    if (file.size > MAX_PHOTO_BYTES) return fail(c, "too_large");
    if (file.size === 0 || !(await isJpeg(file))) return fail(c, "invalid_request");

    const deps = c.get("deps");
    const familyId = c.get("family").id;
    // 持ち主は、この端末の人（リンクの人）。クライアントからは受け取らない（0036）
    const ownerMemberId = currentMember(c).id;

    const existing = await deps.repos.photos.findByOwnerHash(familyId, ownerMemberId, meta.contentHash);
    if (existing) return c.json({ photo: photoView(existing), duplicate: true } satisfies UploadPhotoResult, 200);

    const id = crypto.randomUUID();
    const storageKey = `families/${familyId}/photos/${id}.jpg`;
    await deps.photos.put(storageKey, file, { contentType: "image/jpeg" });
    const row = {
      id,
      familyId,
      ownerMemberId,
      storageKey,
      contentHash: meta.contentHash,
      width: meta.width,
      height: meta.height,
      takenAt: meta.takenAt,
      latitude: meta.latitude,
      longitude: meta.longitude,
      createdAt: deps.now().getTime(),
    };
    if (!(await deps.repos.photos.insertIfAbsent(row))) {
      // 同時に同じ写真が届いた: 先に入った方を返し、こちらの保存は消す
      await deps.photos.delete(storageKey);
      const winner = await deps.repos.photos.findByOwnerHash(familyId, ownerMemberId, meta.contentHash);
      if (!winner) return fail(c, "internal");
      return c.json({ photo: photoView(winner), duplicate: true } satisfies UploadPhotoResult, 200);
    }
    // 写っている内容の説明（推測。家族には見せない）を、応答の後に作る。失敗しても登録は失敗させない
    deps.runInBackground(runPhotoGuesses(deps, familyId, { budgetMs: PHOTO_GUESS_BACKGROUND_BUDGET_MS }));
    return c.json({ photo: photoView(row), duplicate: false } satisfies UploadPhotoResult, 201);
  })

  .get("/photos", async (c) => {
    const owner = c.req.query("ownerMemberId") || undefined;
    const rows = await c.get("deps").repos.photos.list(c.get("family").id, owner);
    return c.json({ photos: rows.map(photoView) });
  })

  .get("/photos/:id/image", async (c) => {
    const deps = c.get("deps");
    const photo = await deps.repos.photos.get(c.get("family").id, c.req.param("id"));
    if (!photo) return fail(c, "not_found");
    const obj = await deps.photos.get(photo.storageKey);
    if (!obj) return fail(c, "not_found");
    return privateBody(obj.body, obj.contentType, obj.size);
  });

/** 写真・録音を返す。キャッシュに残さない */
export function privateBody(body: ReadableStream, contentType: string, size: number): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
