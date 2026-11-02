// /join/<token>: cookie を得て、URL から合言葉を消す
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { ErrorLine } from "../parts/ErrorLine";
import { words } from "../words";

export function Join({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode の二度呼びで二重に送らない
    started.current = true;
    api.startSession(token).then(onJoined, (e) => {
      // 合言葉を履歴に残さない
      history.replaceState(null, "", "/");
      setError(errorText(e));
    });
  }, [token, onJoined]);
  return (
    <main>
      {error ? <ErrorLine text={error} /> : <p>{words.join.opening}</p>}
    </main>
  );
}
