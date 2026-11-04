// マイクの印。「はなす」（祖父母の画面）と「とりなおす」（両画面。0050）で同じ形。大きさは呼ぶ側の CSS が決めてよい
export function MicIcon() {
  return (
    <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}
