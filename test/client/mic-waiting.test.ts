// マイクの許可を待っている間（押した後、録り始める前）の表示（0008 の追記）と、聞くボタンの読み上げの名前（0045 の追記）。
// 部品は react-dom/server で文字列にして確かめる（DOM なし）。待っている間は useRecorder を差し替えて作る。
// 許可を待つ一回ごとの決まり（やめた後に押し直せる）は、React に頼らない lib/mic-start.ts で確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

const recorder = { recording: false, starting: true, elapsed: null as string | null, toggle: () => {}, cancel: () => {} };
vi.mock("../../src/client/parts/VoiceRecorder", () => ({
  useRecorder: () => recorder,
  RecordingTime: () => null,
}));

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const ReplyBoxModule = await load("../../src/client/parts/ReplyBox");
const { ReplyBox } = ReplyBoxModule;
const { Narrations } = await load("../../src/client/parts/Narrations");
const { EntranceView } = await load("../../src/client/parts/EntranceView");
const { ScreenContext } = await load("../../src/client/lib/screen");
const { words } = await load("../../src/client/words");
const { createMicStart } = await load("../../src/client/lib/mic-start");

const target = { photoId: "p-1", entranceId: "e-1", replyToId: null };
const inElder = (el: any) => renderToStaticMarkup(h(ScreenContext.Provider, { value: "elder" }, el)) as string;
const inFamily = (el: any) => renderToStaticMarkup(el) as string;

describe("マイクの許可を待っている間（0008 の追記）", () => {
  it("言葉: 家族「マイクを準備しています」、祖父母「マイクを じゅんびしています」", () => {
    expect(words.screen.family.micWaiting).toBe("マイクを​準備しています");
    expect(words.screen.elder.micWaiting).toBe("マイクを じゅんび\u200Bしています");
  });
  it("家族の画面: 録るボタンの場所は押せない「マイクを準備しています」（aria-disabled）と「やめる」。「話す」「声で話す」は出さない", () => {
    recorder.starting = true;
    const html = inFamily(h(ReplyBox, { target }));
    expect(html).toContain(`<button type="button" class="primary mic-waiting phrase-break" aria-disabled="true">${words.home.micWaiting}</button>`);
    expect(html).toContain(`<button type="button" class="aux">${words.home.cancel}</button>`);
    expect(html).not.toContain(`>${words.home.speak}<`);
    expect(html).not.toContain(words.home.byVoice);
    expect(html).not.toContain(words.home.byText);
  });
  it("祖父母の画面: 「はなす」「かく」を、押せない一つのボタン「マイクを じゅんびしています」と「やめる」に替える（待つ間に「かく」へ移らせない）", () => {
    recorder.starting = true;
    const html = inElder(h(ReplyBox, { target, who: "ばあば" }));
    expect(html).toContain(`aria-disabled="true">${words.elder.micWaiting}</button>`);
    expect(html).not.toContain(words.elder.speak);
    expect(html).not.toContain(words.elder.write);
    expect(html).not.toContain("answer-choice");
    // 今日の答え（onCancel なし）にも「やめる」を出す（許可の表示が決着しないブラウザで抜け出せるように）。返事の欄にも出す
    expect(html).toContain(`<button type="button" class="aux">${words.elder.cancel}</button>`);
    const reply = inElder(h(ReplyBox, { target: { ...target, entranceId: null, replyToId: "n-1" }, onSent: () => {}, onCancel: () => {} }));
    expect(reply).toContain(`aria-disabled="true">${words.elder.micWaiting}</button>`);
    expect(reply).toContain(`>${words.elder.cancel}</button>`);
  });
  it("待っていないときは今までどおり（両画面で選ぶボタン）", () => {
    recorder.starting = false;
    expect(inFamily(h(ReplyBox, { target }))).toContain(words.home.byVoice);
    expect(inFamily(h(ReplyBox, { target }))).not.toContain("mic-waiting");
    const elder = inElder(h(ReplyBox, { target }));
    expect(elder).toContain(words.elder.speak);
    expect(elder).toContain(words.elder.write);
    expect(elder).not.toContain("mic-waiting");
  });
});

