// 開発用（運営）の記録の画面: 日付と人で見る（案 A）。人ごとに「材料にした語り → 今日の入り口 → 返ってきた語り」を三列で並べる。
import { useId, useRef, useState, type MouseEvent } from "react";
import type { OpsEntrance, OpsFamilyRecord, OpsNarration, OpsPhoto } from "../../shared/ops";
import { CleanedNote, Facts, OpsPhotoImage, TranscriptText } from "./parts";
import {
  entrancesOn,
  headSegments,
  inputNarrations,
  jstDateTime,
  monthDay,
  NARRATION_HEAD_CHARS,
  repliesTo,
  type InputNarration,
} from "./record";

export type Names = {
  /** 呼び名。分からなければ（不明） */
  who: (memberId: string | null) => string;
  role: (memberId: string) => string;
};

/** 語りの記録（写真で見る、の時系列の中）へ移る */
export type GoNarration = (n: OpsNarration) => void;
export type NarrationHref = (n: OpsNarration) => string;

const kindLabel = (n: OpsNarration) => (n.kind === "voice" ? "声" : "文字");

export function DateView({
  record,
  date,
  names,
  goNarration,
  narrationHref,
  photoHref,
  goPhoto,
}: {
  record: OpsFamilyRecord;
  date: string;
  names: Names;
  goNarration: GoNarration;
  narrationHref: NarrationHref;
  photoHref: (photoId: string) => string;
  goPhoto: (photoId: string) => void;
}) {
  const photoOf = new Map(record.photos.map((p) => [p.id, p]));
  const byId = new Map(record.narrations.map((n) => [n.id, n]));
  const rows = entrancesOn(record, date);
  return (
    <>
      {rows.map((e) => (
        <EntranceRow
          key={e.id}
          e={e}
          photo={photoOf.get(e.photoId) ?? null}
          inputs={inputNarrations(e.guessed.inputNarrationIds, record.narrations, e.told.quote?.narrationId ?? null)}
          replies={repliesTo(record.narrations, e.id)}
          quoteFrom={e.told.quote ? (byId.get(e.told.quote.narrationId) ?? null) : null}
          names={names}
          goNarration={goNarration}
          narrationHref={narrationHref}
          photoHref={photoHref}
          goPhoto={goPhoto}
        />
      ))}
    </>
  );
}

/** 押したら軸を切り替える（新しいタブで開くときは、ふつうのリンクのまま） */
export function onPlainClick(go: () => void) {
  return (ev: MouseEvent<HTMLAnchorElement>) => {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    go();
  };
}

