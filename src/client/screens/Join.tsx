// /join/<token>: cookie を得て、URL から合言葉を消す。開いた端末はそのリンクの人になる（選ばせない。別の人で開いていても替わる。0036）
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { joinErrorText } from "../lib/errors";
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
      setError(joinErrorText(e));
    });
  }, [token, onJoined]);
  // 人がまだ決まっていない（祖父母の画面の人かもしれない）ので、祖父母の画面の大きさで出す（0060）
  return (
    <main className="elder">
      {error ? <ErrorLine text={error} /> : <p>{words.join.opening}</p>}
    </main>
  );
}
