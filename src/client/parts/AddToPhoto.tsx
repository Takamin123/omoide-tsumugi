// 「この写真に追加する」（0048）。アルバムの各写真の節の末尾に置く（家族の画面だけ。祖父母の画面には描かない）。
// 上から: 追加した写真の列（48px 角。押すと拡大の画面 0040。文・見出しなし。0 枚なら出さない）→ 送っている間の進み具合／終わった後の数と「はずす」
// → 「この写真に追加する」（押すとその場で写真を選ぶ。送っている間は押せない）。
// 一枚ずつ順に送る（lib/upload.ts。写真を家族に共有する画面と同じ道）。10 枚を超えたら一枚も送らず一行。
// 数え方と失敗の見せ方は 0049。「はずす」は今回つないだ分だけを外す。タブを離れると部品ごと外れ、「はずす」は出なくなる。
import { useEffect, useRef, useState } from "react";
import { MAX_ADD_TO_PHOTO, type Photo } from "../../shared/api";
import { errorText } from "../lib/errors";
import { addToPhoto, removeLinked, type AddToPhotoProgress, type LinkedPhoto } from "../lib/upload";
import { words } from "../words";
import { ErrorLine } from "./ErrorLine";
import { ZoomablePhoto } from "./ZoomablePhoto";

type Props = {
  photoId: string;
  /** サーバーが返した、この写真に追加された写真（/api/feed の addedPhotos） */
  addedPhotos: Photo[];
  /** 送り終えた・外した後（一覧を読み直す） */
  onChanged: () => void;
};

export function AddToPhoto({ photoId, addedPhotos, onChanged }: Props) {
  const [progress, setProgress] = useState<AddToPhotoProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 外した写真。読み直した一覧に残っていても出さない（サーバーが追いつくまで） */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function onPick(files: File[]) {
    if (files.length === 0 || busy) return;
    // 多すぎるときは何も送らないので、前の回の数と「はずす」は残す
    if (files.length > MAX_ADD_TO_PHOTO) {
      setError(null);
      setLimit(true);
      return;
    }
    setError(null);
    setLimit(false);
    setProgress(null);
    setRemoved(new Set());
    setBusy(true);
    try {
      const r = await addToPhoto(files, photoId, (p) => alive.current && setProgress(p));
      if (r.kind === "limit") setLimit(true);
      else onChanged();
    } catch (e) {
      setError(errorText(e));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    const linked = progress?.linked ?? [];
    if (busy || linked.length === 0) return;
    setBusy(true);
    setError(null);
    const { left, error: e } = await removeLinked(linked);
    const gone = linked.filter((l) => !left.includes(l));
    setRemoved((s) => new Set([...s, ...gone.map((l) => l.photo.id)]));
    // 全部外せたら、数の文と「はずす」も消す。残ったら残った分の「はずす」を残す
    setProgress(left.length === 0 ? null : (p) => (p ? { ...p, linked: left } : p));
    if (e) setError(errorText(e));
    setBusy(false);
    onChanged();
  }

  const fresh = new Set((progress?.linked ?? []).map((l) => l.photo.id));
  const seen = new Set<string>();
  const shown: Photo[] = [];
  for (const p of [...addedPhotos, ...(progress?.linked ?? []).map((l) => l.photo)]) {
    if (seen.has(p.id) || removed.has(p.id)) continue;
    seen.add(p.id);
    shown.push(p);
  }

  return (
    <AddToPhotoView
      shown={shown}
      fresh={fresh}
      progress={progress}
      busy={busy}
      limit={limit}
      error={error}
      onPick={(files) => void onPick(files)}
      onRemove={() => void onRemove()}
    />
  );
}

type ViewProps = {
  /** 列に並べる写真（古く足した順） */
  shown: Photo[];
  /** 今回つないだ写真の ID（現れる動きを付ける） */
  fresh: ReadonlySet<string>;
  progress: AddToPhotoProgress | null;
  busy: boolean;
  limit: boolean;
  error: string | null;
  onPick: (files: File[]) => void;
  onRemove: () => void;
};

/** 状態を受けて描くだけの見た目（テストは各段をこれで描いて確かめる） */
export function AddToPhotoView({ shown, fresh, progress, busy, limit, error, onPick, onRemove }: ViewProps) {
  const w = words.home;
  const p = words.photos;
  const [pressed, setPressed] = useState(false);
  const tally = progress?.tally;
  const sending = busy && !!tally && tally.done < tally.total;
  const linked: LinkedPhoto[] = progress?.linked ?? [];
  return (
    <div className="add-to-photo">
      {shown.length > 0 && (
        <div className="added-photos" role="group" aria-label={w.addedPhotosLabel}>
          {shown.map((ph) => (
            <div key={ph.id} className={fresh.has(ph.id) ? "added-photo fresh" : "added-photo"}>
              <ZoomablePhoto photo={ph} variant="family" />
            </div>
          ))}
        </div>
      )}
      <div className="add-status" aria-live="polite">
        {tally && sending && (
          <>
            <p className="sub">{p.progress(tally.done, tally.total)}</p>
            <progress className="add-progress" max={tally.total} value={tally.done} />
          </>
        )}
        {tally && !sending && (
          <>
            {tally.added > 0 && linked.length > 0 && <p className="sub">{w.addedCount(linked.length)}</p>}
            {tally.duplicate > 0 && <p className="sub">{p.duplicate(tally.duplicate)}</p>}
            {tally.unreadable > 0 && <p className="sub">{p.unreadable(tally.unreadable)}</p>}
            {tally.failed > 0 && <p className="sub">{p.failed(tally.failed)}</p>}
          </>
        )}
      </div>
      {limit && <p role="alert" className="add-limit">{w.addLimit}</p>}
      {tally && !sending && linked.length > 0 && (
        <button type="button" className="aux" disabled={busy} onClick={onRemove}>
          {w.removeAdded}
        </button>
      )}
      <ErrorLine text={error} />
      {/* 押すとその場で写真を選ぶ。送っている間は押せない（見た目も変える） */}
      <label
        className={`button aux add-pick${busy ? " disabled" : ""}`}
        aria-disabled={busy || undefined}
        data-pressed={(pressed && !busy) || undefined}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {w.addToPhoto}
        <input
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            onPick(files);
          }}
        />
      </label>
    </div>
  );
}
