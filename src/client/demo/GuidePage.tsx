// 審査員の案内（/demo/<鍵>。0062）。読むのは審査員で、家族ではない。家族の画面からはつながない。
// 言葉は words.ts に入れず guideWords に置く（0014 と同じ考え方）。ボタンの名前は words.ts から差し込み、画面の文字と一字も違えない。
// 鍵が合わない・設定がないときは、ほかの知らない道と同じにする（鍵の有無を見せない）。リンクは同じタブで開く（/join は履歴を置き換えるので、「戻る」でここへ戻る）。
import { useEffect, useState } from "react";
import type { DemoGuideResult } from "../../shared/api";
import { api, ApiError } from "../lib/api";
import { errorText } from "../lib/errors";
import { navigate } from "../lib/route";
import { ErrorLine } from "../parts/ErrorLine";
import { words } from "../words";
import { guideWords } from "./guideWords";
import { useGuideHead } from "./head";

type Load = { state: "loading" } | { state: "ready"; people: DemoGuideResult["people"] } | { state: "error"; text: string };

/**
 * 審査員が新しい家族を作る画面（/demo/<鍵>/start。0062）。合言葉の欄もデモの印も初期化の欄も出さない。
 * 作ったら履歴を置き換えて / へ（最初の人を入れる画面。「戻る」で案内へ）
 */
function NewFamily({ guideKey }: { guideKey: string }) {
  const g = guideWords;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.demoGuideCreateFamily(guideKey);
      navigate("/", { replace: true });
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.kind === "not_found") navigate("/", { replace: true });
      else setError(e instanceof ApiError && e.kind === "family_limit" ? g.familyLimit : errorText(e));
    }
  }

  return (
    <main className="stack demo-guide">
      <h1>{g.newFamily}</h1>
      <p>{g.startBody}</p>
      <ErrorLine text={error} />
      <button type="button" className="primary" onClick={() => void create()} disabled={busy}>
        {g.startSubmit}
      </button>
      <a className="button" href={`/demo/${guideKey}`}>
        {g.startBack}
      </a>
    </main>
  );
}

export default function GuidePage({ guideKey, start }: { guideKey: string; start: boolean }) {
  useGuideHead();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    api.demoGuide(guideKey).then(
      ({ people }) => {
        if (!stale) setLoad({ state: "ready", people });
      },
      (e) => {
        if (stale) return;
        if (e instanceof ApiError && e.kind === "not_found") navigate("/", { replace: true });
        else setLoad({ state: "error", text: errorText(e) });
      },
    );
    return () => {
      stale = true;
    };
  }, [guideKey, attempt]);

  if (load.state === "loading") return <main><p>{words.loading}</p></main>;
  if (load.state === "error") {
    return (
      <main className="stack">
        <ErrorLine text={load.text} />
        <button type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>
          {words.retry}
        </button>
      </main>
    );
  }

  if (start) return <NewFamily guideKey={guideKey} />;

  const g = guideWords;

  return (
    <main className="stack demo-guide">
      <h1>{words.appName}</h1>
      <p>{g.lead}</p>

      <div className="stack">
        {g.names.flatMap((name) => {
          const person = load.people.find((p) => p.calledAs === name);
          return person ? [<a key={name} className="button primary" href={`/join/${person.token}`}>{name}</a>] : [];
        })}
        <a className="button" href={`/demo/${guideKey}/start`}>
          {g.newFamily}
        </a>
        <p className="sub">{g.newFamilyNote}</p>
      </div>

      <section className="card-soft" aria-labelledby="guide-record">
        <h2 id="guide-record">{g.recordTitle}</h2>
        <p>{g.recordOpenNote}</p>
        <a className="button guide-record-open" href={`/demo/${guideKey}/record`}>
          {g.recordOpen}
        </a>
      </section>

      <section className="card-soft" aria-labelledby="guide-next">
        <h2 id="guide-next">{g.nextTitle}</h2>
        <p>{g.nextBody}</p>
      </section>

      <section className="card-soft" aria-labelledby="guide-notes">
        <h2 id="guide-notes">{g.notesTitle}</h2>
        <ul className="demo-guide-notes">
          {g.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
