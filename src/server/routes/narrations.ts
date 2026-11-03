// 語り。声は保存先へ流し、受け取ったことを先に返してから背景で文字起こしする。
import { Hono } from "hono";
import { narrationMetaSchema } from "../../shared/api";
import { AUDIO_TYPE_PATTERN } from "../../shared/check";
import { familyToday } from "../core/clock";
import type { NarrationRow, NewNarration } from "../core/ports";
import { transcribeNarration } from "../core/transcribe";
import type { AppEnv } from "./env";
import { checkContentLength, fail, parseJsonString, parseWith, readForm } from "./http";
import { privateBody } from "./photos";
import { narrationView, photoView } from "./views";

/** 録音の上限（文字起こしの上限に合わせる） */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** 語りの受け取りが受け付ける録音か（大きさの上限は別に見る）。確かめの入り口（routes/check.ts）も同じ判定を使う */
export function isAcceptableAudio(audio: File): boolean {
  return audio.size > 0 && audio.type.length <= 100 && AUDIO_TYPE_PATTERN.test(audio.type);
}

export const narrations = new Hono<AppEnv>()
  .post("/narrations", async (c) => {
    const size = checkContentLength(c, MAX_AUDIO_BYTES);
    if (size === "too_large") return fail(c, "too_large");
    if (size === "missing") return fail(c, "invalid_request");
    const form = await readForm(c);
    if (!form) return fail(c, "invalid_request");
    const meta = parseWith(narrationMetaSchema, parseJsonString(form.get("meta")));
    if (!meta) return fail(c, "invalid_request");
    const audio = form.get("audio");
    if (meta.kind === "voice") {
      if (!(audio instanceof File) || !isAcceptableAudio(audio)) {
        return fail(c, "invalid_request");
      }
      if (audio.size > MAX_AUDIO_BYTES) return fail(c, "too_large");
    } else if (audio !== null) {
      return fail(c, "invalid_request");
    }

    const deps = c.get("deps");
    const family = c.get("family");
    const { repos } = deps;

    // 再送: 同じ requestId の語りがあれば、それを返す
    if (meta.requestId) {
      const prior = await repos.narrations.findByRequestId(family.id, meta.requestId);
      if (prior) return c.json({ narration: narrationView(prior) }, 202);
    }

    // 指している人・写真・入り口・語りが、同じ家族のものか
    const [speaker, photo, entrance, replyTo] = await Promise.all([
      repos.members.get(family.id, meta.speakerMemberId),
      repos.photos.get(family.id, meta.photoId),
      meta.entranceId ? repos.entrances.getById(family.id, meta.entranceId) : null,
      meta.replyToId ? repos.narrations.get(family.id, meta.replyToId) : null,
    ]);
    if (!speaker || !photo) return fail(c, "not_found");
    if (meta.entranceId && !entrance) return fail(c, "not_found");
    if (meta.replyToId && !replyTo) return fail(c, "not_found");

    const now = deps.now();
    const id = crypto.randomUUID();
    let audioKey: string | null = null;
    let audioContentType: string | null = null;
    if (meta.kind === "voice" && audio instanceof File) {
      audioKey = `families/${family.id}/audio/${id}`;
      audioContentType = audio.type;
      await deps.photos.put(audioKey, audio, { contentType: audio.type });
    }

    const insert: NewNarration = {
      id,
      familyId: family.id,
      speakerMemberId: speaker.id,
      photoId: photo.id,
      entranceId: meta.entranceId,
      replyToId: meta.replyToId,
      requestId: meta.requestId ?? null,
      kind: meta.kind,
      audioKey,
      audioContentType,
      durationMs: meta.kind === "voice" ? (meta.durationMs ?? null) : null,
      transcript: meta.kind === "text" ? meta.text : null,
      transcriptStatus: meta.kind === "text" ? "done" : "pending",
      forDate: familyToday(family, now),
      createdAt: now.getTime(),
    };
    const row: NarrationRow = { ...insert, cleanedText: null, cleanedModel: null, cleanedPromptVersion: null, uncertainSpans: null };
    if (!(await repos.narrations.insertIfAbsent(insert))) {
      // 同時に同じ requestId が届いた: 先に入った方を返す
      if (audioKey) await deps.photos.delete(audioKey);
      const winner = meta.requestId ? await repos.narrations.findByRequestId(family.id, meta.requestId) : null;
      if (!winner) return fail(c, "internal");
      return c.json({ narration: narrationView(winner) }, 202);
    }

    if (row.kind === "voice") deps.runInBackground(transcribeNarration(deps, family.id, id));
    return c.json({ narration: narrationView(row) }, 202);
  })

  .get("/narrations", async (c) => {
    const photoId = c.req.query("photoId");
    if (!photoId) return fail(c, "invalid_request");
    const deps = c.get("deps");
    const familyId = c.get("family").id;
    if (!(await deps.repos.photos.get(familyId, photoId))) return fail(c, "not_found");
    const rows = await deps.repos.narrations.listByPhoto(familyId, photoId);
    return c.json({ narrations: rows.map(narrationView) });
  })

  .get("/narrations/:id/audio", async (c) => {
    const deps = c.get("deps");
    const n = await deps.repos.narrations.get(c.get("family").id, c.req.param("id"));
    if (!n || !n.audioKey) return fail(c, "not_found");
    const obj = await deps.photos.get(n.audioKey);
    if (!obj) return fail(c, "not_found");
    return privateBody(obj.body, n.audioContentType ?? obj.contentType, obj.size);
  })

  // 語りのある写真を、新しい語りのある写真から順に
  .get("/feed", async (c) => {
    const deps = c.get("deps");
    const familyId = c.get("family").id;
    const [all, photoRows] = await Promise.all([deps.repos.narrations.listAll(familyId), deps.repos.photos.list(familyId)]);
    const byPhoto = new Map<string, NarrationRow[]>();
    for (const n of all) {
      const list = byPhoto.get(n.photoId) ?? [];
      list.push(n);
      byPhoto.set(n.photoId, list);
    }
    const photoById = new Map(photoRows.map((p) => [p.id, p]));
    const latest = (ns: NarrationRow[]) => ns.reduce((m, n) => Math.max(m, n.createdAt), 0);
    const items = [...byPhoto.entries()]
      .filter(([photoId]) => photoById.has(photoId))
      .sort(([, a], [, b]) => latest(b) - latest(a))
      .map(([photoId, ns]) => ({ photo: photoView(photoById.get(photoId)!), narrations: ns.map(narrationView) }));
    return c.json({ items });
  });
