// 家族のこと（/family）で、一人ひとりを直す。開いているのは一度に一人だけ
import { useCallback, useState } from "react";
import type { Member, MemberInput } from "../../shared/api";
import { api } from "./api";

export function useMemberEditor(reload: () => Promise<void>) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const open = useCallback((id: string) => setEditingId(id), []);
  const close = useCallback(() => setEditingId(null), []);

  /** 直して、一覧を読み直してから閉じる。失敗したら投げる（開いたまま、フォームがエラーを出す） */
  const save = useCallback(
    async (id: string, input: MemberInput): Promise<Member> => {
      const m = await api.updateMember(id, input);
      await reload();
      setEditingId((cur) => (cur === id ? null : cur));
      return m;
    },
    [reload],
  );

  return { editingId, open, close, save };
}
