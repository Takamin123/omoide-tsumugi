// 開発用（運営）の記録の画面: 写真で見る（案 B）。一枚の写真について、入り口になったことと語られたことを時系列で並べる。
import type { OpsEntrance, OpsFamilyRecord, OpsNarration, OpsPhoto } from "../../shared/ops";
import { onPlainClick, type Names } from "./DateView";
import { CleanedNote, Facts, OpsPhotoImage, TranscriptText } from "./parts";
import {
  jstDateTime,
  monthDay,
  narrationAnchor,
  photoEvents,
  seconds,
  takenDate,
  type PhotoUsage,
} from "./record";

export function PhotoView({
  record,
  photoId,
  usage,
  names,
  photoHref,
  goPhoto,
}: {
  record: OpsFamilyRecord;
  photoId: string;
  usage: ReadonlyMap<string, PhotoUsage>;
  names: Names;
  photoHref: (photoId: string) => string;
  goPhoto: (photoId: string) => void;
}) {
  const photo = record.photos.find((p) => p.id === photoId) ?? null;
  return (
    <div className="photo-axis">
      <nav className="photo-list" aria-label="写真の一覧">
        <h2>写真 {record.photos.length} 枚</h2>
        {record.photos.map((p) => {
          const u = usage.get(p.id);
          const count =
            !u || u.entrances + u.narrations === 0 ? "まだ使っていません" : `入り口 ${u.entrances}、語り ${u.narrations}`;
          return (
            <a
              key={p.id}
              href={photoHref(p.id)}
              aria-current={p.id === photoId ? "page" : undefined}
              onClick={onPlainClick(() => goPhoto(p.id))}
            >
              <OpsPhotoImage photo={p} frames={[]} alt="" className="thumb" />
              <span className="photo-list-text">
                <span className="photo-list-name">
                  {names.who(p.ownerMemberId)}の写真{p.takenAt ? `、${takenDate(p.takenAt)}` : ""}
                </span>
                <span className="sub">{count}</span>
              </span>
            </a>
          );
        })}
      </nav>
      {photo ? <PhotoHistory record={record} photo={photo} names={names} /> : <p className="sub">写真はまだありません。</p>}
    </div>
  );
}

