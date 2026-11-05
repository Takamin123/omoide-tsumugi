// 下のタブ「今日」「アルバム」「返事」（家族の画面と祖父母の画面で同じ。0034、0043、0058）。印＋語（0059）。今のタブは色だけでなく、太さと印の後ろの淡い青の地と aria-current で示す。
// 「返事」には、まだ見ていない数のバッジ（見た目だけ。読み上げは隠した文で数を言う）。返事のタブにいる間は出さない。
// 文字や声で答えている間は描かない（キーボードの上にタブが浮いて誤って押す形を避ける）。
import type React from "react";
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
      {/* 印（飾り）。今のタブは印の後ろに淡い青の地。バッジは印の右上に重ねる（タブの幅・高さを変えない） */}
      <span className="tab-icon" aria-hidden="true">
        {ICONS[t]}
        {badge > 0 && (
          <span key={badge} className="tab-badge">
            {badgeText(badge)}
          </span>
        )}
      </span>
      {label}
      {badge > 0 && <span className="visually-hidden">{words.home.tabUnseen(badge)}</span>}
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

const svg = (children: React.ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

/** タブの印: 今日=太陽、アルバム=写真、返事=吹き出し */
const ICONS: Record<HomeTab, React.ReactNode> = {
  today: svg(
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>,
  ),
  album: svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 15l5-4 4 3 3-2 6 4" />
    </>,
  ),
  replies: svg(<path d="M4 5h16v11H9l-5 4z" />),
};