describe("聞くボタンの読み上げの名前（0045 の追記）", () => {
  it("言葉: 誰の声かを入れ、見える語を含める。呼ばれ方が分からなければ「声を聞く」", () => {
    expect(words.screen.family.listenName("ばあば")).toEqual({ play: "ばあばの声を聞く", stop: "ばあばの声を止める" });
    expect(words.screen.family.listenName(null)).toEqual({ play: "声を聞く", stop: "声を止める" });
    expect(words.screen.elder.listenName("ばあば")).toEqual({ play: "ばあばの こえを きく", stop: "ばあばの こえを とめる" });
    expect(words.screen.elder.listenName(null)).toEqual({ play: "こえを きく", stop: "こえを とめる" });
    for (const w of [words.screen.family, words.screen.elder]) {
      expect(w.listenName("ばあば").play.endsWith(w.listen)).toBe(true);
      expect(w.listenName("ばあば").stop.endsWith(w.stopVoice)).toBe(true);
    }
  });
  const voice = (id: string, speakerMemberId: string) => ({
    id,
    speakerMemberId,
    photoId: "p-1",
    entranceId: null,
    replyToId: null,
    kind: "voice",
    text: "海に行ったのよ",
    transcriptStatus: "done",
    audioUrl: `/api/narrations/${id}/audio`,
    durationMs: 13_400,
    createdAt: 1,
  });
  const names: Record<string, string> = { "m-grandma": "ばあば", "m-mother": "お母さん" };
  const props = {
    narrations: [voice("n-1", "m-grandma"), voice("n-2", "m-mother")],
    nameOf: (id: string) => names[id] ?? "",
    openReplyId: null,
    onOpenReply: () => {},
    onSent: () => {},
  };
  it("語りの欄: 声が何本並んでも、読み上げの名前で区別できる。見える文字は「聞く」「きく」のまま", () => {
    const family = inFamily(h(Narrations, props));
    expect(family).toMatch(/<button[^>]*class="aux listen"[^>]*aria-label="ばあばの声を聞く"[^>]*>.*?聞く<\/button>/);
    expect(family).toMatch(/<button[^>]*class="aux listen"[^>]*aria-label="お母さんの声を聞く"[^>]*>.*?聞く<\/button>/);
    const elder = inElder(h(Narrations, props));
    expect(elder).toMatch(/<button[^>]*class="aux listen"[^>]*aria-label="ばあばの こえを きく"[^>]*>.*?きく<\/button>/);
    expect(elder).toMatch(/<button[^>]*class="aux listen"[^>]*aria-label="お母さんの こえを きく"[^>]*>.*?きく<\/button>/);
  });
  it("入り口の引用の声も同じ名前。問いかけの読み上げ（よみあげ）には付けない", () => {
    const photo = { id: "p-1", ownerMemberId: "m-grandma", width: 1600, height: 1200, takenAt: null, hasLocation: false, imageUrl: "/api/photos/p-1/image" };
    const entrance = {
      id: "e-1",
      photo,
      question: null,
      focus: null,
      questionAudioUrl: "/api/entrances/e-1/audio",
      quote: { narrationId: "n-1", speakerMemberId: "m-grandma", text: "海に行ったのよ", audioUrl: "/api/narrations/n-1/audio", durationMs: 13_400 },
    };
    const members = [{ id: "m-grandma", calledAs: "ばあば", relation: "祖母", role: "elder" }];
    const family = inFamily(h(EntranceView, { entrance, members, variant: "family" }));
    expect(family).toContain('aria-label="ばあばの声を聞く"');
    const elder = inFamily(h(EntranceView, { entrance, members, variant: "elder" }));
    expect(elder).toContain('aria-label="ばあばの こえを きく"');
    expect(elder).toMatch(/<button type="button" class="aux listen" aria-pressed="false">.*?よみあげ<\/button>/);
  });
});

