// 裏から前に戻ったときの読み直し（0051）。判断・静かな読み直し・listener は React に頼らない lib/useResumeRefresh.ts で確かめる。
// Home の配線（静かな読み直しが「読み込み中」に戻さない、アルバムの並びと見ている写真を動かさない）は、ソースの形で確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { jstDay, shouldRefreshOnResume, homeBusy, refreshQuietly, watchResume, RESUME_REFRESH_AFTER_MS } = await load(
  "../../src/client/lib/useResumeRefresh",
);

const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;

describe("前に戻ったときに読み直すか", () => {
  const base = { busy: false };
  it("家族の一日が替わったら（日本時間 3:00）、裏にいた時間が短くても読み直す", () => {
    // 2:58 に読み、3:01 に戻った（日本時間）
    const loadedAt = at("2026-11-05T02:58:00+09:00");
    const now = at("2026-11-05T03:01:00+09:00");
    expect(shouldRefreshOnResume({ ...base, now, loadedAt, hiddenAt: now - 2 * MIN })).toBe(true);
  });

  it("0:00 をまたいでも、3:00 より前なら日付では読み直さない", () => {
    const loadedAt = at("2026-11-04T23:58:00+09:00");
    const now = at("2026-11-05T00:01:00+09:00");
    expect(shouldRefreshOnResume({ ...base, now, loadedAt, hiddenAt: now - 2 * MIN })).toBe(false);
  });

  it("日付は UTC ではなく日本時間で比べる（UTC で日が替わっても日本時間で同じ日なら替わっていない）", () => {
    const loadedAt = at("2026-11-04T08:50:00+09:00"); // UTC では 11/03 23:50
    const now = at("2026-11-04T09:05:00+09:00"); // UTC では 11/04 00:05
    expect(jstDay(loadedAt)).toBe(jstDay(now));
    expect(shouldRefreshOnResume({ ...base, now, loadedAt, hiddenAt: now - 5 * MIN })).toBe(false);
  });

  it("同じ日で裏にいた時間が 10 分未満なら読み直さない", () => {
    const loadedAt = at("2026-11-04T09:00:00+09:00");
    const now = at("2026-11-04T09:30:00+09:00");
    expect(shouldRefreshOnResume({ ...base, now, loadedAt, hiddenAt: now - RESUME_REFRESH_AFTER_MS + 1 })).toBe(false);
  });

  it("同じ日でも裏にいた時間が 10 分以上なら読み直す", () => {
    const loadedAt = at("2026-11-04T09:00:00+09:00");
    const now = at("2026-11-04T09:30:00+09:00");
    expect(RESUME_REFRESH_AFTER_MS).toBe(10 * MIN);
    expect(shouldRefreshOnResume({ ...base, now, loadedAt, hiddenAt: now - RESUME_REFRESH_AFTER_MS })).toBe(true);
  });

  it("話している・書いている途中なら、日付が替わっていても読み直さない", () => {
    const loadedAt = at("2026-11-04T22:00:00+09:00");
    const now = at("2026-11-05T07:00:00+09:00");
    expect(shouldRefreshOnResume({ busy: true, now, loadedAt, hiddenAt: loadedAt })).toBe(false);
  });

  it("家族の一日は日本時間の 3:00 ちょうどで替わる。0:00 では替わらない（0056）", () => {
    expect(jstDay(at("2026-11-05T03:00:00+09:00"))).toBe(jstDay(at("2026-11-05T02:59:59.999+09:00")) + 1);
    expect(jstDay(at("2026-11-05T00:00:00+09:00"))).toBe(jstDay(at("2026-11-04T23:59:59.999+09:00")));
  });

  it("裏に回った時刻が分からず、同じ日なら読み直さない", () => {
    const loadedAt = at("2026-11-04T09:00:00+09:00");
    const now = at("2026-11-04T12:00:00+09:00");
    expect(shouldRefreshOnResume({ ...base, now, loadedAt, hiddenAt: null })).toBe(false);
  });

  it("まだ一度も入り口を読めていなければ読み直さない（開いたときの読み込みに任せる）", () => {
    const now = at("2026-11-05T07:00:00+09:00");
    expect(shouldRefreshOnResume({ ...base, now, loadedAt: null, hiddenAt: now - 60 * MIN })).toBe(false);
  });

  it("途中: 録音・マイク待ち・文字の欄（composing）、段の欄、返事の欄、取り直し、送っている間のどれか", () => {
    const idle = { composing: false, dockComposing: false, openReplyId: null, retaking: false, sending: false };
    expect(homeBusy(idle)).toBe(false);
    expect(homeBusy({ ...idle, composing: true })).toBe(true);
    expect(homeBusy({ ...idle, dockComposing: true })).toBe(true);
    expect(homeBusy({ ...idle, openReplyId: "n-1" })).toBe(true);
    expect(homeBusy({ ...idle, retaking: true })).toBe(true);
    expect(homeBusy({ ...idle, sending: true })).toBe(true);
  });
});

