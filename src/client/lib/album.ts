// 家族の画面のアルバム: 写真の帯と語りの縦の欄の連動の決まり。DOM に頼らない（test/client/ から Node で確かめる）。

/** 写真の帯と語りの縦の欄 */
export type Pane = "band" | "text";

/** 番号を 0〜count-1 に収める。count が 0 なら 0 */
export function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(i)));
}

/** 帯の横の位置から、いま正面にある写真の番号 */
export function bandIndex(scrollLeft: number, width: number, count: number): number {
  if (width <= 0) return 0;
  return clampIndex(scrollLeft / width, count);
}

/**
 * 語りの欄で、いま上にある写真の番号。
 * 節の頭（欄の中での位置 offsets[k]）が、欄の上から threshold 以内に来た最後の節。どれも来ていなければ 0
 */
export function sectionAtTop(offsets: readonly number[], scrollTop: number, threshold: number): number {
  let at = 0;
  offsets.forEach((top, k) => {
    if (top - scrollTop <= threshold) at = k;
  });
  return at;
}

/** 左右の矢印を押せるか。端では押せない */
export function arrows(index: number, count: number): { prev: boolean; next: boolean } {
  return { prev: count > 0 && index > 0, next: count > 0 && index < count - 1 };
}

/**
 * 並びを保つ。order（開いたときの写真の ID の並び）の順に items を並べ、
 * order にない新しい写真は、届いた順のまま末尾に足す（上に足すと見ている位置がずれるため）。消えた写真は除く
 */
export function keepOrder<T>(order: readonly string[], items: readonly T[], idOf: (t: T) => string): T[] {
  const byId = new Map(items.map((t) => [idOf(t), t]));
  const known = new Set(order);
  const kept = order.flatMap((id) => {
    const t = byId.get(id);
    return t ? [t] : [];
  });
  return [...kept, ...items.filter((t) => !known.has(idOf(t)))];
}

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** スクロールが止まったとみなすまでの時間 */
export const SCROLL_QUIET_MS = 150;
/** こちらから動かし始めて、スクロールが一度も来ないときに諦めるまでの時間（滑らかな動きは一、二枚の絵の後に始まる） */
export const AUTO_START_MS = 400;

/**
 * 往復の連動を止める門。
 * - 利用者が動かしている面（driver）があれば、もう片方のスクロールは連動の元にしない
 * - こちらから動かした面（auto）のスクロールは、連動の元にしない（止まるまで）
 * - 帯に触れている間は、帯を driver に固定する
 */
export class SyncGate {
  private driver: Pane | null = null;
  private driverTimer: unknown = null;
  private touching = false;
  private auto: Record<Pane, boolean> = { band: false, text: false };
  private autoTimer: Record<Pane, unknown> = { band: null, text: null };

  constructor(
    private readonly timers: Timers = defaultTimers,
    private readonly quietMs = SCROLL_QUIET_MS,
    private readonly autoStartMs = AUTO_START_MS,
  ) {}

  /**
   * 面 pane にスクロールが来た。利用者が動かしたもので、もう片方へ連動してよいなら true
   */
  scrolled(pane: Pane): boolean {
    if (this.auto[pane]) {
      this.restartAuto(pane, this.quietMs);
      return false;
    }
    if (this.driver && this.driver !== pane) return false;
    this.driver = pane;
    this.restartDriver();
    return true;
  }

  /** こちらから面 pane を動かす前に呼ぶ。止まるまで、その面のスクロールを連動の元にしない */
  moving(pane: Pane): void {
    this.auto[pane] = true;
    this.restartAuto(pane, this.autoStartMs);
  }

  /** 利用者が面 pane に触れた（指、ホイール）。こちらからの動きをやめ、その面を driver にする */
  touched(pane: Pane): void {
    this.endAuto(pane);
    this.driver = pane;
    if (pane === "band") this.touching = true;
    this.restartDriver();
  }

  /** 帯から指が離れた。止まるまでは driver のまま */
  released(): void {
    this.touching = false;
    this.restartDriver();
  }

  /** 今 driver の面（テストと確かめ用） */
  get current(): Pane | null {
    return this.driver;
  }

  isAuto(pane: Pane): boolean {
    return this.auto[pane];
  }

  dispose(): void {
    this.timers.clear(this.driverTimer);
    this.timers.clear(this.autoTimer.band);
    this.timers.clear(this.autoTimer.text);
  }

  private restartDriver() {
    this.timers.clear(this.driverTimer);
    this.driverTimer = this.timers.set(() => {
      this.driverTimer = null;
      if (this.touching) return;
      this.driver = null;
    }, this.quietMs);
  }

  private restartAuto(pane: Pane, ms: number) {
    this.timers.clear(this.autoTimer[pane]);
    this.autoTimer[pane] = this.timers.set(() => this.endAuto(pane), ms);
  }

  private endAuto(pane: Pane) {
    this.timers.clear(this.autoTimer[pane]);
    this.autoTimer[pane] = null;
    this.auto[pane] = false;
  }
}
