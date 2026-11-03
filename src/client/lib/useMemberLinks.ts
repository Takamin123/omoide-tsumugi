// 家族のこと（/family）で、一人ひとりのリンクを作る（作り直す）。0036
// 合言葉はサーバーがハッシュしか持たないので、作ったときにだけ見せられる。端末には残さない（この画面を離れると消える）
import { useCallback, useState } from "react";
import type { Member } from "../../shared/api";
import { api } from "./api";
import { errorText } from "./errors";
import { words } from "../words";

export function useMemberLinks(reload: () => Promise<void>) {
  /** 作ったばかりのリンクの合言葉（人ごと） */
  const [links, setLinks] = useState<Record<string, string>>({});
  /** リンクを作れなかった人と、その文 */
  const [error, setError] = useState<{ memberId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  /** その人のリンクを作る。いまのリンクが使えるときは作り直しになるので確かめる（前のリンクは使えなくなる） */
  const make = useCallback(
    async (m: Member) => {
      if (m.hasLink && !confirm(words.family.regenerateConfirm)) return;
      setError(null);
      setBusy(true);
      try {
        const { token } = await api.createMemberLink(m.id);
        setLinks((cur) => ({ ...cur, [m.id]: token }));
        // hasLink を新しくする（ボタンが「作り直す」になる）
        await reload();
      } catch (e) {
        setError({ memberId: m.id, text: errorText(e) });
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return { links, error, busy, make };
}
