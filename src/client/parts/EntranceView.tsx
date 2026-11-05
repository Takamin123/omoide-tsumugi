// 入り口の表示: 写真（白い台紙に貼る形）、添える家族の言葉（紙の色の箱に、話者の呼ばれ方つき。0059。声なら本人の録音を聞ける）、問いかけ一つ。
// 問いかけが null（固定の入り口）のときは、クライアントの固定の一文を出す。
// 問いかけの読み上げは、音声があるときだけ。自動では流さず、そばに常に明示の文を出す（0019、0027）。
import type { ReactNode } from "react";
import type { Entrance, Member } from "../../shared/api";
import { formatPlace, formatTakenDate, voiceLength } from "../lib/pure";
import { words } from "../words";
import { ZoomablePhoto } from "./ZoomablePhoto";
import { PlayVoice } from "./PlayVoice";
import { SpeakerMark } from "./SpeakerMark";

type Props = {
  entrance: Entrance;
  members: Member[];
  variant: "elder" | "family";
  /** 問いかけのカードの中、問いかけの下に置くもの（「送りました」と答えるボタン。0059） */
  children?: ReactNode;
};

export function EntranceView({ entrance, members, variant, children }: Props) {
  const { quote } = entrance;
  const w = words.screen[variant];
  const quoteBy = quote ? (members.find((m) => m.id === quote.speakerMemberId)?.calledAs ?? null) : null;
  // 写真に付いている記録（撮影日・場所）。なければ出さない（「なし」は出さない。0047）
  const taken = formatTakenDate(entrance.photo.takenAt);
  const place = formatPlace(entrance.photo.place);
  return (
    <>
      <figure className="mount card-soft">
        {/* 押すと写真の全体を大きく見られる（祖父母の画面でも。0040） */}
        <ZoomablePhoto photo={entrance.photo} focus={entrance.focus} variant={variant} />
        {(taken || place || quote) && (
          <figcaption>
            {/* 写真の記録: 撮影日、場所の順。前置き・印・地図は付けない（推測ではなく写真の記録として。0047） */}
            {(taken || place) && (
              <p className="photo-facts">
                {taken && <span>{taken}</span>}
                {place && <span>{place}</span>}
              </p>
            )}
            {quote && (
              // 添える家族の言葉は、紙の色の箱に話者名・本文・聞くをまとめる（0059）
              <div className="paper quote">
                {quoteBy && (
                  <span className="who quote-by">
                    <SpeakerMark memberId={quote.speakerMemberId} />
                    {quoteBy}
                  </span>
                )}
                <blockquote className="told">{quote.text}</blockquote>
                {quote.audioUrl && (
                  // ボタンは一語（祖父母「聞く」、家族「聞く」）。誰の声かと長さはそばの補助の文に出す（0045）
                  <div className="read-aloud">
                    <PlayVoice src={quote.audioUrl} label={w.listen} stopLabel={w.stopVoice} name={w.listenName(quoteBy)} />
                    <span className="who">{w.listenNote(quoteBy, voiceLength(quote.durationMs))}</span>
                  </div>
                )}
              </div>
            )}
          </figcaption>
        )}
      </figure>
      {/* 問いかけと答えるボタンを一枚のカードに（0059）。先頭に見出し「今日の問いかけ」（固定の入り口でも出す。0061） */}
      <section className="card-soft ask">
        {/* 見出しの行: 左に見出し、右に読み上げ（祖父母の画面だけ。0019）とそばの注。入らなければ読み上げを次の行へ（人間の提案 2026-11-05。0059） */}
        <div className="ask-top">
          <p className="ask-head">{words.home.questionHeading}</p>
          {variant === "elder" && entrance.questionAudioUrl && (
            <div className="read-aloud">
              <span className="who">{words.elder.readAloudNote}</span>
              <PlayVoice src={entrance.questionAudioUrl} label={words.elder.readAloud} stopLabel={words.elder.stopVoice} icon="speaker" />
            </div>
          )}
        </div>
        <p className="question">{entrance.question ?? words.fixedQuestion}</p>
        {children}
      </section>
    </>
  );
}
