// 声の語りの文字起こしを待って一覧を読み直す（0052）。判断と段取りは React に頼らない lib/transcriptFollow.ts で確かめる。
// Home の配線（0051 の読み直しと読み込みをまとめる、「読み込み中」に戻さない、並びと見ている写真を動かさない）は、ソースの形で確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const {
  pendingVoiceIds,
  trackPending,
  followDelay,
  feedReader,
  keepsOpenReply,
  followTranscripts,
  NO_PENDING,
  FOLLOW_FAST_MS,
  FOLLOW_SLOW_MS,
  FOLLOW_FAST_FOR_MS,
  FOLLOW_STOP_AFTER_MS,
} = await load("../../src/client/lib/transcriptFollow");

const SEC = 1_000;
const voice = (id: string, transcriptStatus = "pending") => ({ id, kind: "voice", transcriptStatus });
const text = (id: string) => ({ id, kind: "text", transcriptStatus: "done" });
const feedOf = (...narrations: any[]) => [{ narrations }];

describe("待っている声の語り", () => {
  it("文字起こしが pending の声の語りだけを拾う（だれの声かは問わない。写真をまたいで）", () => {
    const items = [{ narrations: [voice("a"), voice("b", "done"), text("c")] }, { narrations: [voice("d"), voice("e", "failed")] }];
    expect(pendingVoiceIds(items)).toEqual(["a", "d"]);
    expect(pendingVoiceIds(null)).toEqual([]);
  });
});

describe("次に読むまでの間隔", () => {
  it("pending がなければ読まない", () => {
    const t = trackPending(NO_PENDING, [], 0);
    expect(t.since).toBeNull();
    expect(followDelay({ now: 0, since: t.since, hidden: false })).toBeNull();
  });

  it("最初の 30 秒は 3 秒ごと、その後は 10 秒ごと、2 分でやめる", () => {
    expect(FOLLOW_FAST_MS).toBe(3 * SEC);
    expect(FOLLOW_SLOW_MS).toBe(10 * SEC);
    expect(FOLLOW_FAST_FOR_MS).toBe(30 * SEC);
    expect(FOLLOW_STOP_AFTER_MS).toBe(120 * SEC);
    const since = 1_000;
    const d = (elapsed: number) => followDelay({ now: since + elapsed, since, hidden: false });
    expect(d(0)).toBe(3 * SEC);
    expect(d(30 * SEC - 1)).toBe(3 * SEC);
    expect(d(30 * SEC)).toBe(10 * SEC);
    expect(d(120 * SEC - 1)).toBe(10 * SEC);
    expect(d(120 * SEC)).toBeNull();
  });

  it("裏にいる間は読まない", () => {
    expect(followDelay({ now: 1_000, since: 1_000, hidden: true })).toBeNull();
  });

  it("同じ語りが pending のままでも数え直さない（2 分でやめる）", () => {
    const t1 = trackPending(NO_PENDING, ["a"], 0);
    const t2 = trackPending(t1, ["a"], 100 * SEC);
    expect(t2.since).toBe(0);
    expect(followDelay({ now: 120 * SEC, since: t2.since, hidden: false })).toBeNull();
  });

  it("新しい pending の語りが現れたら、そこから数え直す（また 3 秒ごとに読む）", () => {
    const t1 = trackPending(NO_PENDING, ["a"], 0);
    const t2 = trackPending(t1, ["a", "b"], 150 * SEC);
    expect(t2.since).toBe(150 * SEC);
    expect(followDelay({ now: 151 * SEC, since: t2.since, hidden: false })).toBe(3 * SEC);
  });

  it("全部 done / failed になったらやめる。前に見た語りがまた来ても数え直さない", () => {
    const t1 = trackPending(NO_PENDING, ["a"], 0);
    const t2 = trackPending(t1, [], 5 * SEC);
    expect(t2.since).toBeNull();
    expect(followDelay({ now: 5 * SEC, since: t2.since, hidden: false })).toBeNull();
    expect(trackPending(t2, ["a"], 6 * SEC).since).toBeNull();
  });
});