function PhotoHistory({ record, photo, names }: { record: OpsFamilyRecord; photo: OpsPhoto; names: Names }) {
  const events = photoEvents(record, photo.id);
  const guesses = record.photoGuesses.filter((g) => g.photoId === photo.id);
  // 枠が重なると名札も重なるので、枠には番号だけを付け、名札（日付と人）は写真の下に一覧で出す
  const framed = events.flatMap((ev) =>
    ev.type === "entrance" && ev.entrance.guessed.focus ? [{ entrance: ev.entrance, rect: ev.entrance.guessed.focus }] : [],
  );
  const frameNo = new Map(framed.map((f, i) => [f.entrance.id, i + 1]));
  const frames = framed.map((f, i) => ({ rect: f.rect, label: String(i + 1), ...badgePlace(framed, i) }));
  const byId = new Map(record.narrations.map((n) => [n.id, n]));
  return (
    <div className="photo-main">
      <section className="photo-top" aria-label="写真">
        <figure className="photo-big">
          <OpsPhotoImage photo={photo} frames={frames} alt={`${names.who(photo.ownerMemberId)}の写真`} />
          <figcaption className="sub">
            点線の枠は、その日の入り口で最初に見せた範囲です。
            {framed.length > 0 && (
              <ol className="frame-names">
                {framed.map((f, i) => (
                  <li key={f.entrance.id}>
                    <span className="frame-no">{i + 1}</span>
                    {monthDay(f.entrance.forDate)} {names.who(f.entrance.memberId)}
                  </li>
                ))}
              </ol>
            )}
          </figcaption>
        </figure>
        <div className="photo-side">
          <Facts
            rows={[
              ["持ち主", names.who(photo.ownerMemberId)],
              ["撮影日", photo.takenAt ? takenDate(photo.takenAt) : "なし"],
              ["登録", jstDateTime(photo.createdAt)],
            ]}
          />
          <div className="guessed">
            <h3 className="guessed-head">Claude による写真の説明</h3>
            {guesses.length === 0 && <p className="sub">説明はまだありません。</p>}
            {guesses.map((g) => (
              <div key={g.id}>
                <p className="pre">{g.description}</p>
                <Facts
                  rows={[
                    ["モデル", g.model],
                    ["プロンプトの版", g.promptVersion],
                  ]}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="history" aria-labelledby="photo-history">
        <h2 id="photo-history">この写真がたどったこと</h2>
        {events.length === 0 && <p className="sub">まだ入り口にも、語りにもなっていません。</p>}
        <ol>
          {events.map((ev) =>
            ev.type === "entrance" ? (
              <EntranceEvent key={ev.entrance.id} e={ev.entrance} names={names} byId={byId} frameNo={frameNo.get(ev.entrance.id) ?? null} />
            ) : (
              <NarrationEvent key={ev.narration.id} n={ev.narration} names={names} />
            ),
          )}
        </ol>
      </section>
    </div>
  );
}

/**
 * 番号の札を置く所。左上が近い枠どうしは、最初の枠の左上に札を横に並べる（「3 4」のように）。
 * labelAt は写真に対する割合、offset はそこから右へ何枚ぶん送るか
 */
function badgePlace(
  framed: readonly { rect: { x: number; y: number } }[],
  i: number,
): { labelAt: { x: number; y: number }; offset: number } {
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.08 && Math.abs(a.y - b.y) < 0.08;
  const lead = (k: number): number => {
    const j = framed.slice(0, k).findIndex((f) => near(f.rect, framed[k]!.rect));
    return j === -1 ? k : lead(j);
  };
  const me = lead(i);
  const offset = framed.slice(0, i).filter((_, k) => lead(k) === me).length;
  const at = framed[me]!.rect;
  return { labelAt: { x: at.x, y: at.y }, offset };
}

function EntranceEvent({
  e,
  names,
  byId,
  frameNo,
}: {
  e: OpsEntrance;
  names: Names;
  byId: ReadonlyMap<string, OpsNarration>;
  frameNo: number | null;
}) {
  const g = e.guessed;
  const q = e.told.quote;
  const from = q ? (byId.get(q.narrationId) ?? null) : null;
  const title = `${names.who(e.memberId)}の入り口になった${
    e.kind === "fixed" ? "（固定の入り口）" : q ? `（${names.who(q.speakerMemberId)}の言葉を添えた）` : ""
  }`;
  return (
    <li>
      <span className="when">{monthDay(e.forDate)}</span>
      <div className="what">
        <h3>{title}</h3>
        <p className="sub">
          {frameNo !== null ? `写真の枠 ${frameNo}。` : ""}
          {e.shownAt === null ? "まだ開いていません" : `${jstDateTime(e.shownAt)} に開いた`}
        </p>
        <div className="pair">
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
                  {from ? `、${monthDay(from.forDate)} に${from.kind === "voice" ? "声" : "文字"}で` : ""}
                </figcaption>
              </figure>
            )}
          </div>
          {e.kind === "claude" && (
            <div className="guessed">
              <p className="guessed-head">選んだ理由</p>
              <p>{g.reason ?? "（理由は残っていません）"}</p>
              <Facts
                rows={[
                  ["モデル", g.model],
                  ["プロンプトの版", g.promptVersion],
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function NarrationEvent({ n, names }: { n: OpsNarration; names: Names }) {
  const how = n.kind === "voice" ? "声" : "文字";
  const extra = [n.durationMs !== null ? seconds(n.durationMs) : null, n.hasAudio ? "録音あり" : null].filter(Boolean).join("、");
  return (
    <li id={narrationAnchor(n.id)} tabIndex={-1}>
      {/* 日付は語りの日（forDate）。デモの家族では時計を進めるので、実際の時刻と並べない */}
      <span className="when">{monthDay(n.forDate)}</span>
      <div className="what">
        <h3>
          {names.who(n.speakerMemberId)}が{how}で語った{extra ? `（${extra}）` : ""}
        </h3>
        <div className="told">
          <TranscriptText n={n} />
        </div>
        <CleanedNote n={n} />
      </div>
    </li>
  );
}
