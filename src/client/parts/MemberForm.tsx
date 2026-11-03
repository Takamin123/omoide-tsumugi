// 家族の一人を足す・直すフォーム。
// setUpByMemberId は呼ぶ側が決める（足すとき: 自分で自分なら null、ほかの人なら入れた人。直すとき: 今の値のまま）
import { useState, type FormEvent } from "react";
import { memberInputSchema, type Member, type MemberInput } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { words } from "../words";
import { ErrorLine } from "./ErrorLine";

type Props = {
  setUpByMemberId: string | null;
  /** 直すときの今の内容。ないときは空の欄で足す */
  initial?: Member;
  /** 送り先。既定は足す（api.addMember） */
  send?: (input: MemberInput) => Promise<Member>;
  submitLabel?: string;
  onDone?: (m: Member) => void;
  /** あれば「やめる」を出す */
  onCancel?: () => void;
  /**
   * 画面（role）を決めておき、「画面」の欄を出さない。最初の人（家族の画面に決まっている）と、
   * 自分を直すとき（自分の画面は自分では直せない。0036）
   */
  fixedRole?: MemberInput["role"];
};

export function MemberForm({ setUpByMemberId, initial, send = api.addMember, submitLabel, onDone, onCancel, fixedRole }: Props) {
  const [relation, setRelation] = useState(initial?.relation ?? "");
  const [calledAs, setCalledAs] = useState(initial?.calledAs ?? "");
  const [role, setRole] = useState<MemberInput["role"]>(fixedRole ?? initial?.role ?? "family");
  const [speechStyle, setSpeechStyle] = useState<MemberInput["speechStyle"]>(initial?.speechStyle ?? "standard");
  const [dialectRegion, setDialectRegion] = useState(initial?.dialectRegion ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = memberInputSchema.safeParse({
      role: fixedRole ?? role,
      relation,
      calledAs,
      speechStyle,
      dialectRegion: speechStyle === "dialect" ? dialectRegion : null,
      setUpByMemberId,
    });
    if (!parsed.success) {
      setError(words.errors.invalid_request);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const m = await send(parsed.data);
      if (!initial) {
        setRelation("");
        setCalledAs("");
        setRole("family");
        setSpeechStyle("standard");
        setDialectRegion("");
      }
      onDone?.(m);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const w = words.member;
  return (
    <form className="stack" onSubmit={submit}>
      <label>
        {w.relation}
        <span className="sub">{w.relationHint}</span>
        <input type="text" value={relation} maxLength={20} onChange={(e) => setRelation(e.target.value)} required />
      </label>
      <label>
        {w.calledAs}
        <span className="sub">{w.calledAsHint}</span>
        <input type="text" value={calledAs} maxLength={20} onChange={(e) => setCalledAs(e.target.value)} required />
      </label>
      {!fixedRole && (
        <fieldset className="stack">
          <legend>{w.role}</legend>
          <label className="choice">
            <input type="radio" name="role" checked={role === "elder"} onChange={() => setRole("elder")} />
            {w.roleElder}
          </label>
          <label className="choice">
            <input type="radio" name="role" checked={role === "family"} onChange={() => setRole("family")} />
            {w.roleFamily}
          </label>
        </fieldset>
      )}
      <fieldset className="stack">
        <legend>{w.speech}</legend>
        <label className="choice">
          <input type="radio" name="speech" checked={speechStyle === "standard"} onChange={() => setSpeechStyle("standard")} />
          {w.speechStandard}
        </label>
        <label className="choice">
          <input type="radio" name="speech" checked={speechStyle === "dialect"} onChange={() => setSpeechStyle("dialect")} />
          {w.speechDialect}
        </label>
        {speechStyle === "dialect" && (
          <label>
            {w.dialectRegion}
            <span className="sub">{w.dialectRegionHint}</span>
            <input type="text" value={dialectRegion} maxLength={20} onChange={(e) => setDialectRegion(e.target.value)} required />
          </label>
        )}
      </fieldset>
      <ErrorLine text={error} />
      <button type="submit" className="primary" disabled={busy}>
        {submitLabel ?? w.submit}
      </button>
      {onCancel && (
        <button type="button" className="wide" onClick={onCancel} disabled={busy}>
          {words.home.cancel}
        </button>
      )}
    </form>
  );
}
