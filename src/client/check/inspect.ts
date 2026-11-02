// 開発用の確かめページ（/check）で、写真と録音を端末の中だけで調べる。家族に見せる言葉ではない。
// アプリの本物の関数（readExifFacts・sha256Hex・resizeToJpeg）を preparePhoto と同じ順に呼ぶ（間に EXIF の有無の確かめを挟む）。
// 写真の中身・位置はどこにも送らず、console にも出さない。
import { readExifFacts, readExifTagNames, resizeToJpeg, sha256Hex } from "../lib/photos";
import { acceptedByNarrations, extOf, type AudioRow, type AudioSource, type PhotoPicker, type PhotoRow } from "./report";

const errName = (e: unknown) => (e instanceof Error ? `${e.name}${e.message ? `: ${e.message}` : ""}` : String(e));

/** 一枚を調べる。location（丸めた値）は画面に出すためだけに返し、記録の行（row）には有無だけを入れる */
export async function inspectPhoto(
  file: File,
  picker: PhotoPicker,
): Promise<{ row: PhotoRow; location: { latitude: number; longitude: number } | null }> {
  const facts = await readExifFacts(file);
  const exifTags = await readExifTagNames(file);
  await sha256Hex(file);
  let resize: PhotoRow["resize"];
  try {
    const r = await resizeToJpeg(file);
    resize = { ok: true, width: r.width, height: r.height, size: r.blob.size };
  } catch (e) {
    resize = { ok: false, error: errName(e) };
  }
  const hasLocation = facts.latitude != null && facts.longitude != null;
  return {
    row: {
      picker,
      ext: extOf(file.name),
      mime: file.type,
      size: file.size,
      takenAt: facts.takenAt,
      hasLocation,
      exifTags,
      resize,
    },
    location: hasLocation ? { latitude: facts.latitude!, longitude: facts.longitude! } : null,
  };
}

type AudioContextCtor = typeof AudioContext;

async function decodedLength(blob: Blob): Promise<{ ms: number | null; error: string | null }> {
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return { ms: null, error: "AudioContext なし" };
  const ctx = new Ctor();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { ms: Math.round(buf.duration * 1000), error: null };
  } catch (e) {
    return { ms: null, error: errName(e) };
  } finally {
    void ctx.close().catch(() => {});
  }
}

/** マイクの Blob も、録音済みファイルも、この関数に渡す */
export async function inspectAudio(
  blob: Blob,
  source: AudioSource,
  durationMs: number | null,
): Promise<AudioRow> {
  const decoded = await decodedLength(blob);
  return {
    source,
    ext: blob instanceof File ? extOf(blob.name) : null,
    type: blob.type,
    size: blob.size,
    durationMs,
    decodedMs: decoded.ms,
    decodeError: decoded.error,
    acceptedByNarrations: acceptedByNarrations(blob.type),
  };
}
