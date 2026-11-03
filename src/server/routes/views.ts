// データベースの行から、API の形（src/shared/api.ts）へ。緯度経度などクライアントに返さないものはここで落とす。
import type { Entrance, Member, Narration, Photo } from "../../shared/api";
import { displayText, quoteText } from "../core/clean-transcript";
import type { EntranceRow, MemberRow, NarrationRow, PhotoRow } from "../core/ports";

export const memberView = (m: MemberRow): Member => ({
  id: m.id,
  role: m.role,
  relation: m.relation,
  calledAs: m.calledAs,
  speechStyle: m.speechStyle,
  dialectRegion: m.dialectRegion,
  setUpByMemberId: m.setUpByMemberId,
});

export const photoView = (p: PhotoRow): Photo => ({
  id: p.id,
  ownerMemberId: p.ownerMemberId,
  width: p.width,
  height: p.height,
  takenAt: p.takenAt,
  hasLocation: p.latitude !== null && p.longitude !== null,
  imageUrl: `/api/photos/${encodeURIComponent(p.id)}/image`,
});

/** 声の語りの録音の URL。文字の語りは null。返すときは合言葉を確かめ、Cache-Control: private, no-store を付ける（narrations.ts） */
const narrationAudioUrl = (n: NarrationRow): string | null =>
  n.kind === "voice" ? `/api/narrations/${encodeURIComponent(n.id)}/audio` : null;

export const narrationView = (n: NarrationRow): Narration => ({
  id: n.id,
  speakerMemberId: n.speakerMemberId,
  photoId: n.photoId,
  entranceId: n.entranceId,
  replyToId: n.replyToId,
  kind: n.kind,
  audioUrl: narrationAudioUrl(n),
  durationMs: n.kind === "voice" ? n.durationMs : null,
  transcriptStatus: n.transcriptStatus,
  // 印の範囲は「……」に置き換え済み。生の範囲（uncertainSpans）は返さない
  text: displayText(n),
  forDate: n.forDate,
  createdAt: n.createdAt,
});

/**
 * 添える家族の言葉は、語りの本文から範囲で引く（null なら全文）。範囲は、声の語りなら cleanedText、文字の語りなら transcript の位置（0017、0018）。
 * 切り出してから印の範囲を「……」に置き換える（quoteText）。
 */
export function entranceView(e: EntranceRow, photo: PhotoRow, quoteFrom: NarrationRow | null): Entrance {
  let quote: Entrance["quote"] = null;
  const text = quoteFrom ? quoteText(quoteFrom, e.quoteStart, e.quoteEnd) : null;
  if (quoteFrom && text !== null && text.length > 0) {
    // 声なら、引用の範囲ではなく語り全体の録音を流す（0011、0015）
    quote = {
      narrationId: quoteFrom.id,
      speakerMemberId: quoteFrom.speakerMemberId,
      text,
      audioUrl: narrationAudioUrl(quoteFrom),
      durationMs: quoteFrom.kind === "voice" ? quoteFrom.durationMs : null,
    };
  }
  return {
    id: e.id,
    memberId: e.memberId,
    forDate: e.forDate,
    photo: photoView(photo),
    focus: e.focus,
    quote,
    question: e.question,
    // 音声があるときだけ。合言葉を確かめてから返す入り口（鍵そのもの、モデル、声は出さない）
    questionAudioUrl: e.questionAudioKey ? `/api/entrances/${encodeURIComponent(e.id)}/question-audio` : null,
  };
}
