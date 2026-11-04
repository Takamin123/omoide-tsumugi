// /photos: 写真を家族に共有する（棚へのまとめ登録。どの写真ともつながらない）。一枚ずつ順に、EXIF → SHA-256 → 縮小 → 送る（lib/upload.ts）
// 下に、自分が共有した写真の数の見出しと小さい写真の一覧（新しい順。押すと拡大の画面 0040）。送り終えたら読み直す。0 枚なら出さない（0053）
import { useCallback, useEffect, useRef, useState } from "react";
import type { Member, Photo } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { emptyTally, tallyOne, type UploadTally } from "../lib/pure";
import { navigate } from "../lib/route";
import { shelfOutcome, uploadOne } from "../lib/upload";
import { ErrorLine } from "../parts/ErrorLine";
import { ZoomablePhoto } from "../parts/ZoomablePhoto";
import { words } from "../words";

export function AddPhotos({ me }: { me: Member }) {
  const [tally, setTally] = useState<UploadTally | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = words.photos;
  const mine = useMyPhotos(me.id);

  async function onPick(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    let t = emptyTally(files.length);
    setTally(t);
    try {
      for (const file of files) {
        t = tallyOne(t, shelfOutcome(await uploadOne(file, undefined)));
        setTally(t);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      // 送り終えたら（途中で失敗しても）、共有した写真の数と一覧を読み直す
      mine.reload();
    }
  }

  return (
    <main className="stack">
      <nav className="top">
        <button type="button" onClick={() => navigate("/")} disabled={busy}>
          {words.home.menuHome}
        </button>
      </nav>
      <h1>{w.title}</h1>
      <label className={`button primary${busy ? " disabled" : ""}`} aria-disabled={busy}>
        {w.pick}
        <input
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void onPick(files);
          }}
        />
      </label>
      {tally && (
        <div className="stack" aria-live="polite">
          <p>{w.progress(tally.done, tally.total)}</p>
          <progress max={tally.total} value={tally.done} style={{ width: "100%", height: "1.5rem" }} />
          {!busy && (
            <>
              {tally.added > 0 && (
                <>
                  <p className="sub">{w.added(tally.added)}</p>
                  <p className="sub">{w.delivery}</p>
                </>
              )}
              {tally.duplicate > 0 && <p className="sub">{w.duplicate(tally.duplicate)}</p>}
              {tally.unreadable > 0 && <p className="sub">{w.unreadable(tally.unreadable)}</p>}
              {tally.failed > 0 && <p className="sub">{w.failed(tally.failed)}</p>}
            </>
          )}
        </div>
      )}
      <ErrorLine text={error} />
      <SharedPhotos photos={mine.photos} />
    </main>
  );
}

/**
 * 自分が共有した写真（GET /api/photos を持ち主で絞る）。新しい順（サーバーは登録の古い順で返す）。
 * 読めなかったら前の一覧のまま（文を出さない）。後から届いた古い読み込みは捨てる
 */
function useMyPhotos(memberId: string) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    api
      .listPhotos(memberId)
      .then((r) => {
        if (n === seq.current) setPhotos(newestFirst(r.photos));
      })
      .catch(() => {});
  }, [memberId]);
  useEffect(() => {
    reload();
    return () => {
      seq.current++;
    };
  }, [reload]);
  return { photos, reload };
}

/** 登録の古い順の一覧を、新しい順に */
export const newestFirst = (photos: readonly Photo[]): Photo[] => [...photos].reverse();

/** 共有した写真の見出し（数）と小さい写真の一覧。0 枚なら何も出さない（0053） */
export function SharedPhotos({ photos }: { photos: readonly Photo[] }) {
  if (photos.length === 0) return null;
  return (
    <section className="stack">
      <h2>{words.photos.shared(photos.length)}</h2>
      <div className="shared-photos">
        {photos.map((p) => (
          <div key={p.id} className="shared-photo">
            <ZoomablePhoto photo={p} variant="family" lazy />
          </div>
        ))}
      </div>
    </section>
  );
}
