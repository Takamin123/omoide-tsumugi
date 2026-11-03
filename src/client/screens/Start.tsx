// /start: 家族の場を作る（運営の合言葉が要る）。作ったら「最初の人のリンク」を一度だけ見せる（0036）
// 下に、デモの家族を最初の状態に戻す節（運営だけ。初期化の鍵が要る。0038）
import { useEffect, useState, type FormEvent } from "react";
import type { DemoResetResult } from "../../shared/api";
import { ApiError, api } from "../lib/api";
import { errorText } from "../lib/errors";
import { ErrorLine } from "../parts/ErrorLine";
import { InviteLink } from "../parts/InviteLink";
import { words } from "../words";

export function Start({ onCreated }: { onCreated: () => void }) {
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
      // 運営の画面なので、家族向けの「リンクを開きなおして」ではなく、合言葉が違うと出す
      setError(err instanceof ApiError && err.kind === "unauthorized" ? words.start.createUnauthorized : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    // 最初の人のリンクを一度だけ見せる。運営がコピーして、始める人に送る（一度きり。最初の一人が入ると使えなくなる）
    return (
      <main className="stack">
        <h1>{words.start.firstLink}</h1>
        <InviteLink token={created} />
        <button type="button" className="primary" onClick={onCreated}>
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
      <DemoReset />
    </main>
  );
}

/**
 * デモの家族を最初の状態に戻す。家族の ID と初期化の鍵を入れて押す。
 * 鍵は画面の中（この部品の状態）だけに置き、押したら消す。端末（localStorage など）には残さない。
 * 一つの要求で 1〜4 分かかるので、押している間は経過の時間を出す（進み具合はサーバーから取れないため）
 */
function DemoReset() {
  const w = words.start.reset;
  const [familyId, setFamilyId] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<DemoResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (startedAt !== null) return; // 二度押しで二度戻さない
    const token = resetToken.trim();
    setResetToken(""); // 鍵は送ったら画面からも消す
    setResult(null);
    setError(null);
    setElapsed(0);
    setStartedAt(Date.now());
    try {
      setResult(await api.resetDemo(familyId.trim(), token));
    } catch (err) {
      // 運営の画面なので、家族向けの文（「リンクを開きなおして」など）ではなく、運営に通じる文にする
      const kind = err instanceof ApiError ? err.kind : null;
      setError(kind === "not_found" ? w.notFound : kind === "unauthorized" ? w.unauthorized : errorText(err));
    } finally {
      setStartedAt(null);
    }
  }

  const running = startedAt !== null;
  return (
    <section className="stack">
      <h2>{w.title}</h2>
      <p className="sub">{w.note}</p>
      {/* 押した後の様子は、文字を大きくしても見えるよう、欄より上に出す */}
      <div className="stack" aria-live="polite">
        {running && (
          <>
            <p>{w.running}</p>
            <progress style={{ width: "100%", height: "1.5rem" }} />
            <p className="sub" aria-live="off">
              {w.elapsed(elapsed)}
            </p>
          </>
        )}
        {result && (
          <>
            <p role="status">
              <strong>{w.done}</strong>
            </p>
            <p>
              {w.result(
                result.inserted.photos,
                result.inserted.narrations,
                result.morning ? result.morning.created + result.morning.existing : 0,
              )}
            </p>
            {!result.morning && <p className="sub">{w.morningFailed}</p>}
          </>
        )}
        <ErrorLine text={error} />
      </div>
      <form className="stack" onSubmit={submit}>
        <label>
          {w.familyId}
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={familyId}
            onChange={(e) => setFamilyId(e.target.value)}
            disabled={running}
            required
          />
        </label>
        <label>
          {w.token}
          <input
            type="password"
            autoComplete="off"
            value={resetToken}
            onChange={(e) => setResetToken(e.target.value)}
            disabled={running}
            required
          />
        </label>
        <button type="submit" className="primary" disabled={running || !familyId.trim() || !resetToken.trim()}>
          {w.submit}
        </button>
      </form>
    </section>
  );
}
