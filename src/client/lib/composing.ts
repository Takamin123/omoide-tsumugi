// 文字や声で答えている間（入力欄・録音が開いている間）を、家族の画面に知らせる。
// 家族の画面は、その間は下のタブを描かない（キーボードの上にタブが浮いて誤って押す形を避ける）。
import { createContext, useContext, useEffect, useId } from "react";

/** 答えている入力欄の集まり。どれか一つでも開いていれば「入力中」 */
export class ComposingSet {
  private open = new Set<string>();
  constructor(private readonly onChange: (composing: boolean) => void) {}

  set(id: string, on: boolean): void {
    const before = this.open.size > 0;
    if (on) this.open.add(id);
    else this.open.delete(id);
    const after = this.open.size > 0;
    if (before !== after) this.onChange(after);
  }

  get composing(): boolean {
    return this.open.size > 0;
  }
}

export const ComposingContext = createContext<ComposingSet | null>(null);

/** 入力欄が開いている間 on を true にする。外れたら（閉じた・画面を離れた）知らせを消す */
export function useComposing(on: boolean): void {
  const set = useContext(ComposingContext);
  const id = useId();
  useEffect(() => {
    if (!set) return;
    set.set(id, on);
    return () => set.set(id, false);
  }, [set, id, on]);
}
