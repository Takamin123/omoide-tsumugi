// /photos: 写真を家族に共有する（棚へのまとめ登録。どの写真ともつながらない）。一枚ずつ順に、EXIF → SHA-256 → 縮小 → 送る（lib/upload.ts）
import { useState } from "react";
import { errorText } from "../lib/errors";
import { emptyTally, tallyOne, type UploadTally } from "../lib/pure";
import { navigate } from "../lib/route";
import { shelfOutcome, uploadOne } from "../lib/upload";
import { ErrorLine } from "../parts/ErrorLine";
import { words } from "../words";

export function AddPhotos() {
  const [tally, setTally] = useState<UploadTally | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = words.photos;

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
    </main>
  );
}
