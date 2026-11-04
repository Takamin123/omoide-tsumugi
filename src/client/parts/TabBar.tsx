// 下のタブ「今日」「アルバム」「返事」（家族の画面と祖父母の画面で同じ。0034、0043、0058）。今のタブは色だけでなく、太さと上の線と aria-current で示す。
// 「返事」には、まだ見ていない数のバッジ（見た目だけ。読み上げは隠した文で数を言う）。返事のタブにいる間は出さない。
// 文字や声で答えている間は描かない（キーボードの上にタブが浮いて誤って押す形を避ける）。
import { badgeText } from "../lib/replies";
import { words } from "../words";

export type HomeTab = "today" | "album" | "replies";

type Props = {
  tab: HomeTab;
  onChange: (tab: HomeTab) => void;
  composing: boolean;
  /** 返事のタブのまだ見ていない数 */
  unseen?: number;
};

export function TabBar({ tab, onChange, composing, unseen = 0 }: Props) {
  if (composing) return null;
  const item = (t: HomeTab, label: string, badge = 0) => (
    <button type="button" className="tab" aria-current={tab === t ? "page" : undefined} onClick={() => tab !== t && onChange(t)}>
      {label}
      {badge > 0 && (
        <>
          <span key={badge} className="tab-badge" aria-hidden="true">
            {badgeText(badge)}
          </span>
          <span className="visually-hidden">{words.home.tabUnseen(badge)}</span>
        </>
      )}
    </button>
  );
  return (
    <nav className="tabs" aria-label={words.home.tabsLabel}>
      {item("today", words.home.tabToday)}
      {item("album", words.home.tabAlbum)}
      {item("replies", words.home.tabReplies, tab === "replies" ? 0 : unseen)}
    </nav>
  );
}
