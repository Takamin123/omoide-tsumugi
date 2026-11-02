// 確かめページ（/check）の「5. 問いかけの読み上げ（OpenAI）」の、ソースの決まりごと（qa-engineer）。
// 0019: 「AI の声で読みます」を欄の上と、各音声のそばにいつも出す。送るのは画面で入れた例文と設定だけ。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { requestSpeech } = await load("../../src/client/check/speech");

const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const page = stripComments(fs.readFileSync(path.join(repoRoot, "src/client/check/CheckPage.tsx"), "utf8") as string);
const sectionStart = page.indexOf("5. 問いかけの読み上げ（OpenAI）");
const sectionEnd = page.indexOf("</section>", sectionStart);
const section = page.slice(sectionStart, sectionEnd);

describe("読み上げの節の明示の文", () => {
  it("節がある", () => {
    expect(sectionStart).toBeGreaterThan(0);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
  });

  it("明示の文は、条件なしで、最初の欄（select / textarea / input）より上に出す", () => {
    const disclosure = section.indexOf('<p className="disclosure">{TTS_DISCLOSURE}</p>');
    expect(disclosure).toBeGreaterThan(0);
    const firstField = Math.min(...["<select", "<textarea", "<input"].map((t) => section.indexOf(t)).filter((i) => i >= 0));
    expect(disclosure).toBeLessThan(firstField);
    // 見出しのすぐ下。間に条件分岐（&& や ?）を挟まない
    const between = section.slice(0, disclosure);
    expect(between).not.toMatch(/&&|\?/);
  });

  it("音声ごとに、再生の部品のすぐ上に明示の文を出す", () => {
    const audios = [...section.matchAll(/<audio\b/g)];
    expect(audios).toHaveLength(1);
    expect(section).toMatch(/<p className="disclosure">\{TTS_DISCLOSURE\}<\/p>\s*<audio\b/);
  });

  it("明示の文は、字の大きさを小さくしない", () => {
    expect(page).toMatch(/\.check \.disclosure \{[^}]*font-size: 1rem;/);
  });
});

describe("送るもの", () => {
  it("読み上げに送るのは ttsParams だけ（家族のデータ・写真・録音を渡さない）", () => {
    const calls = [...page.matchAll(/requestSpeech\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(calls).toEqual(["ttsParams"]);
    for (const word of ["photos", "audios", "lastAudio", "transcribes", "family", "member", "narration"]) {
      expect(section, word).not.toContain(word);
    }
  });

  it("requestSpeech が送る本文は params の JSON だけで、Cookie は同じ場所のときだけ", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 }));
    const params = { model: "tts-1", input: "架空の文", voice: "alloy", instructions: "", speed: 1, response_format: "mp3" };
    const { row, audio } = await requestSpeech(params, fetchImpl, () => 0);
    expect(audio).toBeNull();
    expect(row).toMatchObject({ ok: false, httpStatus: 401, openaiStatus: null, body: { error: "unauthorized" } });
    const init = (fetchImpl.mock.calls[0] as any)[1] as Record<string, unknown>;
    expect(Object.keys(init).sort()).toEqual(["body", "credentials", "headers", "method"]);
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(JSON.stringify(params));
  });

  it("200 でも x-check-speech のない応答は音声として扱わない", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    const params = { model: "tts-1", input: "架空の文", voice: "alloy", instructions: "", speed: 1, response_format: "mp3" };
    const { row, audio } = await requestSpeech(params, fetchImpl, () => 0);
    expect(audio).toBeNull();
    expect(row).toMatchObject({ ok: false, httpStatus: 200, openaiStatus: null, body: "<html>" });
  });
});
