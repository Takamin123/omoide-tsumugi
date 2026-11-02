// この端末を使っている人を覚える。合言葉では決めない（祖父母のタブレットは二人で使う）。
// 家族の ID と組で覚え、開いた家族と違えば捨てる（デモと実際の家族を行き来しても混ざらない）。
const KEY = "omoide.me";

export type Me = { familyId: string; memberId: string };

export function loadMe(familyId: string): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Me>;
    if (v.familyId !== familyId || typeof v.memberId !== "string") return null;
    return v.memberId;
  } catch {
    return null;
  }
}

export function saveMe(me: Me | null): void {
  try {
    if (me) localStorage.setItem(KEY, JSON.stringify(me));
    else localStorage.removeItem(KEY);
  } catch {
    // 覚えられない端末では、開くたびに選ぶ
  }
}
