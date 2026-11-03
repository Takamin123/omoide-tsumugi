// /family: 家族の一人ひとりを足す・直す、招待リンク
import { useState } from "react";
import type { FamilyView, Member } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { navigate } from "../lib/route";
import { useMemberEditor } from "../lib/useMemberEditor";
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
  const editor = useMemberEditor(reload);
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
                {/* 直している間は、ほかの人の「直す」を出さない（入れかけの内容を消す道を作らない。0032） */}
                {editor.editingId === null || editor.editingId === m.id ? (
                  <div className="stack" style={{ marginTop: "var(--tap-gap)" }}>
                    {editor.editingId === m.id ? (
                      <MemberForm
                        initial={m}
                        setUpByMemberId={m.setUpByMemberId}
                        send={(input) => editor.save(m.id, input)}
                        submitLabel={words.member.edit}
                        onCancel={editor.close}
                      />
                    ) : (
                      <button type="button" className="aux" style={{ alignSelf: "flex-end" }} onClick={() => editor.open(m.id)}>
                        {words.member.edit}
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 直している間は「家族を足す」を隠す（一画面に主な動作は一つ。0032）。外さずに隠し、入れかけの内容を残す */}
      <section className="stack" hidden={editor.editingId !== null}>
        <h2>{words.member.addTitle}</h2>
        <MemberForm setUpByMemberId={me.id} onDone={() => void reload()} />
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
