// データベースの行から、API の形（src/shared/api.ts）へ。緯度経度などクライアントに返さないものはここで落とす。
import type { Entrance, Member, Narration, Photo } from "../../shared/api";
import { narrationText } from "../core/entrances";
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

export const narrationView = (n: NarrationRow): Narration => ({
  id: n.id,
  speakerMemberId: n.speakerMemberId,
  photoId: n.photoId,
  entranceId: n.entranceId,
  replyToId: n.replyToId,
  kind: n.kind,
  audioUrl: n.kind === "voice" ? `/api/narrations/${encodeURIComponent(n.id)}/audio` : null,
  transcriptStatus: n.transcriptStatus,
  text: narrationText(n),
  forDate: n.forDate,
  createdAt: n.createdAt,
});

/** 添える家族の言葉は、語りの本文から範囲で引く（null なら全文）。 */
export function entranceView(e: EntranceRow, photo: PhotoRow, quoteFrom: NarrationRow | null): Entrance {
  let quote: Entrance["quote"] = null;
  const full = quoteFrom ? narrationText(quoteFrom) : null;
  if (quoteFrom && full !== null) {
    const text = e.quoteStart !== null && e.quoteEnd !== null ? full.slice(e.quoteStart, e.quoteEnd) : full;
    if (text.length > 0) quote = { narrationId: quoteFrom.id, speakerMemberId: quoteFrom.speakerMemberId, text };
  }
  return { id: e.id, memberId: e.memberId, forDate: e.forDate, photo: photoView(photo), focus: e.focus, quote, question: e.question };
}
