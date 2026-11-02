// 写真の一括登録の一枚分。docs/decisions/0003
// 1. 縮小の前に exifr で撮影日と位置を読む（縮小すると EXIF は消える）
// 2. 元ファイルの SHA-256 をとる（同じ写真の二度目をまとめるため）
// 3. ブラウザで縮小して JPEG にする
// 位置は小数第 2 位に丸めてから返す。生の値は保持しない。
import exifr from "exifr";
import type { PhotoMeta } from "../../shared/api";
import { fitWithin, parseExifDateTime, roundLocation, toHex } from "./pure";

/** 縮小後の長い辺（px）と JPEG の質 */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_JPEG_QUALITY = 0.85;

export type ExifFacts = { takenAt: string | null; latitude: number | null; longitude: number | null };

/** 撮影日と位置（丸めた値）を読む。読めなければ null の欄にする（写真は送る） */
export async function readExifFacts(file: Blob): Promise<ExifFacts> {
  let takenAt: string | null = null;
  let location: { latitude: number; longitude: number } | null = null;
  try {
    const tags = (await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate"],
      reviveValues: false,
    })) as { DateTimeOriginal?: unknown; CreateDate?: unknown } | undefined;
    takenAt = parseExifDateTime(tags?.DateTimeOriginal) ?? parseExifDateTime(tags?.CreateDate);
  } catch {
    takenAt = null;
  }
  try {
    const gps = await exifr.gps(file);
    // 丸めた値だけを外に出す。生の値はこの関数の中で捨てる
    location = roundLocation(gps?.latitude, gps?.longitude);
  } catch {
    location = null;
  }
  return { takenAt, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null };
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return toHex(new Uint8Array(digest));
}

/** 画像として読めなかった（HEIC など） */
export class UnreadableImageError extends Error {}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    // createImageBitmap が読めない形式でも、<img> なら読める端末がある（Safari の HEIC）
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new UnreadableImageError();
  }
}

export async function resizeToJpeg(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await decode(file);
  try {
    const size = fitWithin(img.width, img.height, PHOTO_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UnreadableImageError();
    ctx.drawImage(img.source, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY));
    if (!blob) throw new UnreadableImageError();
    return { blob, ...size };
  } finally {
    img.close();
  }
}

/** 一枚分の送る準備。EXIF は縮小の前に読む */
export async function preparePhoto(
  file: File,
  ownerMemberId: string,
): Promise<{ blob: Blob; meta: PhotoMeta }> {
  const facts = await readExifFacts(file);
  const contentHash = await sha256Hex(file);
  const resized = await resizeToJpeg(file);
  return {
    blob: resized.blob,
    meta: { ownerMemberId, contentHash, width: resized.width, height: resized.height, ...facts },
  };
}