describe("マイクの許可を待つ一回ごとの決まり（lib/mic-start.ts。0008 の追記）", () => {
  /** 決着を外から決められる偽の startRecording */
  const fakeOpen = () => {
    const calls: { resolve: (r: any) => void; reject: (e: unknown) => void }[] = [];
    const open = () => new Promise((resolve, reject) => calls.push({ resolve, reject }));
    return { open, calls };
  };
  const fakeRec = () => {
    const r = { cancelled: false, cancel: () => void (r.cancelled = true) };
    return r;
  };

  it("待っている間の二度押しは無視する。許可が出たら録音を渡す", async () => {
    const { open, calls } = fakeOpen();
    const mic = createMicStart(open);
    const first = mic.start();
    expect(mic.pending).toBe(true);
    expect(await mic.start()).toEqual({ kind: "busy" });
    expect(calls).toHaveLength(1);
    const rec = fakeRec();
    calls[0]!.resolve(rec);
    expect(await first).toEqual({ kind: "started", rec });
    expect(mic.pending).toBe(false);
  });
  it("許可されなければ failed", async () => {
    const { open, calls } = fakeOpen();
    const mic = createMicStart(open);
    const p = mic.start();
    calls[0]!.reject(new Error("NotAllowedError"));
    expect(await p).toEqual({ kind: "failed" });
    expect(mic.pending).toBe(false);
  });
  it("待っている間にやめたら、決着を待たずにすぐ押し直せる。やめた試みが後で決着しても、マイクを閉じて捨てる", async () => {
    const { open, calls } = fakeOpen();
    const mic = createMicStart(open);
    const old = mic.start();
    mic.cancel();
    expect(mic.pending).toBe(false);
    // 前の許可待ちが決着しないまま（Firefox で許可の表示を閉じたとき）でも、もう一度押すと二回目を呼ぶ
    const again = mic.start();
    expect(calls).toHaveLength(2);
    expect(mic.pending).toBe(true);
    const oldRec = fakeRec();
    calls[0]!.resolve(oldRec);
    expect(await old).toEqual({ kind: "stale" });
    expect(oldRec.cancelled).toBe(true);
    // 古い試みの決着で、今の試みの待ちを終わらせない
    expect(mic.pending).toBe(true);
    const rec = fakeRec();
    calls[1]!.resolve(rec);
    expect(await again).toEqual({ kind: "started", rec });
    expect(rec.cancelled).toBe(false);
  });
  it("やめた試みが後で失敗しても、今の試みの失敗にしない", async () => {
    const { open, calls } = fakeOpen();
    const mic = createMicStart(open);
    const old = mic.start();
    mic.cancel();
    const again = mic.start();
    calls[0]!.reject(new Error("x"));
    expect(await old).toEqual({ kind: "stale" });
    expect(mic.pending).toBe(true);
    calls[1]!.resolve(fakeRec());
    expect((await again).kind).toBe("started");
  });
  it("useRecorder はこの決まりを使う（二度押しの判定は mic.pending、やめる・画面を離れるで mic.cancel）", () => {
    const src = fs.readFileSync(path.join(repoRoot, "src/client/parts/VoiceRecorder.tsx"), "utf8") as string;
    expect(src).toContain("createMicStart(startRecording)");
    expect(src).toContain("if (mic.pending || rec.current) return;");
    expect(src).toMatch(/unmounted\.current = true;[\s\S]{0,120}mic\.cancel\(\);/);
    expect(src).toMatch(/function cancel\(\) \{\s*mic\.cancel\(\);/);
  });
});

describe("段が替わったときの操作の位置（押したボタンが消えても、次の段の主なボタンへ移す）", () => {
  const { focusFollows } = ReplyBoxModule;
  const box = { contains: (el: unknown) => el === inside } as unknown as Element;
  const body = { id: "body" } as unknown as Element;
  const inside = { id: "inside" } as unknown as Element;
  const outside = { id: "outside" } as unknown as Element;
  it("位置が失われた（body・なし）か、欄の中なら移す。ほかの場所を触っているなら奪わない", () => {
    expect(focusFollows(body, body, box)).toBe(true);
    expect(focusFollows(null, body, box)).toBe(true);
    expect(focusFollows(inside, body, box)).toBe(true);
    expect(focusFollows(outside, body, box)).toBe(false);
    expect(focusFollows(body, body, null)).toBe(false);
  });
  it("待つ間・録っている間・選ぶ段の主なボタンに、移す先の印（primaryRef）が付いている", () => {
    const src = fs.readFileSync(path.join(repoRoot, "src/client/parts/ReplyBox.tsx"), "utf8");
    expect(src).toContain(`<button ref={primaryRef} type="button" className="primary mic-waiting phrase-break" aria-disabled="true">`);
    expect(src).toContain(`<button ref={primaryRef} type="button" className="primary stop" aria-pressed="true" onClick={rec.toggle}>`);
    expect(src).toMatch(/ref=\{primaryRef\}\s+type="button"\s+className=\{rec\.recording \? "primary stop" : "primary"\}/);
    expect(src.match(/ref=\{primaryRef\}/g)?.length).toBe(7);
    // 送っている間も段に数える（祖父母の画面で「おわる」→ 送れた の後、「はなす」に戻る）
    expect(src).toContain('`${mode}${failed ? "-failed" : busy ? "-busy" : ""}`');
  });
});
