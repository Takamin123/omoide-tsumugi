// 家族の一人を足すフォーム。setUpByMemberId は呼ぶ側が決める（自分で自分なら null、ほかの人なら入れた人）
import { useState, type FormEvent } from "react";
import { memberInputSchema, type Member, type MemberInput } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { words } from "../words";
import { ErrorLine } from "./ErrorLine";

type Props = {
  setUpByMemberId: string | null;
  submitLabel?: string;
  onAdded: (m: Member) => void;
};

export function MemberForm({ setUpByMemberId, submitLabel, onAdded }: Props) {
  const [relation, setRelation] = useState("");
  const [calledAs, setCalledAs] = useState("");
  const [role, setRole] = useState<MemberInput["role"]>("family");
  const [speechStyle, setSpeechStyle] = useState<MemberInput["speechStyle"]>("standard");
  const [dialectRegion, setDialectRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = memberInputSchema.safeParse({
      role,
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
      const m = await api.addMember(parsed.data);
      setRelation("");
      setCalledAs("");
      setRole("family");
      setSpeechStyle("standard");
      setDialectRegion("");
      onAdded(m);
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
    </form>
  );
}
