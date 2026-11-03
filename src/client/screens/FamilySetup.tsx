// /family: 家族の一人ひとりを足す・直す、その人のリンクを作る（0036）、家族の番号
import { useState } from "react";
import type { FamilyView, Member } from "../../shared/api";
import { navigate } from "../lib/route";
import { useMemberEditor } from "../lib/useMemberEditor";
import { useMemberLinks } from "../lib/useMemberLinks";
import { ErrorLine } from "../parts/ErrorLine";
import { InviteLink } from "../parts/InviteLink";
import { MemberForm } from "../parts/MemberForm";
import { words } from "../words";

type Props = {
  view: FamilyView;
  me: Member;
  reload: () => Promise<void>;
};

export function FamilySetup({ view, me, reload }: Props) {
  const links = useMemberLinks(reload);
  const editor = useMemberEditor(reload);
  const w = words.family;
  const [idCopied, setIdCopied] = useState(false);
  const nameOf = (id: string | null) => view.members.find((m) => m.id === id)?.calledAs ?? null;

  async function copyFamilyId() {
    try {
      await navigator.clipboard.writeText(view.family.id);
      setIdCopied(true);
    } catch {
      setIdCopied(false);
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
            const token = links.links[m.id];
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
                      // 自分の画面（role）は自分では直せない（サーバーも 403。0036）。「画面」の欄を出さない
                      <MemberForm
                        initial={m}
                        setUpByMemberId={m.setUpByMemberId}
                        send={(input) => editor.save(m.id, input)}
                        submitLabel={words.member.edit}
                        onCancel={editor.close}
                        fixedRole={m.id === me.id ? m.role : undefined}
                      />
                    ) : (
                      <>
                        {token && (
                          <div className="stack">
                            <p>{w.linkFor(m.calledAs)}</p>
                            <InviteLink token={token} />
                            <p className="sub">{w.inviteHidden}</p>
                          </div>
                        )}
                        {links.error?.memberId === m.id && <ErrorLine text={links.error.text} />}
                        {/* 「直す」の入力欄が開いている間は、リンクのボタンも出さない（この枝に来ない） */}
                        <div className="row card-actions">
                          <button type="button" className="aux" disabled={links.busy} onClick={() => void links.make(m)}>
                            {m.hasLink ? w.remakeLink : w.makeLink}
                          </button>
                          <button type="button" className="aux" onClick={() => editor.open(m.id)}>
                            {words.member.edit}
                          </button>
                        </div>
                      </>
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

      {/* 家族の番号（家族 ID）。鍵ではない。折り返して読める。コピーはボタンで（長押しの選択は Android で一部しか選べないため。0033） */}
      <div className="stack family-id">
        <p className="sub">
          {w.familyIdLabel}
          <br />
          <span className="family-id-value">{view.family.id}</span>
        </p>
        <button type="button" onClick={() => void copyFamilyId()}>
          {idCopied ? w.copied : w.copyFamilyId}
        </button>
      </div>
      {/* 写真の場所の名前の出典（CC BY 4.0）。祖父母の画面には出さない（0047） */}
      <p className="sub">{w.placeSource}</p>
    </main>
  );
}