describe("一覧の読み込みをまとめる", () => {
  const deferred = () => {
    let resolve!: (v: any) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<any>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };

  it("読み込み中のものがあれば乗る（0051 の読み直しと待ちの読み直しが重ならない）", async () => {
    const calls: ReturnType<typeof deferred>[] = [];
    const r = feedReader(() => {
      const d = deferred();
      calls.push(d);
      return d.promise;
    });
    const a = r.shared();
    const b = r.shared();
    expect(calls).toHaveLength(1);
    calls[0]!.resolve("x");
    expect(await a).toEqual(await b);
    // 届いた後は新しく読む
    void r.shared();
    expect(calls).toHaveLength(2);
  });

  it("送った後の読み直し（read）は、読み込み中のものに乗らず新しく読む。待ちの読み直しはその新しいものに乗る", () => {
    let count = 0;
    const r = feedReader(() => (count++, new Promise(() => {})));
    void r.shared();
    void r.read();
    expect(count).toBe(2);
    void r.shared();
    expect(count).toBe(2);
  });

  it("後から始めた読み込みの結果を当てた後に、先に始めた読み込みが届いても当てない", async () => {
    const calls: ReturnType<typeof deferred>[] = [];
    const r = feedReader(() => {
      const d = deferred();
      calls.push(d);
      return d.promise;
    });
    const old = r.read();
    const fresh = r.read();
    calls[1]!.resolve("new");
    const f = await fresh;
    expect(r.accept(f.n)).toBe(true);
    calls[0]!.resolve("old");
    const o = await old;
    expect(r.accept(o.n)).toBe(false);
    // 同じ読み込みに乗った二人は、どちらも当ててよい
    expect(r.accept(f.n)).toBe(true);
  });

  it("失敗した読み込みの後も、次は新しく読む", async () => {
    let count = 0;
    const r = feedReader(() => (count++ === 0 ? Promise.reject(new Error("offline")) : Promise.resolve("ok")));
    await expect(r.shared()).rejects.toThrow("offline");
    expect((await r.shared()).value).toBe("ok");
  });
});

describe("返事の欄を開いている語りが消えた一覧は当てない", () => {
  it("開いていなければ当てる。開いている語りが残っていれば当てる。消えていれば当てない", () => {
    const items = feedOf(voice("a"), text("b"));
    expect(keepsOpenReply(items, null)).toBe(true);
    expect(keepsOpenReply(items, "b")).toBe(true);
    expect(keepsOpenReply(items, "gone")).toBe(false);
  });
});

describe("待ちの読み直しの段取り", () => {
  const setup = (visibility = "visible") => {
    const doc = Object.assign(new EventTarget(), { visibilityState: visibility });
    let t = 0;
    let seq = 0;
    const pending = new Map<number, { fn: () => void; at: number }>();
    const timers = {
      set: (fn: () => void, ms: number) => (pending.set(++seq, { fn, at: t + ms }), seq),
      clear: (h: number) => pending.delete(h),
    };
    const reads: number[] = [];
    let next: () => Promise<unknown> = async () => {};
    const f = followTranscripts(doc, () => t, () => (reads.push(t), next()), timers);
    /** 時計を進め、時刻の来たタイマーを順に走らせる（読み込みの Promise も流す） */
    const advance = async (ms: number) => {
      const end = t + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      t = end;
    };
    const setVisibility = (v: string) => {
      doc.visibilityState = v;
      doc.dispatchEvent(new Event("visibilitychange"));
    };
    return { f, reads, advance, setVisibility, setRead: (fn: () => Promise<unknown>) => (next = fn), pending };
  };

  it("pending がなければ読まない", async () => {
    const s = setup();
    s.f.update(feedOf(voice("a", "done"), text("b")));
    await s.advance(200 * SEC);
    expect(s.reads).toEqual([]);
  });

  it("pending があれば 3 秒ごと、30 秒を過ぎたら 10 秒ごと、2 分でやめる（読めなくても続け、2 分でやめる）", async () => {
    const s = setup();
    s.setRead(() => Promise.reject(new Error("offline")));
    s.f.update(feedOf(voice("a")));
    await s.advance(200 * SEC);
    expect(s.reads.slice(0, 10)).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30].map((x) => x * SEC));
    expect(s.reads.slice(10, 12)).toEqual([40 * SEC, 50 * SEC]);
    expect(s.reads.at(-1)).toBe(120 * SEC);
    expect(s.reads.every((r) => r <= 120 * SEC)).toBe(true);
  });

  it("文字が届いたら（pending がなくなったら）すぐやめる", async () => {
    const s = setup();
    s.setRead(async () => s.f.update(feedOf(voice("a", "done"))));
    s.f.update(feedOf(voice("a")));
    await s.advance(60 * SEC);
    expect(s.reads).toEqual([3 * SEC]);
  });

  it("2 分でやめた後に新しい声が届いたら、また読み始める", async () => {
    const s = setup();
    s.f.update(feedOf(voice("a")));
    await s.advance(130 * SEC);
    const before = s.reads.length;
    s.f.update(feedOf(voice("a"), voice("b")));
    await s.advance(3 * SEC);
    expect(s.reads.length).toBe(before + 1);
    expect(s.reads.at(-1)).toBe(133 * SEC);
  });

  it("裏にいる間は読まない。前に戻ったら続きを読む（2 分を過ぎていれば読まない）", async () => {
    const s = setup();
    s.f.update(feedOf(voice("a")));
    s.setVisibility("hidden");
    await s.advance(20 * SEC);
    expect(s.reads).toEqual([]);
    s.setVisibility("visible");
    await s.advance(3 * SEC);
    expect(s.reads).toEqual([23 * SEC]);
    s.setVisibility("hidden");
    await s.advance(200 * SEC);
    s.setVisibility("visible");
    await s.advance(60 * SEC);
    expect(s.reads).toEqual([23 * SEC]);
  });

  it("裏で開かれたときは、前に出るまで読まない", async () => {
    const s = setup("hidden");
    s.f.update(feedOf(voice("a")));
    await s.advance(10 * SEC);
    expect(s.reads).toEqual([]);
  });

  it("読んでいる間は次を重ねない（読み終えてから次を決める）", async () => {
    const s = setup();
    let finish!: () => void;
    s.setRead(() => new Promise<void>((res) => (finish = res)));
    s.f.update(feedOf(voice("a")));
    await s.advance(3 * SEC);
    // 読んでいる間に一覧が変わっても（送った後の読み直しなど）、次を重ねない
    s.f.update(feedOf(voice("a"), voice("b")));
    await s.advance(20 * SEC);
    expect(s.reads).toEqual([3 * SEC]);
    finish();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await s.advance(3 * SEC);
    expect(s.reads).toEqual([3 * SEC, 26 * SEC]);
  });

  it("片付けたら読まない", async () => {
    const s = setup();
    s.f.update(feedOf(voice("a")));
    s.f.stop();
    await s.advance(10 * SEC);
    expect(s.reads).toEqual([]);
  });
});

