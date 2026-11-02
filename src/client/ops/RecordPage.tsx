// 開発用（運営）の記録の画面（/ops/record）。見るのは運営と開発だけ。家族の画面からはつながない（0017、0024）。
// 家族向けの画面ではないので、言葉は words.ts に入れずここに置く（0014 と同じ考え方）。
// 家族が語ったもの（出所つき）と、Claude が決めたこと・推測を、見出しと枠で分ける。
import { useEffect, useState, type FormEvent } from "react";
import type { OpsEntrance, OpsFamilyRecord, OpsNarration, OpsPhoto, OpsRect } from "../../shared/ops";
import { fetchRecord, loadOpsKey, saveOpsKey, splitMarked } from "./record";

/** このページだけの見た目。ふだんの画面の styles.css には入れない */
const opsCss = `
.ops { font-size: 1rem; max-width: 56rem; }
.ops h1 { font-size: 1.4rem; }
.ops h2 { font-size: 1.2rem; margin-top: 1.5rem; border-bottom: 2px solid #444; }
.ops h3 { font-size: 1.05rem; }
.ops h4 { font-size: 0.95rem; margin: 0 0 0.3rem; }
.ops input, .ops button { font-size: 1rem; min-height: 2.75rem; }
.ops form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.ops form input { flex: 1; min-width: 12rem; }
.ops .card { border: 1px solid #999; border-radius: 0.5rem; padding: 0.6rem; margin: 0.8rem 0; background: #fff; }
.ops .told { border: 2px solid #2b6a3a; border-radius: 0.4rem; padding: 0.5rem; margin: 0.5rem 0; background: #f2f8f3; }
.ops .guessed { border: 2px dashed #7a3f99; border-radius: 0.4rem; padding: 0.5rem; margin: 0.5rem 0; background: #f8f3fb; }
.ops .meta { font-size: 0.85rem; color: #444; }
.ops .ids { font-family: ui-monospace, monospace; font-size: 0.8rem; word-break: break-all; }
.ops pre { white-space: pre-wrap; word-break: break-word; margin: 0.3rem 0; font-family: inherit; }
.ops mark.uncertain { background: #ffe08a; color: inherit; text-decoration: underline wavy #8a5a00; }
.ops .photo-frame { position: relative; display: inline-block; max-width: 100%; }
.ops .photo-frame img { display: block; max-width: 100%; max-height: 24rem; }
.ops .focus { position: absolute; border: 3px solid #fff; outline: 3px dashed #d0002a; box-sizing: border-box; }
.ops .focus span { position: absolute; top: 0; left: 0; background: #d0002a; color: #fff; font-size: 0.75rem; padding: 0 0.25rem; }
.ops .error { color: #a1170f; font-weight: bold; }
.ops .banner { background: #222; color: #fff; padding: 0.4rem 0.6rem; font-weight: bold; position: sticky; top: 0; z-index: 1; }
.ops .shown { border: 1px solid #555; border-radius: 0.4rem; padding: 0.5rem; margin: 0.5rem 0; }
`;

// 鍵が違うときと家族が見つからないときは、同じ言葉にする（家族の ID の有無を探れないように）
const notOpened = "開けませんでした。鍵と家族の ID を確かめてください。";
const reasonText = {
  unauthorized: notOpened,
  not_found: notOpened,
  failed: "読み込めませんでした。",
} as const;

type View =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; record: OpsFamilyRecord }
  | { state: "error"; reason: keyof typeof reasonText };

function familyIdFromQuery(): string {
  try {
    return new URLSearchParams(location.search).get("family") ?? "";
  } catch {
    return "";
  }
}

