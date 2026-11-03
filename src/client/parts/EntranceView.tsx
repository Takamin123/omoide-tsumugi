// 入り口の表示: 写真（白い台紙に貼る形）、添える家族の言葉（話者の呼ばれ方つき。声なら本人の録音を聞ける）、問いかけ一つ。
// 問いかけが null（固定の入り口）のときは、クライアントの固定の一文を出す。
// 問いかけの読み上げは、音声があるときだけ。自動では流さず、そばに常に明示の文を出す（0019、0027）。
import type { Entrance, Member } from "../../shared/api";
import { voiceLength } from "../lib/pure";
import { words } from "../words";
import { PhotoImage } from "./PhotoImage";
import { PlayVoice } from "./PlayVoice";

type Props = { entrance: Entrance; members: Member[]; variant: "elder" | "family" };

export function EntranceView({ entrance, members, variant }: Props) {
  const { quote } = entrance;
  const quoteBy = quote ? (members.find((m) => m.id === quote.speakerMemberId)?.calledAs ?? null) : null;
  return (
    <>
      <figure className="mount">
        <PhotoImage photo={entrance.photo} focus={entrance.focus} />
        {quote && (
          <figcaption>
            <blockquote className="told">{quote.text}</blockquote>
            {quoteBy && <span className="who">{quoteBy}</span>}
            {quote.audioUrl &&
              (variant === "elder" ? (
                // ボタンは一語のひらがな。誰の声かと長さはそばの補助の文に出す
                <div className="read-aloud">
                  <PlayVoice src={quote.audioUrl} label={words.elder.listen} stopLabel={words.elder.stopVoice} />
                  <span className="who">{words.elder.listenNote(quoteBy, voiceLength(quote.durationMs))}</span>
                </div>
              ) : (
                <PlayVoice
                  src={quote.audioUrl}
                  label={words.home.listenTo(quoteBy, voiceLength(quote.durationMs))}
                  stopLabel={words.home.stopVoice}
                />
              ))}
          </figcaption>
        )}
      </figure>
      <div className="stack">
        <p className="question">{entrance.question ?? words.fixedQuestion}</p>
        {/* 読み上げは祖父母の画面だけ（0019） */}
        {variant === "elder" && entrance.questionAudioUrl && (
          <div className="read-aloud">
            <PlayVoice src={entrance.questionAudioUrl} label={words.elder.readAloud} stopLabel={words.elder.stopVoice} icon="speaker" />
            <span className="who">{words.elder.readAloudNote}</span>
          </div>
        )}
      </div>
    </>
  );
}
