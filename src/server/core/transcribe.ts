import type { AppDeps, Transcriber } from "./ports";

/**
 * 声の語りを文字起こしする（受け取ったことを返した後に、背景で呼ぶ）。
 * 失敗しても録音は残し、文字は空のまま failed にする。作り話で埋めない。
 * 整形（Claude）は今日はまだ作らない。
 */
export async function transcribeNarration(deps: Pick<AppDeps, "repos" | "photos" | "transcriber">, familyId: string, narrationId: string): Promise<void> {
  const { repos } = deps;
  const narration = await repos.narrations.get(familyId, narrationId);
  if (!narration || narration.kind !== "voice" || narration.transcriptStatus !== "pending" || !narration.audioKey) return;

  let outcome: { status: "done"; text: string } | { status: "failed"; reason: string };
  // 録音の形式と大きさ（マイクと録音済みファイルが同じ流れに乗ったかを、ログで見比べるため。本文は出さない）
  let contentType: string | null = narration.audioContentType;
  let audioBytes: number | null = null;
  try {
    const [speaker, stored] = await Promise.all([
      repos.members.get(familyId, narration.speakerMemberId),
      deps.photos.get(narration.audioKey),
    ]);
    if (!stored) {
      outcome = { status: "failed", reason: "audio_missing" };
    } else {
      contentType = narration.audioContentType ?? stored.contentType;
      const audio = await new Response(stored.body).blob();
      audioBytes = audio.size;
      const typed = new Blob([audio], { type: contentType });
      const r = await deps.transcriber.transcribe({
        audio: typed,
        dialectRegion: speaker?.speechStyle === "dialect" ? speaker.dialectRegion : null,
      });
      outcome = r.ok ? { status: "done", text: r.text } : { status: "failed", reason: r.reason };
    }
  } catch (e) {
    outcome = { status: "failed", reason: e instanceof Error ? e.name : "unknown" };
  }

  await repos.narrations.setTranscript(familyId, narrationId, outcome.status, outcome.status === "done" ? outcome.text : null);
  console.log(
    JSON.stringify({
      event: "transcribe_done",
      familyId,
      narrationId,
      status: outcome.status,
      contentType,
      audioBytes,
      ...(outcome.status === "failed" ? { reason: outcome.reason } : {}),
    }),
  );
}

/** キーがないときの文字起こし。文字は作らず、失敗として返す。 */
export const notConfiguredTranscriber: Transcriber = {
  async transcribe() {
    return { ok: false, reason: "not_configured" };
  },
};