export default function RecordPage() {
  const [key, setKey] = useState<string | null>(() => loadOpsKey());
  const [keyInput, setKeyInput] = useState("");
  const [familyInput, setFamilyInput] = useState(familyIdFromQuery);
  const [view, setView] = useState<View>({ state: "idle" });

  const open = async (familyId: string, k: string) => {
    setView({ state: "loading" });
    const r = await fetchRecord(familyId, k);
    if (r.ok) {
      setView({ state: "ready", record: r.record });
      // 家族の ID だけを URL に残す（鍵は載せない）
      history.replaceState(null, "", `/ops/record?family=${encodeURIComponent(familyId)}`);
      return;
    }
    if (r.reason === "unauthorized") {
      saveOpsKey(null);
      setKey(null);
    }
    setView({ state: "error", reason: r.reason });
  };

  useEffect(() => {
    const id = familyIdFromQuery();
    if (key && id) void open(id, key);
    // 最初の一回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKey = (e: FormEvent) => {
    e.preventDefault();
    const k = keyInput.trim();
    if (!k) return;
    saveOpsKey(k);
    setKey(k);
    setKeyInput("");
    if (familyInput.trim()) void open(familyInput.trim(), k);
  };

  const onFamily = (e: FormEvent) => {
    e.preventDefault();
    if (key && familyInput.trim()) void open(familyInput.trim(), key);
  };

  return (
    <main className="ops">
      <style>{opsCss}</style>
      <p className="banner">運営・開発用。家族には見せない画面</p>
      <h1>記録</h1>
      <p className="meta">鍵はこのタブの中だけに持ち、タブを閉じると消えます。</p>

      {key === null ? (
        <form onSubmit={onKey}>
          <label htmlFor="ops-key">運営の鍵</label>
          <input
            id="ops-key"
            type="password"
            autoComplete="off"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button type="submit">鍵を入れる</button>
        </form>
      ) : (
        <>
          <form onSubmit={onFamily}>
            <label htmlFor="ops-family">家族の ID</label>
            <input id="ops-family" type="text" value={familyInput} onChange={(e) => setFamilyInput(e.target.value)} />
            <button type="submit">開く</button>
          </form>
          <p>
            <button
              type="button"
              onClick={() => {
                saveOpsKey(null);
                setKey(null);
                setView({ state: "idle" });
              }}
            >
              鍵を消す
            </button>
          </p>
        </>
      )}

      {view.state === "loading" && <p>読み込んでいます</p>}
      {view.state === "error" && (
        <p className="error" role="alert">
          {reasonText[view.reason]}
        </p>
      )}
      {view.state === "ready" && key !== null && <Record record={view.record} opsKey={key} />}
    </main>
  );
}

function Record({ record, opsKey }: { record: OpsFamilyRecord; opsKey: string }) {
  const nameOf = (id: string | null) => {
    if (!id) return "（不明）";
    const m = record.members.find((x) => x.id === id);
    return m ? `${m.calledAs}（${m.relation}）` : "（不明）";
  };
  const photoOf = new Map(record.photos.map((p) => [p.id, p]));
  const guessesByPhoto = new Map<string, typeof record.photoGuesses>();
  for (const g of record.photoGuesses) guessesByPhoto.set(g.photoId, [...(guessesByPhoto.get(g.photoId) ?? []), g]);

  return (
    <>
      <p className="meta ids">
        家族 {record.family.id}
        {record.family.isDemo ? "（デモ）" : ""} ／ 人 {record.members.length} ／ 写真 {record.photos.length} ／ 入り口{" "}
        {record.entrances.length} ／ 語り {record.narrations.length}
      </p>

      <h2>入り口</h2>
      {record.entrances.length === 0 && <p>まだありません。</p>}
      {record.entrances.map((e) => (
        <EntranceCard key={e.id} e={e} photo={photoOf.get(e.photoId) ?? null} nameOf={nameOf} opsKey={opsKey} />
      ))}

      <h2>語り</h2>
      {record.narrations.length === 0 && <p>まだありません。</p>}
      {record.narrations.map((n) => (
        <NarrationCard key={n.id} n={n} nameOf={nameOf} />
      ))}

      <h2>写真の説明（Claude の推測）</h2>
      {record.photos.length === 0 && <p>写真はまだありません。</p>}
      {record.photos.map((p) => (
        <div className="card" key={p.id}>
          <p className="meta ids">
            写真 {p.id} ／ 持ち主 {nameOf(p.ownerMemberId)} ／ 撮影日 {p.takenAt ?? "なし"}
          </p>
          <div className="guessed">
            <h4>Claude の推測（家族には見せない）</h4>
            {(guessesByPhoto.get(p.id) ?? []).length === 0 && <p className="meta">説明はまだありません。</p>}
            {(guessesByPhoto.get(p.id) ?? []).map((g) => (
              <div key={g.id}>
                <pre>{g.description}</pre>
                <p className="meta">
                  {g.model} ／ 版 {g.promptVersion}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function EntranceCard({
  e,
  photo,
  nameOf,
  opsKey,
}: {
  e: OpsEntrance;
  photo: OpsPhoto | null;
  nameOf: (id: string | null) => string;
  opsKey: string;
}) {
  const q = e.told.quote;
  const g = e.guessed;
  return (
    <div className="card">
      <h3>
        {e.forDate} ／ {nameOf(e.memberId)} へ ／ {e.kind === "claude" ? "Claude" : "固定"}
      </h3>
      <p className="meta ids">
        入り口 {e.id} ／ 写真 {e.photoId} ／ 見せた時刻 {e.shownAt === null ? "まだ" : new Date(e.shownAt).toLocaleString()}
      </p>
      {photo && <FocusedPhoto photo={photo} focus={g.focus} opsKey={opsKey} />}

      <div className="shown">
        <h4>家族に見えた形</h4>
        {q?.shownText && (
          <pre>
            「{q.shownText}」— {nameOf(q.speakerMemberId)}
          </pre>
        )}
        <pre>{g.question ?? "（固定の一文）"}</pre>
      </div>

      <div className="told">
        <h4>家族が語ったこと（添えた言葉）</h4>
        {q === null ? (
          <p className="meta">添えた言葉はありません。</p>
        ) : (
          <>
            <p className="meta">
              {nameOf(q.speakerMemberId)} が語った ／ 範囲 {q.start === null ? "全文" : `${q.start}–${q.end}`}
            </p>
            <p className="meta ids">語り {q.narrationId}</p>
            <p className="meta">切り出した文字（印はそのまま）</p>
            <pre>{q.rawText ?? "（取り出せません）"}</pre>
            <p className="meta">家族の画面に出た文字</p>
            <pre>{q.shownText ?? "（引用されません）"}</pre>
          </>
        )}
      </div>

      <div className="guessed">
        <h4>Claude が決めたこと・推測（理由は家族には見せない）</h4>
        <p className="meta">選んだ理由</p>
        <pre>{g.reason ?? "（なし）"}</pre>
        <p className="meta">
          どこから見せたか:{" "}
          {g.focus ? `x ${fmt(g.focus.x)} y ${fmt(g.focus.y)} w ${fmt(g.focus.w)} h ${fmt(g.focus.h)}` : "全体（なし）"}
        </p>
        <p className="meta">
          {g.model ?? "モデルなし"} ／ 版 {g.promptVersion ?? "なし"} ／ トークン 入 {g.inputTokens ?? "-"} 出{" "}
          {g.outputTokens ?? "-"}
        </p>
        <p className="meta ids">材料にした語り: {g.inputNarrationIds?.join(", ") || "なし"}</p>
      </div>
    </div>
  );
}

const fmt = (v: number) => v.toFixed(2);

function NarrationCard({ n, nameOf }: { n: OpsNarration; nameOf: (id: string | null) => string }) {
  const marked = n.cleaned ? splitMarked(n.cleaned.text, n.cleaned.uncertainSpans) : null;
  return (
    <div className="card">
      <p className="meta ids">
        語り {n.id} ／ 写真 {n.photoId}
        {n.entranceId ? ` ／ 入り口 ${n.entranceId}` : ""}
      </p>
      <div className="told">
        <h4>
          家族が語ったこと: {nameOf(n.speakerMemberId)}（{n.kind === "voice" ? "声" : "文字"}
          {n.hasAudio ? "、録音あり" : ""}）
        </h4>
        <p className="meta">
          {n.forDate} ／ 文字起こし {statusText[n.transcriptStatus]}
        </p>
        <p className="meta">そのまま</p>
        <pre>{n.transcript ?? "（まだありません）"}</pre>
      </div>
      {n.kind === "voice" && (
        <div className="guessed">
          <h4>Claude の整形と、聞き間違いの印（推測。印の範囲は家族には見せない）</h4>
          {n.cleaned === null || marked === null ? (
            <p className="meta">整えた文字はありません（家族の画面には文字起こしのまま出ます）。</p>
          ) : (
            <>
              <pre>
                {marked.segments.map((s, i) =>
                  s.uncertain ? (
                    <mark className="uncertain" key={i}>
                      ［?{s.text}?］
                    </mark>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </pre>
              <p className="meta">
                印 {n.cleaned.uncertainSpans === null ? "読めない" : n.cleaned.uncertainSpans.length + " か所"}
                {marked.broken ? "（範囲が壊れているため、家族の画面には文字起こしのまま出ます）" : ""}
                ：［? ?］で囲んだ部分は、家族の画面では「……」になります
              </p>
              <p className="meta">
                {n.cleaned.model ?? "モデルなし"} ／ 版 {n.cleaned.promptVersion ?? "なし"}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const statusText = { pending: "待ち", done: "済み", failed: "失敗" } as const;

/** 写真に focus の枠を重ねる。写真は鍵を Authorization に付けて読み、blob の URL で出す（img の src に鍵を載せない） */
function FocusedPhoto({ photo, focus, opsKey }: { photo: OpsPhoto; focus: OpsRect | null; opsKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(photo.imageUrl, {
          headers: { Authorization: `Bearer ${opsKey}` },
          credentials: "omit",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [photo.imageUrl, opsKey]);

  if (failed) return <p className="meta">写真を読み込めませんでした。</p>;
  if (!url) return <p className="meta">写真を読み込んでいます</p>;
  return (
    <div className="photo-frame">
      <img src={url} alt="入り口の写真" />
      {focus && (
        <div
          className="focus"
          style={{
            left: `${focus.x * 100}%`,
            top: `${focus.y * 100}%`,
            width: `${focus.w * 100}%`,
            height: `${focus.h * 100}%`,
          }}
        >
          <span>最初に見せる範囲</span>
        </div>
      )}
    </div>
  );
}
