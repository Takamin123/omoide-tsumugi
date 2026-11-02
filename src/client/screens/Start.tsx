// /start: 家族の場を作る（運営の合言葉が要る）
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { ErrorLine } from "../parts/ErrorLine";
import { InviteLink } from "../parts/InviteLink";
import { words } from "../words";

export function Start({ onCreated }: { onCreated: (inviteToken: string) => void }) {
  const [created, setCreated] = useState<string | null>(null);
  const [createToken, setCreateToken] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.createFamily(createToken.trim(), isDemo);
      setCreateToken(""); // 運営の合言葉は手元に残さない
      setCreated(token);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    // 招待リンクを一度だけ見せる。運営が写して、始める人に渡す
    return (
      <main className="stack">
        <h1>{words.family.invite}</h1>
        <InviteLink token={created} />
        <button type="button" className="primary" onClick={() => onCreated(created)}>
          {words.start.next}
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>{words.start.title}</h1>
      <form className="stack" onSubmit={submit}>
        <label>
          {words.start.createToken}
          <input type="password" autoComplete="off" value={createToken} onChange={(e) => setCreateToken(e.target.value)} required />
        </label>
        <label className="choice">
          <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} />
          {words.start.isDemo}
        </label>
        <ErrorLine text={error} />
        <button type="submit" className="primary" disabled={busy || !createToken.trim()}>
          {words.start.submit}
        </button>
      </form>
    </main>
  );
}
