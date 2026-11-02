// 開発用（運営）の記録の画面（/ops/record）の、二つの見方で使う部品。家族の画面からは読み込まない（0025）。
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { OpsNarration, OpsPhoto, OpsRect } from "../../shared/ops";
import { splitMarked, type MarkedSegment } from "./record";

/** 聞き間違いの印を、色と［? ?］と波線で見せる */
export function Marked({ segments }: { segments: readonly MarkedSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.uncertain ? (
          <mark className="uncertain" key={i}>
            ［?{s.text}?］
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** モデル・プロンプトの版・トークンなどの小さな表。値のない行は出さない */
export function Facts({ rows }: { rows: readonly (readonly [string, ReactNode | null | undefined])[] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="facts">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 家族が語ったそのまま（transcript）。文字起こしがまだ・失敗のときは、その旨だけ */
export function TranscriptText({ n }: { n: OpsNarration }) {
  if (n.transcript) return <p className="told-text">{n.transcript}</p>;
  return <p className="sub">{n.transcriptStatus === "failed" ? "文字起こしに失敗しました。" : "文字起こしを待っています。"}</p>;
}

/** Claude の整形と聞き間違いの印。閉じておき、開くと印の部分を［? ?］つきで見せる（推測の側。点線の枠） */
export function CleanedNote({ n }: { n: OpsNarration }) {
  if (!n.cleaned) return null;
  const marked = splitMarked(n.cleaned.text, n.cleaned.uncertainSpans);
  const spans = n.cleaned.uncertainSpans;
  const summary =
    spans === null
      ? "Claude が読みやすく整えました。聞き間違いの印は読めません。"
      : marked.broken
        ? "Claude が読みやすく整えました。聞き間違いの印の範囲が壊れています。"
        : `Claude が読みやすく整えました。聞き間違いの印は ${spans.length} か所です。`;
  return (
    <details className="guessed small">
      <summary>{summary}</summary>
      {/* 整えた文は Claude の出力なので、明朝（家族が語った言葉）にしない */}
      <p className="pre">
        <Marked segments={marked.segments} />
      </p>
      <p className="sub">
        {marked.broken
          ? "家族の画面には、文字起こしのまま出ます。"
          : "［? ?］で囲んだ部分は、家族の画面では「……」になります。"}
      </p>
      <Facts
        rows={[
          ["モデル", n.cleaned.model],
          ["プロンプトの版", n.cleaned.promptVersion],
        ]}
      />
    </details>
  );
}

// ---- 写真（鍵を Authorization に付けて読み、blob の URL で出す。img の src に鍵を載せない） ----

/** 一度読んだ写真を、画面の間で使い回す。開いている家族と鍵が変わったら作り直し、古い blob の URL は捨てる */
export class PhotoCache {
  private readonly loads = new Map<string, Promise<string>>();
  private readonly made: string[] = [];
  private closed = false;
  constructor(private readonly opsKey: string) {}

  get(url: string): Promise<string> {
    const hit = this.loads.get(url);
    if (hit) return hit;
    const p = (async () => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.opsKey}` },
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const blobUrl = URL.createObjectURL(await res.blob());
      if (this.closed) {
        URL.revokeObjectURL(blobUrl);
        throw new Error("closed");
      }
      this.made.push(blobUrl);
      return blobUrl;
    })();
    // 失敗したものは覚えない（次に開いたときに読み直す）
    p.catch(() => this.loads.delete(url));
    this.loads.set(url, p);
    return p;
  }

  close(): void {
    this.closed = true;
    for (const u of this.made) URL.revokeObjectURL(u);
    this.made.length = 0;
    this.loads.clear();
  }
}

export const PhotoCacheContext = createContext<PhotoCache | null>(null);

function usePhotoUrl(imageUrl: string): { url: string | null; failed: boolean } {
  const cache = useContext(PhotoCacheContext);
  const [state, setState] = useState<{ for: string; cache: PhotoCache | null; url: string | null; failed: boolean }>({
    for: imageUrl,
    cache,
    url: null,
    failed: false,
  });
  useEffect(() => {
    if (!cache) return;
    let alive = true;
    cache.get(imageUrl).then(
      (url) => alive && setState({ for: imageUrl, cache, url, failed: false }),
      () => alive && setState({ for: imageUrl, cache, url: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [cache, imageUrl]);
  // 作り直した使い回し（古い blob の URL は捨てた後）の前の結果は使わない
  return state.for === imageUrl && state.cache === cache ? state : { url: null, failed: false };
}

/** label は札。labelAt（写真に対する割合。省くと枠の左上）から、右へ offset 枚ぶん送って置く */
export type FocusFrame = { rect: OpsRect; label?: string; labelAt?: { x: number; y: number }; offset?: number };

/** 写真に、最初に見せた範囲（focus）の点線の枠を重ねる。写真の縦横比で場所を先に取る（読み込み中に位置がずれない） */
export function OpsPhotoImage({
  photo,
  frames,
  alt,
  className,
}: {
  photo: OpsPhoto;
  frames: readonly FocusFrame[];
  alt: string;
  className?: string;
}) {
  const { url, failed } = usePhotoUrl(photo.imageUrl);
  const ratio = photo.width > 0 && photo.height > 0 ? `${photo.width} / ${photo.height}` : "4 / 3";
  return (
    <div className={`photo ${className ?? ""}`} style={{ aspectRatio: ratio }}>
      {url ? <img src={url} alt={alt} /> : <span className="sub">{failed ? "写真を読み込めませんでした。" : "写真を読み込んでいます"}</span>}
      {frames.map((f, i) => (
        <span
          key={i}
          className="focus"
          style={{
            left: `${f.rect.x * 100}%`,
            top: `${f.rect.y * 100}%`,
            width: `${f.rect.w * 100}%`,
            height: `${f.rect.h * 100}%`,
          }}
        />
      ))}
      {frames.map((f, i) =>
        f.label ? (
          <span
            key={`label-${i}`}
            className="focus-label"
            style={{
              left: `calc(${(f.labelAt ?? f.rect).x * 100}% + ${(f.offset ?? 0) * 1.75}rem)`,
              top: `${(f.labelAt ?? f.rect).y * 100}%`,
            }}
          >
            {f.label}
          </span>
        ) : null,
      )}
    </div>
  );
}
