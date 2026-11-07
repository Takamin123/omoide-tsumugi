// 審査員の案内（/demo/<鍵>。0062）。読むのは審査員で、家族ではない。家族の画面からはつながない。
// 言葉は words.ts に入れず guideWords に置く（0014 と同じ考え方）。ボタンの名前は words.ts から差し込み、画面の文字と一字も違えない。
// 鍵が合わない・設定がないときは、ほかの知らない道と同じにする（鍵の有無を見せない）。リンクは同じタブで開く（/join は履歴を置き換えるので、「戻る」でここへ戻る）。
import { useEffect, useLayoutEffect, useState } from "react";
import type { DemoGuideResult } from "../../shared/api";
import { api, ApiError } from "../lib/api";
import { errorText } from "../lib/errors";
import { navigate } from "../lib/route";
import { ErrorLine } from "../parts/ErrorLine";
import { words } from "../words";
import { guideWords } from "./guideWords";

type Load = { state: "loading" } | { state: "ready"; people: DemoGuideResult["people"] } | { state: "error"; text: string };

/** 検索に載せない・URL の鍵を外に漏らさない。外のものを読み込まないページだが、重ねて置く */
function useGuideHead() {
  useLayoutEffect(() => {
    const metas = [
      ["robots", "noindex, nofollow"],
      ["referrer", "no-referrer"],
    ].map(([name, content]) => {
      const m = document.createElement("meta");
      m.name = name!;
      m.content = content!;
      document.head.appendChild(m);
      return m;
    });
    return () => metas.forEach((m) => m.remove());
  }, []);
}

export default function GuidePage({ guideKey }: { guideKey: string }) {
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

  const g = guideWords;

  return (
    <main className="stack demo-guide">
      <h1>{words.appName}</h1>

      <div className="stack">
        {g.names.flatMap((name) => {
          const person = load.people.find((p) => p.calledAs === name);
          return person ? [<a key={name} className="button primary" href={`/join/${person.token}`}>{name}</a>] : [];
        })}
      </div>

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
