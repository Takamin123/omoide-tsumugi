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

  const open = (calledAs: string, primary: boolean) => {
    const person = load.people.find((p) => p.calledAs === calledAs);
    if (!person) return null;
    return (
      <a key={calledAs} className={primary ? "button primary" : "button"} href={`/join/${person.token}`}>
        {calledAs}
      </a>
    );
  };
  const g = guideWords;

  return (
    <main className="stack demo-guide">
      <header>
        <h1>{words.appName}</h1>
        <p>{g.lead}</p>
      </header>

      <section className="card-soft" aria-labelledby="guide-steps">
        <h2 id="guide-steps">{g.stepsTitle}</h2>
        <ol className="demo-guide-steps">
          <li>
            <h3>{g.step1.title}</h3>
            {open(g.elderName, true)}
            <p>{g.step1.body}</p>
          </li>
          <li>
            <h3>{g.step2.title}</h3>
            {open(g.motherName, true)}
            <p>{g.step2.body}</p>
          </li>
          <li>
            <h3>{g.step3.title}</h3>
            <p>{g.step3.body}</p>
          </li>
        </ol>
        <div className="demo-guide-others">
          <span className="sub">{g.others}</span>
          {g.otherNames.map((name) => open(name, false))}
        </div>
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
