// 招待リンクの表示と写し。合言葉は作ったときにだけ手元にある（サーバーはハッシュしか持たない）
import { useState } from "react";
import { words } from "../words";

export function InviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/join/${token}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="stack">
      <p className="invite-url">{url}</p>
      <button type="button" onClick={copy}>
        {copied ? words.family.copied : words.family.copy}
      </button>
    </div>
  );
}
