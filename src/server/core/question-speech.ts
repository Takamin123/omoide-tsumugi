// 問いかけの読み上げ（0019「採るときの形」、0027、0029）。
// 毎朝の処理だけが、検査を通った Claude の問いかけ（kind='claude'）に音声を作り、PhotoStore に保存する。
// - 家族が画面を開いたときには作らない。固定の入り口には作らない
// - 作るのが失敗しても入り口はそのまま出す。家族には知らせない
// - 音声がすでにある入り口、家族に一度見せた入り口には作らない（後から差し替えない）
// - ログは ID・モデル・声・長さ（バイト数）・所要時間と、失敗の種類だけ。文は出さない
import { checkEntranceQuestion } from "./entrance-claude";
import type { AppDeps, EntranceRow, SpeechFailure, SpeechSettings } from "./ports";

/**
 * 本番の声の設定（一か所）。実機（iPhone、iPad、Android）で聞き比べるまでの仮の値で、今は /check の初期値と同じ（0027）。
 * gpt-4o-mini-tts は 2027-01-06 に終了する（0019 の見直す条件）
 */
export const QUESTION_SPEECH: SpeechSettings = {
  model: "gpt-4o-mini-tts",
  voice: "marin",
  speed: 1.0,
  instructions:
    "日本語で、ゆっくり、落ち着いた声で読んでください。感情を込めたり抑揚を大きくしたりせず、書かれた文だけをそのまま読み、前置きや相づちを足さないでください。",
  format: "mp3",
};

/** 保存先の鍵。家族ごとに分ける（0027 の消す手順 families/<id>/ に入る）。同時に二つ走っても相手の音声を消さないよう、毎回別の鍵にする */
export function questionAudioKey(familyId: string, entranceId: string): string {
  return `families/${familyId}/speech/${entranceId}-${crypto.randomUUID()}.mp3`;
}

export type QuestionAudioResult =
  | { status: "made" }
  /** 作る対象ではない（キーがない、固定の入り口、もうある、もう見せた、同時に別の処理が入れた） */
  | { status: "skipped"; why: "not_configured" | "not_claude" | "exists" | "shown" | "raced" }
  | { status: "failed"; reason: SpeechFailure | "question_check" };

/**
 * 一つの入り口に、問いかけの読み上げの音声を作って保存する。投げるのはデータベースや保存先の失敗だけ。
 * deadline（ミリ秒の時刻）を過ぎる呼び出しはしない
 */
export async function ensureQuestionAudio(
  deps: Pick<AppDeps, "repos" | "photos" | "speaker">,
  entrance: EntranceRow,
  opts: { deadline?: number; traceId?: string } = {},
): Promise<QuestionAudioResult> {
  if (!deps.speaker) return { status: "skipped", why: "not_configured" };
  if (entrance.kind !== "claude" || entrance.question === null) return { status: "skipped", why: "not_claude" };
  if (entrance.questionAudioKey !== null) return { status: "skipped", why: "exists" };
  if (entrance.shownAt !== null) return { status: "skipped", why: "shown" };

  const settings = QUESTION_SPEECH;
  const base = {
    event: "question_speech",
    traceId: opts.traceId ?? null,
    familyId: entrance.familyId,
    entranceId: entrance.id,
    model: settings.model,
    voice: settings.voice,
  };
  // 保存した問いかけは検査を通ったもの。読む前にもう一度確かめる（通らないものは読まない）
  if (checkEntranceQuestion(entrance.question) !== null) {
    console.log(JSON.stringify({ ...base, ok: false, reason: "question_check" }));
    return { status: "failed", reason: "question_check" };
  }

  const started = Date.now();
  const r = await deps.speaker.speak({
    text: entrance.question,
    settings,
    ...(opts.deadline !== undefined ? { deadline: opts.deadline } : {}),
    ...(opts.traceId ? { traceId: opts.traceId } : {}),
  });
  const ms = Date.now() - started;
  if (!r.ok) {
    console.log(JSON.stringify({ ...base, ok: false, reason: r.reason, attempts: r.attempts, ms }));
    return { status: "failed", reason: r.reason };
  }

  const key = questionAudioKey(entrance.familyId, entrance.id);
  await deps.photos.put(key, r.audio, { contentType: r.contentType });
  let set: boolean;
  try {
    set = await deps.repos.entrances.setQuestionAudio(entrance.familyId, entrance.id, { key, model: settings.model, voice: settings.voice });
  } catch (e) {
    // データベースが落ちた: どこからも指されない音声を残さない
    await deps.photos.delete(key).catch(() => {});
    throw e;
  }
  if (!set) {
    // その間に家族が開いた、または別の処理が先に入れた: 保存した音声は使わないので消す
    await deps.photos.delete(key).catch(() => {});
    console.log(JSON.stringify({ ...base, ok: false, reason: "not_set", attempts: r.attempts, ms }));
    return { status: "skipped", why: "raced" };
  }
  console.log(JSON.stringify({ ...base, ok: true, bytes: r.audio.byteLength, attempts: r.attempts, ms }));
  return { status: "made" };
}
