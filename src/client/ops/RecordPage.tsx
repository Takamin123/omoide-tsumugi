// 開発用（運営）の記録の画面（/ops/record）。見るのは運営と開発だけ。家族の画面からはつながない（0017、0025）。
// 家族向けの画面ではないので、言葉は words.ts に入れずここに置く（0014 と同じ考え方）。
// 家族が語ったもの（出所つき。青の実線、明朝）と、Claude が決めたこと・推測（茶の点線）と、家族の画面に出た形（墨の実線）を枠で分ける。
// 見方は二つ: 日付と人で見る（既定）／写真で見る。URL の view で切り替え、再読み込みで保つ。外のフォントは読み込まない。
// 審査員の道（/demo/<鍵>/record。0062 の追記）でも同じ画面を使う。そのときは案内の鍵をパスから props で受け取り（どこにも保存しない）、
// 家族はサーバーが台本の家族に決める。運営の鍵の欄・鍵を消す操作・家族の ID の欄は出さず、運営の鍵（sessionStorage）は読みも書きもしない。
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { guideWords } from "../demo/guideWords";
import { useGuideHead } from "../demo/head";
import { navigate } from "../lib/route";
import { words } from "../words";
import type { OpsFamilyRecord, OpsNarration } from "../../shared/ops";
import { DateView, onPlainClick, type Names } from "./DateView";
import { PhotoCache, PhotoCacheContext } from "./parts";
import { PhotoView } from "./PhotoView";
import {
  entranceDates,
  fetchGuideRecord,
  fetchRecord,
  loadOpsKey,
  monthDay,
  narrationAnchor,
  parseRoute,
  photoUsage,
  pickDate,
  pickPhoto,
  routeSearch,
  saveOpsKey,
  shortId,
  type OpsRoute,
} from "./record";