describe("Home の配線", () => {
  const home = fs.readFileSync(path.join(repoRoot, "src/client/screens/Home.tsx"), "utf8") as string;
  const follow = home.slice(home.indexOf("const followRead = useCallback"), home.indexOf("const nameOf"));
  const refresh = home.slice(home.indexOf("const refresh = useCallback"), home.indexOf("const followRead"));

  it("一覧を持っている間は待ちの読み直しを組み込む（祖父母・家族の両画面、今日・アルバムの両タブ）", () => {
    expect(home).toContain("useTranscriptFollow(feed, followRead);");
  });

  it("一覧の読み込みは一つにまとめる。0051 の読み直しは新しく読み（裏に回る前の古い読み込みに乗らない）、待ちの読み直しは読み込み中のものに乗る。古い結果は当てない", () => {
    expect(home).toContain("feedReader(() => api.getFeed())");
    expect(home.match(/api\.getFeed\(\)/g)).toHaveLength(1);
    expect(refresh).toContain("feed: () => feedRead.read()");
    expect(refresh).toContain("if (!feedRead.accept(n)) return;");
    expect(follow).toContain("feedRead.shared()");
    expect(follow).toContain("feedRead.accept(n)");
    const loadFeed = home.slice(home.indexOf("const loadFeed = useCallback"), home.indexOf("useEffect(() => {"));
    expect(loadFeed).toContain("feedRead.read()");
    expect(loadFeed).toContain("if (!feedRead.accept(n)) return null;");
  });

  it("静かに読む: 「読み込み中」に戻さず、失敗の文を出さず、アルバムの並びと見ている写真を動かさない", () => {
    expect(follow).not.toContain("setFeed(null)");
    expect(follow).not.toMatch(/setFeedError\((?!null)/);
    expect(follow).not.toContain("setAlbumOrder");
    expect(follow).not.toContain("setAlbumCurrent");
    expect(follow).not.toContain("setEntrance");
    expect(follow).toContain("keepsOpenReply(value.items, openReplyNow.current)");
  });

  it("段で答えている間は、一覧から「答えた」に替えない（段を消さない）", () => {
    expect(home).toMatch(/answeredHere \|\|\s*\(!dockComposing &&/);
  });
});