describe("静かな読み直し", () => {
  it("届いたものだけを渡す。読み込み中（undefined）は渡さない", async () => {
    const got: unknown[] = [];
    await refreshQuietly(
      { entrance: async () => ({ entrance: { id: "e-2" } }), feed: async () => ({ items: [] }) },
      { entrance: (e: unknown) => got.push(["entrance", e]), feed: (f: unknown) => got.push(["feed", f]) },
    );
    expect(got).toContainEqual(["entrance", { entrance: { id: "e-2" } }]);
    expect(got).toContainEqual(["feed", { items: [] }]);
    expect(got.some(([, v]: any) => v === undefined)).toBe(false);
  });

  it("読めなかったものは渡さない（前のものを残す）。失敗を投げない", async () => {
    const got: unknown[] = [];
    await expect(
      refreshQuietly(
        { entrance: async () => Promise.reject(new Error("offline")), feed: async () => ({ items: ["x"] }) },
        { entrance: (e: unknown) => got.push(["entrance", e]), feed: (f: unknown) => got.push(["feed", f]) },
      ),
    ).resolves.toBeUndefined();
    expect(got).toEqual([["feed", { items: ["x"] }]]);
  });
});

describe("前に戻ったことの知らせ", () => {
  const setup = (initial = "visible") => {
    const doc = Object.assign(new EventTarget(), { visibilityState: initial });
    const win = new EventTarget();
    let t = 1_000;
    const resumes: (number | null)[] = [];
    const stop = watchResume(doc, win, () => t, (hiddenAt: number | null) => resumes.push(hiddenAt));
    const visibility = (state: string) => {
      doc.visibilityState = state;
      doc.dispatchEvent(new Event("visibilitychange"));
    };
    const pageshow = (persisted: boolean) => win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
    return { doc, win, resumes, stop, visibility, pageshow, tick: (ms: number) => (t += ms), now: () => t };
  };

  it("裏に回った時刻を渡して、前に戻ったときに一度呼ぶ", () => {
    const s = setup();
    s.visibility("hidden");
    s.tick(15 * MIN);
    s.visibility("visible");
    expect(s.resumes).toEqual([1_000]);
  });

  it("裏に回らずに visible が来ても呼ばない", () => {
    const s = setup();
    s.visibility("visible");
    expect(s.resumes).toEqual([]);
  });

  it("pageshow（persisted）でも呼ぶ。visibilitychange と続けて来ても一度だけ", () => {
    const s = setup();
    s.win.dispatchEvent(new Event("pagehide"));
    s.tick(MIN);
    s.pageshow(true);
    s.visibility("visible");
    expect(s.resumes).toEqual([1_000]);
  });

  it("visibilitychange で裏に回った後の pagehide で、裏に回った時刻を上書きしない", () => {
    const s = setup();
    s.visibility("hidden");
    s.tick(5 * MIN);
    s.win.dispatchEvent(new Event("pagehide"));
    s.tick(MIN);
    s.pageshow(true);
    s.visibility("visible");
    expect(s.resumes).toEqual([1_000]);
  });

  it("二度目の裏と前でも、二度目に裏に回った時刻を渡す", () => {
    const s = setup();
    s.visibility("hidden");
    s.tick(MIN);
    s.visibility("visible");
    s.tick(MIN);
    s.visibility("hidden");
    s.tick(MIN);
    s.visibility("visible");
    expect(s.resumes).toEqual([1_000, 1_000 + 2 * MIN]);
  });

  it("persisted でない pageshow（初めて開いた）では呼ばない", () => {
    const s = setup();
    s.pageshow(false);
    expect(s.resumes).toEqual([]);
  });

  it("裏で開かれたときは、開いた時から裏にいたことにする", () => {
    const s = setup("hidden");
    s.tick(MIN);
    s.visibility("visible");
    expect(s.resumes).toEqual([1_000]);
  });

  it("片付けた後は呼ばない", () => {
    const s = setup();
    s.stop();
    s.visibility("hidden");
    s.visibility("visible");
    expect(s.resumes).toEqual([]);
  });
});

