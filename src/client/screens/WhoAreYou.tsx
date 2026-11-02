// あなたはどなたですか。家族が一人もいなければ、始める人が自分を足すところから
import { useState } from "react";
import type { FamilyView } from "../../shared/api";
import { MemberForm } from "../parts/MemberForm";
import { words } from "../words";

export function WhoAreYou({ view, onChosen }: { view: FamilyView; onChosen: (memberId: string) => void }) {
  const [adding, setAdding] = useState(view.members.length === 0);

  if (adding) {
    return (
      <main>
        <h1>{view.members.length === 0 ? words.who.firstTitle : words.member.selfTitle}</h1>
        <MemberForm setUpByMemberId={null} onAdded={(m) => onChosen(m.id)} />
        {view.members.length > 0 && (
          <button type="button" className="wide" style={{ marginTop: "1rem" }} onClick={() => setAdding(false)}>
            {words.home.cancel}
          </button>
        )}
      </main>
    );
  }

  return (
    <main>
      <h1>{words.who.title}</h1>
      <div className="stack">
        {view.members.map((m) => (
          <button key={m.id} type="button" className="primary" onClick={() => onChosen(m.id)}>
            {m.calledAs}
          </button>
        ))}
        <button type="button" className="wide" onClick={() => setAdding(true)}>
          {words.who.other}
        </button>
      </div>
    </main>
  );
}
