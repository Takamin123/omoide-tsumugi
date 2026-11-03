// 家族の画面の下のタブ「今日」「アルバム」。今のタブは色だけでなく、太さと上の線と aria-current で示す。
// 文字や声で答えている間は描かない（キーボードの上にタブが浮いて誤って押す形を避ける）。
import { words } from "../words";

export type HomeTab = "today" | "album";

type Props = { tab: HomeTab; onChange: (tab: HomeTab) => void; composing: boolean };

export function TabBar({ tab, onChange, composing }: Props) {
  if (composing) return null;
  const item = (t: HomeTab, label: string) => (
    <button type="button" className="tab" aria-current={tab === t ? "page" : undefined} onClick={() => tab !== t && onChange(t)}>
      {label}
    </button>
  );
  return (
    <nav className="tabs" aria-label={words.home.tabsLabel}>
      {item("today", words.home.tabToday)}
      {item("album", words.home.tabAlbum)}
    </nav>
  );
}