describe("Home の配線", () => {
  const home = fs.readFileSync(path.join(repoRoot, "src/client/screens/Home.tsx"), "utf8") as string;
  const refresh = home.slice(home.indexOf("const refresh = useCallback"), home.indexOf("const nameOf"));

  it("前に戻ったときの読み直しを、途中かどうかの判断と一緒に組み込む", () => {
    expect(home).toContain("useResumeRefresh({");
    expect(home).toContain("busyNow.current = homeBusy({");
    expect(home).toContain("useResumeRefresh({ busy: busyNow.current,");
    // 送れなかった答えを持っている間も途中（古い入り口の宛先のまま送り直さない）
    expect(home).toContain('sending: answer.state === "sending" || answer.state === "failed"');
    expect(home).not.toMatch(/setInterval/);
  });

  it("静かな読み直しは「読み込み中」に戻さず、失敗の文を出さず、アルバムの並びと見ている写真を動かさない", () => {
    expect(refresh).toContain("refreshQuietly(");
    expect(refresh).not.toContain("setEntrance(undefined)");
    expect(refresh).not.toMatch(/setEntranceError\((?!null)/);
    expect(refresh).not.toMatch(/setFeedError\((?!null)/);
    expect(refresh).not.toContain("setAlbumOrder");
    expect(refresh).not.toContain("setAlbumCurrent");
    expect(refresh).not.toContain("loadFeed");
  });

  it("入り口が替わったら、前の入り口に結びついた知らせと「録り直す」を消す", () => {
    expect(refresh).toContain("setAnsweredHere(false)");
    expect(refresh).toContain("setSentNotice(false)");
    expect(refresh).toContain('at === "answer" ? null : at');
    expect(refresh).toContain("clearRetake()");
  });

  it("開いたときの読み込みの途中は読み直さない。重ねて読まない。前の回（開き直し・もう一度）の結果は捨てる", () => {
    expect(refresh).toMatch(/if \(refreshing\.current \|\| shown\.current === undefined\) return;/);
    expect(refresh).toContain("const round = loadRound.current;");
    expect(refresh.match(/if \(!current\(\)\) return;/g)).toHaveLength(2);
  });

  it("読み直しの最中に話し始めたら、届いた結果を入り口・一覧とも捨てる（録音中・入力中に写真と宛先が替わらない）", () => {
    expect(refresh).toContain("const current = () => round === loadRound.current && !busyNow.current;");
  });

  it("最後に読めた時刻は、入り口が読めたときだけ進める（読めなかったときは進めない）", () => {
    const initial = home.slice(home.indexOf("api.todayEntrance().then("), home.indexOf("const { clear: clearRetake }"));
    const [ok, ng] = initial.split("(e) =>");
    expect(ok).toContain("loadedAt.current = startedAt");
    expect(ng).not.toContain("loadedAt.current");
  });

  it("途中かどうかは、前に戻った時点の値で決める（useResumeRefresh は最新の opts を ref で読む）", () => {
    const lib = fs.readFileSync(path.join(repoRoot, "src/client/lib/useResumeRefresh.ts"), "utf8") as string;
    expect(lib).toMatch(/latest\.current = opts;/);
    expect(lib).toMatch(/const \{ busy, loadedAt, refresh \} = latest\.current;/);
  });

  it("祖父母の画面も同じ Home を通る（読み直しが両方の画面に入る）", () => {
    const elder = fs.readFileSync(path.join(repoRoot, "src/client/screens/Elder.tsx"), "utf8") as string;
    expect(elder).toContain('<Home {...props} variant="elder" />');
  });
});