/** このページだけの見た目。ふだんの画面の styles.css には入れない（そちらの main や button の決まりを、ここで打ち消す） */
const opsCss = `
.ops {
  --ink: #1C2024; --sub: #59616A; --rule: #D5D9DD; --line: #7D858D;
  --told: #1F5FA8; --told-bg: #EDF3FA; --told-hover: #163F70;
  --guess: #A24C0B; --guess-head: #7A3908; --guess-bg: #FBF1E7;
  --mincho: "Shippori Mincho", "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", serif;
  --gothic: "BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;
  max-width: none; margin: 0; padding: 0; min-height: 100vh;
  background: #FFFFFF; color: var(--ink); font-family: var(--gothic); font-size: 1rem; line-height: 1.6;
}
.ops *, .ops *::before, .ops *::after { box-sizing: border-box; }
.ops a { color: var(--told); }
.ops a:hover { color: var(--told-hover); }
.ops :focus-visible { outline: 3px solid var(--told); outline-offset: 2px; }
.ops h1, .ops h2, .ops h3 { margin: 0; line-height: 1.4; }
.ops h1 { font-size: 1.375rem; }
.ops h2 { font-size: 1.25rem; }
.ops h3 { font-size: 0.9375rem; }
.ops p { margin: 0; }
.ops .sub { font-size: 0.875rem; color: var(--sub); }
.ops .ids { font-family: ui-monospace, monospace; font-size: 0.8125rem; word-break: break-all; color: var(--sub); }
.ops .pre { white-space: pre-wrap; }
.ops label { display: inline; font-size: 0.9375rem; }
.ops input, .ops button { font: inherit; font-size: 0.9375rem; line-height: 1.4; }
.ops input { min-height: 2.75rem; padding: 0.4rem 0.6rem; border: 2px solid var(--line); border-radius: 4px; flex: 1 1 14rem; min-width: 0; }
.ops button { min-height: 2.75rem; min-width: 2.75rem; padding: 0.5rem 1rem; border: 2px solid var(--line); border-radius: 4px; background: #FFFFFF; color: var(--ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.ops summary { cursor: pointer; min-height: 2.75rem; display: flex; align-items: center; }
.ops summary::marker, .ops summary::-webkit-details-marker { display: none; }
.ops summary::before { content: "▸"; margin-right: 0.4rem; }
.ops details[open] > summary::before { content: "▾"; }
.ops .error { color: #A1170F; font-weight: 700; }

.ops header { border-bottom: 1px solid var(--rule); padding: 1rem 1.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; align-items: baseline; }
.ops .axis { margin-left: auto; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ops .axis a { font-size: 0.875rem; padding: 0.5rem 0.75rem; min-height: 2.75rem; display: inline-flex; align-items: center; border: 2px solid var(--line); border-radius: 4px; text-decoration: none; color: var(--ink); }
.ops .axis a[aria-current="page"] { background: var(--ink); border-color: var(--ink); color: #FFFFFF; font-weight: 700; }
.ops .body { max-width: 74rem; margin: 0 auto; padding: 1.25rem 1.5rem 4rem; display: flex; flex-direction: column; gap: 1.75rem; }
.ops form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.ops .access { display: flex; flex-direction: column; gap: 0.75rem; }
.ops .access-inner { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0 0.25rem; }
.ops .guide-lead { display: flex; flex-direction: column; gap: 0.5rem; max-width: 46rem; }
.ops .guide-lead a { align-self: flex-start; display: inline-flex; align-items: center; min-height: 2.75rem; }

.ops .bar { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; align-items: center; }
.ops .dates { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ops .dates button[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: #FFFFFF; font-weight: 700; }
.ops .legend { margin: 0 0 0 auto; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; font-size: 0.875rem; }
.ops .legend li { display: flex; gap: 0.5rem; align-items: center; }
.ops .legend .swatch { width: 1.375rem; height: 0.875rem; border-radius: 2px; flex: none; }
.ops .legend .told-text { font-weight: 600; line-height: 1.4; }

.ops .told { border: 2px solid var(--told); background: var(--told-bg); border-radius: 4px; padding: 0.5rem 0.625rem; }
.ops .guessed { border: 2px dashed var(--guess); background: var(--guess-bg); border-radius: 4px; padding: 0.625rem 0.875rem; display: flex; flex-direction: column; gap: 0.5rem; line-height: 1.8; }
.ops .guessed > summary, .ops .guessed-head { font-weight: 700; color: var(--guess-head); font-size: 0.9375rem; }
.ops details.guessed { padding-top: 0; padding-bottom: 0; }
.ops details.guessed[open] { padding-bottom: 0.625rem; }
.ops .guessed.small { font-size: 0.8125rem; line-height: 1.6; padding: 0 0.625rem; }
.ops .guessed.small > summary { font-weight: 400; color: var(--ink); font-size: 0.8125rem; }
.ops .guessed.small[open] { padding-bottom: 0.5rem; }
.ops .shown { border: 2px solid var(--ink); border-radius: 4px; padding: 0.75rem 0.875rem; display: flex; flex-direction: column; gap: 0.75rem; }
.ops .question { font-size: 1.0625rem; line-height: 1.7; font-weight: 700; }
.ops .told-text { font-family: var(--mincho); font-weight: 500; font-size: 1rem; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
.ops .told-head { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.8125rem; color: var(--told); font-weight: 700; }
.ops .quote { margin: 0; }
.ops .quote blockquote { margin: 0; }
.ops .quote figcaption { margin-top: 0.25rem; font-size: 0.8125rem; color: var(--told); }
.ops .quote .raw { font-size: 0.8125rem; }
.ops mark.uncertain { background: #FFE08A; color: inherit; text-decoration: underline wavy #8A5A00; }

.ops .facts { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.125rem 0.75rem; font-size: 0.8125rem; line-height: 1.6; }
.ops .facts div { display: contents; }
.ops .facts dt { color: var(--sub); }
.ops .facts dd { margin: 0; overflow-wrap: anywhere; }

.ops .person { border-top: 2px solid var(--ink); padding-top: 0.875rem; display: flex; flex-direction: column; gap: 1rem; }
.ops .person-head { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; align-items: baseline; }
.ops .push { margin-left: auto; }
.ops .cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
.ops .col { min-width: 0; display: flex; flex-direction: column; gap: 0.625rem; }
@media (min-width: 64rem) {
  .ops .cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1fr); gap: 1.5rem; }
  .ops .col + .col { border-left: 1px solid var(--rule); padding-left: 1.5rem; }
}
@media (max-width: 63.99rem) {
  .ops .col + .col { border-top: 1px solid var(--rule); padding-top: 1rem; }
}
.ops .chip-wrap { position: relative; }
.ops .chip { width: 100%; text-align: left; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 0.25rem; border-color: var(--told); background: var(--told-bg); padding: 0.5rem 0.625rem; }
.ops .chip .told-text { font-size: 0.9375rem; line-height: 1.85; }
.ops .chip .used { margin-left: auto; color: var(--ink); }
.ops .chip.missing { border: 1px solid var(--rule); border-radius: 4px; padding: 0.5rem 0.625rem; }
.ops .pop { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); background: #FFFFFF; border: 1px solid var(--ink); border-radius: 4px; padding: 0.75rem 0.875rem; display: flex; flex-direction: column; gap: 0.625rem; box-shadow: 0 2px 8px rgba(28, 32, 36, 0.18); }
.ops .entrance { display: flex; flex-wrap: wrap; gap: 0.875rem; align-items: flex-start; }
.ops .entrance-photo { margin: 0; flex: 0 1 12.5rem; max-width: 100%; display: flex; flex-direction: column; gap: 0.375rem; }
.ops .entrance .shown { flex: 1 1 13.75rem; min-width: 0; }
.ops .reply { display: flex; flex-direction: column; gap: 0.375rem; }
.ops .v3 { display: flex; flex-direction: column; gap: 0.375rem; border-top: 1px solid var(--rule); padding-top: 0.5rem; }
.ops .musubi { list-style: none; margin: 0; padding: 0.25rem 0 0.25rem 0.625rem; border-left: 3px solid var(--guess); display: flex; flex-direction: column; gap: 0.25rem; }
.ops .musubi-photo { display: flex; gap: 0.625rem; align-items: center; text-decoration: none; color: var(--ink); min-height: 2.75rem; }
.ops .musubi-photo .thumb { width: 3rem; flex: none; font-size: 0; }

.ops .photo { position: relative; overflow: hidden; width: 100%; background: #C8D1D8; display: flex; align-items: center; justify-content: center; text-align: center; }
.ops .photo img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.ops .focus { position: absolute; border: 2px dashed var(--guess); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85); }
.ops .focus-label, .ops .frame-no { font-size: 0.75rem; line-height: 1.4; background: var(--guess); color: #FFFFFF; padding: 0.0625rem 0.375rem; min-width: 1.5rem; text-align: center; font-weight: 700; }
.ops .focus-label { position: absolute; left: 0; top: 0; }
.ops .frame-names { list-style: none; margin: 0.375rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; color: var(--ink); }
.ops .frame-names li { display: flex; gap: 0.375rem; align-items: center; }
.ops a.go { display: inline-flex; align-items: center; min-height: 2.75rem; }

.ops .photo-axis { display: flex; flex-wrap: wrap; gap: 2rem; align-items: flex-start; }
.ops .photo-list { flex: 1 1 12.5rem; max-width: 15rem; display: flex; flex-direction: column; gap: 0.25rem; }
.ops .photo-list h2 { font-size: 0.9375rem; margin-bottom: 0.5rem; }
.ops .photo-list a { display: flex; gap: 0.625rem; align-items: center; text-decoration: none; color: var(--ink); padding: 0.5rem; border: 2px solid transparent; border-radius: 4px; min-height: 2.75rem; }
.ops .photo-list a[aria-current="page"] { border-color: var(--ink); }
.ops .photo-list .thumb { width: 3.5rem; flex: none; font-size: 0; }
.ops .photo-list-text { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.ops .photo-list-name { font-size: 0.9375rem; font-weight: 700; overflow-wrap: anywhere; }
.ops .photo-main { flex: 999 1 37.5rem; min-width: 0; display: flex; flex-direction: column; gap: 1.75rem; }
.ops .photo-top { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start; }
.ops .photo-big { margin: 0; flex: 0 1 22.5rem; max-width: 100%; display: flex; flex-direction: column; gap: 0.5rem; }
.ops .photo-side { flex: 1 1 16rem; min-width: 0; display: flex; flex-direction: column; gap: 0.875rem; }
.ops .photo-side > .facts { font-size: 0.875rem; gap: 0.375rem 0.875rem; }
.ops .history { border-top: 2px solid var(--ink); padding-top: 0.875rem; }
.ops .history h2 { font-size: 1.125rem; margin-bottom: 1rem; }
.ops .history ol { list-style: none; margin: 0; padding: 0; }
.ops .history li { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; padding: 0.875rem 0; border-bottom: 1px solid var(--rule); scroll-margin-top: 1rem; }
.ops .history li:target, .ops .history li:focus { outline: 3px solid var(--told); outline-offset: 2px; }
.ops .when { flex: 0 0 5.25rem; font-size: 0.875rem; color: var(--sub); padding-top: 0.25rem; }
.ops .what { flex: 1 1 26rem; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.ops .pair { display: flex; flex-wrap: wrap; gap: 0.625rem; align-items: flex-start; }
.ops .pair .shown { flex: 1.4 1 16rem; min-width: 0; }
.ops .pair .guessed { flex: 1 1 12.5rem; min-width: 0; font-size: 0.875rem; line-height: 1.7; }
@media (max-width: 40rem) {
  .ops header, .ops .body { padding-left: 1rem; padding-right: 1rem; }
  .ops .axis, .ops .legend, .ops .push { margin-left: 0; }
  .ops .photo-list { max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ops *, .ops *::before, .ops *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

// 鍵が違うときと家族が見つからないときは、同じ言葉にする（家族の ID の有無を探れないように）
const notOpened = "開けませんでした。鍵と家族の ID を確かめてください。";
const reasonText = {
  unauthorized: notOpened,
  not_found: notOpened,
  failed: "読み込めませんでした。",
} as const;

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; record: OpsFamilyRecord }
  | { state: "error"; reason: keyof typeof reasonText };

const currentRoute = (): OpsRoute => {
  try {
    return parseRoute(location.search);
  } catch {
    return { family: "", view: "date", date: null, photo: null };
  }
};
const currentAnchor = (): string | null => {
  try {
    return location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : null;
  } catch {
    return null;
  }
};
type HrefOf = (r: OpsRoute, anchor?: string) => string;
const hrefAt =
  (base: string): HrefOf =>
  (r, anchor) =>
    `${base}${routeSearch(r)}${anchor ? `#${anchor}` : ""}`;
const opsHrefOf = hrefAt("/ops/record");

export default function RecordPage({ guideKey }: { guideKey?: string } = {}) {
  return guideKey ? <GuideRecordPage guideKey={guideKey} /> : <OpsRecordPage />;
}

/** 戻る・進むで、見ている所を URL に合わせる。家族が変わったら onOtherFamily（運営の道だけ） */
function useRouteState(normalize: (r: OpsRoute) => OpsRoute, hrefOf: HrefOf, onOtherFamily?: (r: OpsRoute) => void) {
  const [route, setRoute] = useState<OpsRoute>(() => normalize(currentRoute()));
  const [anchor, setAnchor] = useState<string | null>(currentAnchor);
  // URL を書き換えるのは、state の更新関数の外で一度だけ（StrictMode で二度呼ばれても履歴が増えないように）
  const routeRef = useRef(route);
  const moveTo = (next: OpsRoute, how: "push" | "replace", toAnchor?: string) => {
    routeRef.current = next;
    if (how === "push") history.pushState(null, "", hrefOf(next, toAnchor));
    else history.replaceState(null, "", hrefOf(next, toAnchor));
    setRoute(next);
  };
  const onOtherRef = useRef(onOtherFamily);
  onOtherRef.current = onOtherFamily;

  useEffect(() => {
    const onPop = () => {
      const r = normalize(currentRoute());
      const otherFamily = r.family !== routeRef.current.family;
      routeRef.current = r;
      setRoute(r);
      setAnchor(currentAnchor());
      if (otherFamily) onOtherRef.current?.(r);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (patch: Partial<OpsRoute>, toAnchor?: string) => {
    moveTo({ ...routeRef.current, ...patch }, "push", toAnchor);
    setAnchor(toAnchor ?? null);
    if (!toAnchor && patch.view !== undefined) scrollTo({ top: 0 });
  };

  return { route, anchor, routeRef, moveTo, go };
}

/** 語りの記録へ移ったら、その欄を見せる（写真は縦横比で場所を取ってあるので、読み込みで位置はずれない） */
function useAnchorScroll(anchor: string | null, load: Load, route: OpsRoute) {
  useEffect(() => {
    if (!anchor || load.state !== "ready") return;
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }, [anchor, load, route]);
}

/** 見方の切り替え（日付と人で見る／写真で見る） */
function Axis({ route, hrefOf, go }: { route: OpsRoute; hrefOf: HrefOf; go: (patch: Partial<OpsRoute>) => void }) {
  return (
    <nav className="axis" aria-label="見方">
      <a
        href={hrefOf({ ...route, view: "date" })}
        aria-current={route.view === "date" ? "page" : undefined}
        onClick={onPlainClick(() => go({ view: "date" }))}
      >
        日付と人で見る
      </a>
      <a
        href={hrefOf({ ...route, view: "photo" })}
        aria-current={route.view === "photo" ? "page" : undefined}
        onClick={onPlainClick(() => go({ view: "photo" }))}
      >
        写真で見る
      </a>
    </nav>
  );
}

const noFamily = (r: OpsRoute): OpsRoute => ({ ...r, family: "" });

/**
 * 審査員が見る Claude の記録（/demo/<鍵>/record。0062 の追記）。読み取りだけ。
 * 鍵が合わない・設定がないときは、案内と同じく / に置き換える（鍵を URL に残さない。鍵の有無を見せない）
 */
function GuideRecordPage({ guideKey }: { guideKey: string }) {
  useGuideHead();
  const g = guideWords;
  const hrefOf = useMemo(() => hrefAt(`/demo/${guideKey}/record`), [guideKey]);
  const { route, anchor, go, moveTo, routeRef } = useRouteState(noFamily, hrefOf);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    void fetchGuideRecord(guideKey).then((r) => {
      if (stale) return;
      if (r.ok) {
        setLoad({ state: "ready", record: r.record });
        // 検索語に家族の ID などが付いて来ても、見ている所だけにそろえる
        moveTo(routeRef.current, "replace", currentAnchor() ?? undefined);
      } else if (r.reason === "failed") setLoad({ state: "error", reason: "failed" });
      else navigate("/", { replace: true });
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideKey, attempt]);

  useAnchorScroll(anchor, load, route);

  const ready = load.state === "ready" ? load.record : null;

  return (
    <main className="ops">
      <style>{opsCss}</style>
      <header>
        <h1>記録</h1>
        {ready && <Axis route={route} hrefOf={hrefOf} go={go} />}
      </header>

      <div className="body">
        <div className="guide-lead">
          <p>{g.recordLead}</p>
          <p>{g.recordScope}</p>
          <a href={`/demo/${guideKey}`}>{g.recordBack}</a>
        </div>

        {load.state === "loading" && <p>読み込んでいます</p>}
        {load.state === "error" && (
          <>
            <p className="error" role="alert">
              {reasonText[load.reason]}
            </p>
            <p>
              <button type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>
                {words.retry}
              </button>
            </p>
          </>
        )}
        {ready && <Record record={ready} opsKey={guideKey} route={route} go={go} hrefOf={hrefOf} />}
      </div>
    </main>
  );
}

function OpsRecordPage() {
  const hrefOf = opsHrefOf;
  const [key, setKey] = useState<string | null>(() => loadOpsKey());
  const [keyInput, setKeyInput] = useState("");
  const { route, anchor, routeRef, moveTo, go } = useRouteState(
    (r) => r,
    hrefOf,
    // 別の家族の URL に戻ったら、その家族を読み直す（URL と画面を食い違わせない）
    (r) => {
      setFamilyInput(r.family);
      const k = loadOpsKey();
      if (k && r.family) void open(r.family, k);
      else setLoad({ state: "idle" });
    },
  );
  const [familyInput, setFamilyInput] = useState(() => route.family);
  const [load, setLoad] = useState<Load>({ state: "idle" });

  const open = async (familyId: string, k: string) => {
    setLoad({ state: "loading" });
    const r = await fetchRecord(familyId, k);
    if (r.ok) {
      setLoad({ state: "ready", record: r.record });
      // 家族の ID と見ている所だけを URL に残す（鍵は載せない）。別の家族を開いたら、選んでいた日付と写真は捨てる
      const prev = routeRef.current;
      const next = prev.family === familyId ? prev : { family: familyId, view: prev.view, date: null, photo: null };
      moveTo(next, "replace", currentAnchor() ?? undefined);
      return;
    }
    if (r.reason === "unauthorized") {
      saveOpsKey(null);
      setKey(null);
    }
    setLoad({ state: "error", reason: r.reason });
  };

  useEffect(() => {
    if (key && route.family) void open(route.family, key);
    // 最初の一回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAnchorScroll(anchor, load, route);

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

  const forgetKey = () => {
    saveOpsKey(null);
    setKey(null);
    setLoad({ state: "idle" });
  };

  const ready = load.state === "ready" && key !== null ? load.record : null;

  const access =
    key === null ? (
      <form onSubmit={onKey}>
        <label htmlFor="ops-key">運営の鍵</label>
        <input id="ops-key" type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
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
          <button type="button" onClick={forgetKey}>
            鍵を消す
          </button>
        </p>
      </>
    );

  return (
    <main className="ops">
      <style>{opsCss}</style>
      <header>
        <h1>記録</h1>
        <p className="sub">運営と開発だけが見る画面です。家族には出しません。</p>
        {ready && (
          <p className="sub">
            {ready.family.isDemo ? "試しの家族" : "家族"} {shortId(ready.family.id)}
          </p>
        )}
        {ready && <Axis route={route} hrefOf={hrefOf} go={go} />}
      </header>

      <div className="body">
        {ready ? (
          <details className="access">
            <summary className="sub">家族の ID と鍵</summary>
            <div className="access-inner">{access}</div>
          </details>
        ) : (
          <div className="access">
            <p className="sub">鍵はこのタブの中だけに持ち、タブを閉じると消えます。</p>
            {access}
          </div>
        )}

        {load.state === "loading" && <p>読み込んでいます</p>}
        {load.state === "error" && (
          <p className="error" role="alert">
            {reasonText[load.reason]}
          </p>
        )}
        {ready && key !== null && <Record record={ready} opsKey={key} route={route} go={go} hrefOf={hrefOf} />}
      </div>
    </main>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="枠の見方">
      <li>
        <span className="swatch" aria-hidden="true" style={{ border: "2px solid var(--told)", background: "var(--told-bg)" }} />
        <span className="told-text">家族が語った言葉</span>
      </li>
      <li>
        <span className="swatch" aria-hidden="true" style={{ border: "2px dashed var(--guess)", background: "var(--guess-bg)" }} />
        <span>Claude が決めた・推測</span>
      </li>
      <li>
        <span className="swatch" aria-hidden="true" style={{ border: "2px solid var(--ink)" }} />
        <span>家族の画面に出た形</span>
      </li>
    </ul>
  );
}

function Record({
  record,
  opsKey,
  route,
  go,
  hrefOf,
}: {
  record: OpsFamilyRecord;
  /** 写真を読む鍵（運営の鍵か、審査員の道では案内の鍵） */
  opsKey: string;
  route: OpsRoute;
  go: (patch: Partial<OpsRoute>, anchor?: string) => void;
  hrefOf: HrefOf;
}) {
  // 写真は、開いている家族と鍵の間だけ使い回す
  const [cache, setCache] = useState<PhotoCache | null>(null);
  useEffect(() => {
    const c = new PhotoCache(opsKey);
    setCache(c);
    return () => c.close();
  }, [opsKey, record]);

  const names = useMemo<Names>(() => {
    const byId = new Map(record.members.map((m) => [m.id, m]));
    return {
      who: (id) => (id ? (byId.get(id)?.calledAs ?? "（不明）") : "（不明）"),
      role: (id) => byId.get(id)?.relation ?? "",
    };
  }, [record]);

  const dates = useMemo(() => entranceDates(record.entrances), [record]);
  const usage = useMemo(() => photoUsage(record), [record]);
  const date = pickDate(dates, route.date);
  const photoId = pickPhoto(record.photos, usage, route.photo);

  const photoRoute = (id: string): OpsRoute => ({ ...route, view: "photo", photo: id });
  const photoHref = (id: string) => hrefOf(photoRoute(id));
  const goPhoto = (id: string) => go({ view: "photo", photo: id });
  const narrationHref = (n: OpsNarration) => hrefOf(photoRoute(n.photoId), narrationAnchor(n.id));
  const goNarration = (n: OpsNarration) => go({ view: "photo", photo: n.photoId }, narrationAnchor(n.id));

  return (
    <PhotoCacheContext.Provider value={cache}>
      {route.view === "date" ? (
        <>
          <div className="bar">
            {dates.length > 0 && (
              <div className="dates" role="group" aria-label="日付">
                {dates.map((d) => (
                  <button key={d} type="button" aria-pressed={d === date} onClick={() => go({ date: d })}>
                    {monthDay(d)}
                  </button>
                ))}
              </div>
            )}
            <Legend />
          </div>
          {date === null ? (
            <p className="sub">入り口はまだありません。</p>
          ) : (
            <DateView
              record={record}
              date={date}
              names={names}
              goNarration={goNarration}
              narrationHref={narrationHref}
              photoHref={photoHref}
              goPhoto={goPhoto}
            />
          )}
        </>
      ) : (
        <>
          <div className="bar">
            <Legend />
          </div>
          {photoId === null ? (
            <p className="sub">写真はまだありません。</p>
          ) : (
            <PhotoView record={record} photoId={photoId} usage={usage} names={names} photoHref={photoHref} goPhoto={goPhoto} />
          )}
        </>
      )}
    </PhotoCacheContext.Provider>
  );
}
