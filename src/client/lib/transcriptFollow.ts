// 声の語りの文字起こしを待って、一覧（/api/feed）を静かに読み直す（0052）。
// 手元の一覧に文字起こしが pending の声の語りがあるときだけ読む（自分の声に限らない）。新しい pending が現れてから
// 30 秒は 3 秒ごと、その後は 10 秒ごと、2 分でやめる。pending がなくなったらすぐやめる。裏にいる間は読まない。
// 画面には何も足さない（声の下に文字が出るだけ）。判断は純粋な関数にし、時計と document は外から渡す。
import { useEffect, useRef } from "react";

/** 新しい pending が現れてから、この間は FOLLOW_FAST_MS ごとに読む */
export const FOLLOW_FAST_FOR_MS = 30_000;
export const FOLLOW_FAST_MS = 3_000;
export const FOLLOW_SLOW_MS = 10_000;
/** 新しい pending が現れてから、この時間でやめる（文字起こしに失敗して pending が残っても読み続けない） */
export const FOLLOW_STOP_AFTER_MS = 2 * 60_000;

type FeedLike = readonly { narrations: readonly { id: string; kind: string; transcriptStatus: string }[] }[];

/** 一覧の中の、文字起こしを待っている声の語りの ID */
export function pendingVoiceIds(items: FeedLike | null): string[] {
  if (!items) return [];
  return items.flatMap((it) => it.narrations.filter((n) => n.kind === "voice" && n.transcriptStatus === "pending").map((n) => n.id));
}

/**
 * 待ちの読み直しの結果を当ててよいか。返事の欄を開いている語りが一覧から消えていたら当てない
 * （ほかの家族が「録り直す」で前の声を消した直後など。書きかけ・録音中の返事の欄を消さない。閉じた後の読み直しで消える）
 */
export function keepsOpenReply(items: FeedLike, openReplyId: string | null): boolean {
  return openReplyId === null || items.some((it) => it.narrations.some((n) => n.id === openReplyId));
}

export type PendingTracker = {
  /** これまでに pending として見た語りの ID（同じ語りが pending のままでも数え直さない） */
  seen: ReadonlySet<string>;
  /** 最後に新しい pending の語りが現れた時刻。今 pending がなければ null */
  since: number | null;
};

export const NO_PENDING: PendingTracker = { seen: new Set(), since: null };

/** 一覧が届いたときに、待ちの数え始めを決め直す。新しい pending が現れたら今から数え直す */
export function trackPending(prev: PendingTracker, pendingIds: readonly string[], now: number): PendingTracker {
  if (pendingIds.length === 0) return { seen: prev.seen, since: null };
  if (pendingIds.every((id) => prev.seen.has(id))) return prev;
  return { seen: new Set([...prev.seen, ...pendingIds]), since: now };
}

/** 次に読むまでの時間（ms）。読まないなら null */
export function followDelay({ now, since, hidden }: { now: number; since: number | null; hidden: boolean }): number | null {
  if (since === null || hidden) return null;
  const elapsed = now - since;
  if (elapsed >= FOLLOW_STOP_AFTER_MS) return null;
  return elapsed < FOLLOW_FAST_FOR_MS ? FOLLOW_FAST_MS : FOLLOW_SLOW_MS;
}

/** 読み込みの結果と、その読み込みを始めた順の番号 */
export type Fetched<T> = { value: T; n: number };

/**
 * 一覧の読み込みを一つにまとめる。
 * - accept(n): 当ててよいか。後から始めた読み込みの結果を当てた後に、先に始めた読み込みが届いたら false（新しい結果を古い結果で上書きしない）
 * - shared(): 読み込み中のものがあればそれに乗る（待ちの読み直しと前に戻ったときの読み直しが重ならない）
 * - read(): 常に新しく読む。送った後の読み直しに使う（送る前に始めた読み込みには、送った語りが入っていない）
 */
export function feedReader<T>(fetch: () => Promise<T>) {
  let started = 0;
  let applied = 0;
  let inFlight: Promise<Fetched<T>> | null = null;
  const read = (): Promise<Fetched<T>> => {
    const n = ++started;
    const p: Promise<Fetched<T>> = fetch()
      .then((value) => ({ value, n }))
      .finally(() => {
        if (inFlight === p) inFlight = null;
      });
    inFlight = p;
    return p;
  };
  return {
    read,
    shared: (): Promise<Fetched<T>> => inFlight ?? read(),
    accept: (n: number): boolean => {
      if (n < applied) return false;
      applied = n;
      return true;
    },
  };
}

type Doc = Pick<EventTarget, "addEventListener" | "removeEventListener"> & { visibilityState: string };

/**
 * 待ちの読み直しの段取り。一覧が変わったら update(items) を、読むときは read() を呼ぶ。片付けを返す。
 * 読み終えたら（失敗しても）次を決め直す。裏に回ったら止め、前に戻ったら続きを決める（2 分を過ぎていれば読まない）
 */
export function followTranscripts(
  doc: Doc,
  now: () => number,
  read: () => Promise<unknown>,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
) {
  let tracker = NO_PENDING;
  let timer: unknown = null;
  let reading = false;
  let stopped = false;
  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const schedule = () => {
    cancel();
    if (stopped || reading) return;
    const delay = followDelay({ now: now(), since: tracker.since, hidden: doc.visibilityState === "hidden" });
    if (delay !== null) timer = timers.set(tick, delay);
  };
  const tick = () => {
    timer = null;
    if (stopped || doc.visibilityState === "hidden") return;
    reading = true;
    void read()
      .catch(() => {})
      .finally(() => {
        reading = false;
        schedule();
      });
  };
  const onVisibility = () => (doc.visibilityState === "hidden" ? cancel() : schedule());
  doc.addEventListener("visibilitychange", onVisibility);
  return {
    update(items: FeedLike | null) {
      tracker = trackPending(tracker, pendingVoiceIds(items), now());
      schedule();
    },
    stop() {
      stopped = true;
      cancel();
      doc.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/** Home で使う。items は今の一覧、read は静かな読み直し（読み込み中のものがあれば乗る） */
export function useTranscriptFollow(items: FeedLike | null, read: () => Promise<unknown>): void {
  const readRef = useRef(read);
  readRef.current = read;
  const follow = useRef<ReturnType<typeof followTranscripts> | null>(null);
  useEffect(() => {
    const f = followTranscripts(document, Date.now, () => readRef.current());
    follow.current = f;
    return () => {
      f.stop();
      follow.current = null;
    };
  }, []);
  useEffect(() => {
    follow.current?.update(items);
  }, [items]);
}
