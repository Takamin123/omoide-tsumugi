// 文字起こしの欄（0013）を、受け取りから OpenAI に送る multipart まで通して確かめる（qa-engineer）。
// 本物の OpenAI は呼ばない。偽の fetch で送られた欄を見る。架空のデータだけを使う。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpenAITranscriber, MAX_TRANSCRIBE_KEYWORDS, transcribePrompt } from "../src/server/adapters/openai-transcriber";
import { addMember, addPhoto, createFamily, fakeTranscriber, makeTestApp, postForm, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const fakeAudio = { bytes: new Uint8Array([1, 2, 3, 4]), type: "audio/webm;codecs=opus" };

function voiceForm(speakerMemberId: string, photoId: string, text: string | null = null, kind: "voice" | "text" = "voice"): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind, speakerMemberId, photoId, entranceId: null, replyToId: null, text }));
  if (kind === "voice") form.append("audio", new File([fakeAudio.bytes], "a", { type: fakeAudio.type }));
  return form;
}

/** 本物のアダプタを、偽の fetch で動かす。送られた multipart を覚える。 */
function realAdapterApp(respond: (n: number) => Response = () => Response.json({ text: "架空の文字起こし" })): {
  t: TestApp;
  forms: FormData[];
} {
  const forms: FormData[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    forms.push(init.body as FormData);
    return respond(forms.length);
  };
  const real = createOpenAITranscriber("fake-key", fetchImpl as unknown as typeof fetch);
  const tr = Object.assign(fakeTranscriber(), { transcribe: real.transcribe });
  return { t: makeTestApp(d1, { transcriber: tr }), forms };
}

describe("文字起こしの欄（受け取りから multipart まで）", () => {
  it("languages[]=ja が一つだけ、language はない。keywords[] は呼ばれ方だけで、続柄・方言の地域・語りの文・ほかの家族は入らない", async () => {
    const { t, forms } = realAdapterApp();
    const other = await createFamily(t);
    await addMember(t, other.cookie, { calledAs: "よその架空のおじちゃん" });
    const f = await createFamily(t);
    const g = await addMember(t, f.cookie, {
      role: "elder",
      relation: "架空の続柄そふ",
      calledAs: "架空のじっちゃ",
      speechStyle: "dialect",
      dialectRegion: "架空の里",
    });
    const m = await addMember(t, f.cookie, { relation: "架空の続柄まご", calledAs: "架空のたっくん" });
    const p = await addPhoto(t, f.cookie, g.id, 1, { latitude: 35.5, longitude: 139.6 });
    // 先に打った文の語り（家族が語ったことでも、今は keywords に入れない）
    expect((await postForm(t, "/api/narrations", voiceForm(m.id, p.id, "架空の川で釣りをした", "text"), f.cookie)).status).toBe(202);
    expect((await postForm(t, "/api/narrations", voiceForm(g.id, p.id), f.cookie)).status).toBe(202);
    await t.flush();

    expect(forms).toHaveLength(1);
    const form = forms[0]!;
    expect(form.getAll("languages[]")).toEqual(["ja"]);
    expect(form.has("language")).toBe(false);
    expect(form.has("keywords")).toBe(false);
    expect([...form.getAll("keywords[]")].sort()).toEqual(["架空のじっちゃ", "架空のたっくん"].sort());
    // prompt は場面と話し方だけ。固有名詞は並ばない
    const prompt = String(form.get("prompt"));
    expect(prompt).toBe(transcribePrompt("架空の里"));
    expect(prompt).not.toContain("架空のじっちゃ");
    expect(prompt).not.toContain("架空のたっくん");
    // 欄の名前は決まったものだけ
    expect(new Set([...form.keys()])).toEqual(new Set(["file", "model", "languages[]", "response_format", "prompt", "keywords[]"]));
  });

  it("禁止文字（<、>、改行）を含む呼ばれ方は送らず、重複はまとめる。文字起こし自体は通る", async () => {
    const { t, forms } = realAdapterApp();
    const f = await createFamily(t);
    const g = await addMember(t, f.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあちゃ" });
    await addMember(t, f.cookie, { calledAs: "<架空>" });
    await addMember(t, f.cookie, { calledAs: "架空\nのけん" });
    await addMember(t, f.cookie, { calledAs: "架空のばあちゃ" }); // 同じ呼ばれ方の人がもう一人
    const p = await addPhoto(t, f.cookie, g.id, 1);
    const res = await postForm(t, "/api/narrations", voiceForm(g.id, p.id), f.cookie);
    expect(res.status).toBe(202);
    await t.flush();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.getAll("keywords[]")).toEqual(["架空のばあちゃ"]);
    const list = (await (await t.app.request(`/api/narrations?photoId=${p.id}`, { headers: { Cookie: f.cookie } })).json()) as {
      narrations: { transcriptStatus: string }[];
    };
    expect(list.narrations[0]!.transcriptStatus).toBe("done");
  });

  it("家族の人数が上限を超えても、keywords[] は上限まで。ログには候補の数だけ", async () => {
    const { t, forms } = realAdapterApp();
    const f = await createFamily(t);
    const g = await addMember(t, f.cookie, { role: "elder", relation: "祖父", calledAs: "架空の呼び名0" });
    const total = MAX_TRANSCRIBE_KEYWORDS + 3;
    for (let i = 1; i < total; i++) await addMember(t, f.cookie, { calledAs: `架空の呼び名${i}` });
    const p = await addPhoto(t, f.cookie, g.id, 1);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    try {
      expect((await postForm(t, "/api/narrations", voiceForm(g.id, p.id), f.cookie)).status).toBe(202);
      await t.flush();
    } finally {
      spy.mockRestore();
    }
    expect(forms[0]!.getAll("keywords[]")).toHaveLength(MAX_TRANSCRIBE_KEYWORDS);
    const done = logs.find((l) => l.includes("transcribe_done"));
    expect(JSON.parse(done!)).toMatchObject({ status: "done", keywordCandidates: total });
    for (const l of logs) expect(l).not.toMatch(/架空の呼び名/);
  });

  // やり直しの待ち（2 秒）は本物の時計で待つ。偽の時計は手元の D1（miniflare）の通信を止めてしまう
  it("やり直し（500 の後）でも、同じ keywords[] と languages[] を送る", async () => {
    const { t, forms } = realAdapterApp((n) => (n === 1 ? new Response("{}", { status: 500 }) : Response.json({ text: "架空" })));
    const f = await createFamily(t);
    const g = await addMember(t, f.cookie, { role: "elder", relation: "祖母", calledAs: "架空のおばば" });
    const p = await addPhoto(t, f.cookie, g.id, 1);
    expect((await postForm(t, "/api/narrations", voiceForm(g.id, p.id), f.cookie)).status).toBe(202);
    await t.flush();
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.getAll("keywords[]")).toEqual(["架空のおばば"]);
      expect(form.getAll("languages[]")).toEqual(["ja"]);
      expect(form.has("language")).toBe(false);
    }
  }, 15_000);
});
