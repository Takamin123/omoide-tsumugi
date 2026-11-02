// /family: 家族の一人ひとりを足す、招待リンク
import { useState } from "react";
import type { FamilyView, Member } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { navigate } from "../lib/route";
import { ErrorLine } from "../parts/ErrorLine";
import { InviteLink } from "../parts/InviteLink";
import { MemberForm } from "../parts/MemberForm";
import { words } from "../words";

type Props = {
  view: FamilyView;
  me: Member;
  reload: () => Promise<void>;
  inviteToken: string | null;
  onInviteToken: (token: string) => void;
};

export function FamilySetup({ view, me, reload, inviteToken, onInviteToken }: Props) {
  const [error, setError] = useState<string | null>(null);
  const w = words.family;
  const nameOf = (id: string | null) => view.members.find((m) => m.id === id)?.calledAs ?? null;

  async function regenerate() {
    if (!confirm(w.regenerateConfirm)) return;
    setError(null);
    try {
      const { token } = await api.regenerateInvite();
      onInviteToken(token);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <main className="stack">
      <nav className="top">
        <button type="button" onClick={() => navigate("/")}>
          {words.home.menuHome}
        </button>
      </nav>
      <h1>{w.title}</h1>

      <section className="stack">
        <h2>{w.members}</h2>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {view.members.map((m) => {
            const by = nameOf(m.setUpByMemberId);
            return (
              <li key={m.id} className="card">
                <div>{words.member.summary(m.calledAs, m.relation)}</div>
                <div className="sub">
                  {words.member.details(
                    m.role === "elder" ? words.member.roleElder : words.member.roleFamily,
                    m.speechStyle === "dialect" ? words.member.dialectOf(m.dialectRegion ?? "") : words.member.speechStandard,
                  )}
                </div>
                {by && <div className="sub">{words.member.setUpBy(by)}</div>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="stack">
        <h2>{words.member.addTitle}</h2>
        <MemberForm setUpByMemberId={me.id} onAdded={() => void reload()} />
      </section>

      <section className="stack">
        <h2>{w.invite}</h2>
        {inviteToken ? (
          <InviteLink token={inviteToken} />
        ) : (
          <p className="sub">{w.inviteHidden}</p>
        )}
        <p className="sub">{w.regenerateNote}</p>
        <button type="button" onClick={regenerate}>
          {w.regenerate}
        </button>
        <ErrorLine text={error} />
      </section>
    </main>
  );
}