function EntranceRow({
  e,
  photo,
  inputs,
  replies,
  quoteFrom,
  names,
  goNarration,
  narrationHref,
  photoHref,
  goPhoto,
}: {
  e: OpsEntrance;
  photo: OpsPhoto | null;
  inputs: InputNarration[];
  replies: OpsNarration[];
  quoteFrom: OpsNarration | null;
  names: Names;
  goNarration: GoNarration;
  narrationHref: NarrationHref;
  photoHref: (photoId: string) => string;
  goPhoto: (photoId: string) => void;
}) {
  const g = e.guessed;
  const q = e.told.quote;
  const who = names.who(e.memberId);
  return (
    <section className="person" aria-label={`${who} の入り口`}>
      <div className="person-head">
        <h2>{who}</h2>
        <span className="sub">{names.role(e.memberId)}</span>
        {e.kind === "fixed" && <span className="sub">固定の入り口（Claude を使っていません）</span>}
        <span className="sub push">{e.shownAt === null ? "まだ開いていません" : `${jstDateTime(e.shownAt)} に開いた`}</span>
      </div>

      <div className="cols">
        <div className="col">
          <h3>1. 材料にした語り</h3>
          {inputs.length === 0 && <p className="sub">材料にした語りはありません。</p>}
          {inputs.map((it, i) => (
            <InputChip
              key={`${i}-${it.id}`}
              item={it}
              names={names}
              goNarration={goNarration}
              narrationHref={narrationHref}
            />
          ))}
        </div>

        <div className="col col-main">
          <h3>2. 今日の入り口</h3>
          <div className="entrance">
            {photo ? (
              <figure className="entrance-photo">
                <OpsPhotoImage photo={photo} frames={g.focus ? [{ rect: g.focus }] : []} alt={`${who} の入り口の写真`} />
                <figcaption className="sub">
                  {g.focus ? "点線の枠から見せた" : "写真の全体を見せた"}
                  <br />
                  <a className="go" href={photoHref(photo.id)} onClick={onPlainClick(() => goPhoto(photo.id))}>
                    この写真がたどったこと
                  </a>
                </figcaption>
              </figure>
            ) : (
              <p className="sub">写真が見つかりません。</p>
            )}
            <div className="shown">
              <p className="question">{g.question ?? "（固定の一文）"}</p>
              {q && (
                <figure className="told quote">
                  {q.shownText === null ? (
                    <p className="sub">引用を取り出せませんでした（家族の画面には出ていません）。</p>
                  ) : (
                    <blockquote className="told-text">{q.shownText}</blockquote>
                  )}
                  <figcaption>
                    {names.who(q.speakerMemberId)}
                    {quoteFrom ? `、${monthDay(quoteFrom.forDate)} に${kindLabel(quoteFrom)}で` : ""}
                  </figcaption>
                  {q.rawText !== null && q.rawText !== q.shownText && (
                    <details className="raw">
                      <summary>引いた範囲を印のまま見る</summary>
                      <p className="told-text">{q.rawText}</p>
                    </details>
                  )}
                </figure>
              )}
            </div>
          </div>
          {e.kind === "claude" && (
            <details className="guessed">
              <summary>この一枚と問いを選んだ理由</summary>
              <p>{g.reason ?? "（理由は残っていません）"}</p>
              <Facts
                rows={[
                  ["モデル", g.model],
                  ["プロンプトの版", g.promptVersion],
                  [
                    "トークン",
                    g.inputTokens === null && g.outputTokens === null
                      ? null
                      : `入力 ${g.inputTokens?.toLocaleString("ja-JP") ?? "-"}、出力 ${g.outputTokens?.toLocaleString("ja-JP") ?? "-"}`,
                  ],
                  ["引用の範囲", q ? (q.start === null ? "全文" : `${q.start}〜${q.end} 字目`) : null],
                  ["どこから見せたか", g.focus ? `左 ${pct(g.focus.x)}、上 ${pct(g.focus.y)}、幅 ${pct(g.focus.w)}、高さ ${pct(g.focus.h)}` : "全体"],
                ]}
              />
            </details>
          )}
        </div>

        <div className="col">
          <h3>3. 返ってきた語り</h3>
          {replies.length === 0 && <p className="sub">まだ返事はありません。</p>}
          {replies.map((n) => (
            <div className="reply" key={n.id}>
              <div className="told">
                <p className="told-head">
                  {names.who(n.speakerMemberId)} {kindLabel(n)}
                  {n.hasAudio ? "（録音あり）" : ""}
                </p>
                <TranscriptText n={n} />
              </div>
              <CleanedNote n={n} />
              <a className="go sub" href={narrationHref(n)} onClick={onPlainClick(() => goNarration(n))}>
                この語りの記録を開く
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * 材料にした語り。マウスを乗せると開き、クリック・タップで開いたままにする（もう一度で閉じる）。
 * タッチでは pointerenter のあとに click が続くので、乗せて開くのはポインタが mouse のときだけにする
 */
function InputChip({
  item,
  names,
  goNarration,
  narrationHref,
}: {
  item: InputNarration;
  names: Names;
  goNarration: GoNarration;
  narrationHref: NarrationHref;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const n = item.narration;
  if (!n) {
    return (
      <div className="chip missing">
        <p className="sub">見つからない語り</p>
        <p className="ids">{item.id}</p>
      </div>
    );
  }
  const open = hover || pinned;
  const head = n.transcript ? headSegments([{ text: n.transcript, uncertain: false }], NARRATION_HEAD_CHARS) : null;
  return (
    <div
      className="chip-wrap"
      onPointerEnter={(ev) => ev.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(ev) => ev.pointerType === "mouse" && setHover(false)}
      onKeyDown={(ev) => {
        if (ev.key === "Escape" && open) {
          setHover(false);
          setPinned(false);
          // ポップの中から閉じたら、フォーカスをチップに戻す
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="chip told"
        aria-expanded={open}
        aria-controls={panelId}
        ref={buttonRef}
        onClick={() => {
          // 押して開いたままにし、もう一度で閉じる（乗せたままでも閉じる）
          if (pinned) {
            setPinned(false);
            setHover(false);
          } else setPinned(true);
        }}
      >
        <span className="told-head">
          <span>{names.who(n.speakerMemberId)}</span>
          <span>{kindLabel(n)}</span>
          <span>{monthDay(n.forDate)}</span>
          {item.isQuote && <span className="used">今日の言葉に使った</span>}
        </span>
        {head ? (
          <span className="told-text">
            {head.segments.map((s) => s.text).join("")}
            {head.truncated ? "…" : ""}
          </span>
        ) : (
          <span className="sub">{n.transcriptStatus === "failed" ? "文字起こしに失敗しました。" : "文字起こしを待っています。"}</span>
        )}
      </button>
      {open && (
        <div className="pop" id={panelId} role="region" aria-label={`${names.who(n.speakerMemberId)} の語りの全文`}>
          <TranscriptText n={n} />
          <CleanedNote n={n} />
          <a className="go" href={narrationHref(n)} onClick={onPlainClick(() => goNarration(n))}>
            この語りの記録を開く
          </a>
        </div>
      )}
    </div>
  );
}
