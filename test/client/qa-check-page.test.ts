// 開発用の確かめページ（/check）を、qa-engineer が足した確かめ。
// inspect.ts は写真の関数を偽物に差し替え、記録の行に位置・ファイル名が入らないことを見る。
// ソースの決まりごと（外へ送る口、console）も見る。架空の値だけを使い、写真・録音のファイルは使わない。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

const photosMock = vi.hoisted(() => ({
  calls: [] as string[],
  readExifFacts: vi.fn(),
  readExifTagNames: vi.fn(),
  sha256Hex: vi.fn(),
  resizeToJpeg: vi.fn(),
}));
vi.mock("../../src/client/lib/photos", () => ({
  readExifFacts: (...a: unknown[]) => (photosMock.calls.push("readExifFacts"), photosMock.readExifFacts(...a)),
  readExifTagNames: (...a: unknown[]) => (photosMock.calls.push("readExifTagNames"), photosMock.readExifTagNames(...a)),
  sha256Hex: (...a: unknown[]) => (photosMock.calls.push("sha256Hex"), photosMock.sha256Hex(...a)),
  resizeToJpeg: (...a: unknown[]) => (photosMock.calls.push("resizeToJpeg"), photosMock.resizeToJpeg(...a)),
}));

const load = (name: string): Promise<any> => import(name);
const { inspectPhoto, inspectAudio } = await load("../../src/client/check/inspect");
const { buildReport } = await load("../../src/client/check/report");

const secretName = "IMG_架空の家族_0420.JPG";
const tinyFile = (name: string, type: string) => new File([new Uint8Array([1, 2, 3, 4])], name, { type });

describe("inspectPhoto: 記録の行には位置の有無とファイルの拡張子だけ", () => {
  beforeEach(() => {
    photosMock.calls.length = 0;
    photosMock.readExifFacts.mockResolvedValue({ takenAt: "1970-08-01T10:00:00", latitude: 35.51, longitude: 139.65 });
    photosMock.readExifTagNames.mockResolvedValue(["Make"]);
    photosMock.sha256Hex.mockResolvedValue("ab".repeat(32));
    photosMock.resizeToJpeg.mockResolvedValue({ blob: new Blob([new Uint8Array(10)]), width: 1600, height: 1200 });
  });

  it("本番と同じ順に呼び、row に緯度経度とファイル名を入れない。location は別に返す", async () => {
    const { row, location } = await inspectPhoto(tinyFile(secretName, "image/jpeg"), "accept-image");
    expect(photosMock.calls).toEqual(["readExifFacts", "readExifTagNames", "sha256Hex", "resizeToJpeg"]);
    expect(location).toEqual({ latitude: 35.51, longitude: 139.65 });
    expect(row.hasLocation).toBe(true);
    expect(row.ext).toBe("jpg");
    const json = JSON.stringify(row);
    expect(json).not.toContain("35.5");
    expect(json).not.toContain("139.6");
    expect(json).not.toContain("IMG_");
    expect(json).not.toContain("架空の家族");
    // 画面と同じく row だけを記録に渡したとき、位置もファイル名も出ない
    const md = buildReport({
      device: { userAgent: "UA", screenWidth: 1, innerWidth: 1, devicePixelRatio: 1, at: "x" },
      recorderSupport: [],
      photos: [row],
      audios: [],
      transcribes: [],
      voices: [],
      memo: "",
    });
    expect(md).not.toContain("35.5");
    expect(md).not.toContain("IMG_");
  });

  it("位置が片方だけなら、なしとして扱う", async () => {
    photosMock.readExifFacts.mockResolvedValue({ takenAt: null, latitude: 35.51, longitude: null });
    const { row, location } = await inspectPhoto(tinyFile("a.heic", "image/heic"), "no-accept");
    expect(row.hasLocation).toBe(false);
    expect(location).toBeNull();
  });

  it("縮小が失敗しても落ちず、失敗の名前を行に入れる", async () => {
    const err = new Error("cannot decode");
    err.name = "UnreadableImageError";
    photosMock.resizeToJpeg.mockRejectedValue(err);
    const { row } = await inspectPhoto(tinyFile("a.heic", "image/heic"), "accept-image");
    expect(row.resize).toEqual({ ok: false, error: "UnreadableImageError: cannot decode" });
  });
});

describe("inspectAudio: マイクの Blob もファイルも同じ関数", () => {
  let closed = 0;
  function stubAudioContext(decode: () => Promise<{ duration: number }>) {
    closed = 0;
    class FakeCtx {
      decodeAudioData = decode;
      close = async () => {
        closed++;
      };
    }
    vi.stubGlobal("window", { AudioContext: FakeCtx });
  }
  afterEach(() => vi.unstubAllGlobals());

  it("ファイルは拡張子だけ、Blob は拡張子 null。名前は行に入らない", async () => {
    stubAudioContext(async () => ({ duration: 3.21 }));
    const fromFile = await inspectAudio(tinyFile("祖母の声_架空.m4a", "audio/mp4"), "file", null);
    expect(fromFile).toMatchObject({ source: "file", ext: "m4a", type: "audio/mp4", decodedMs: 3210, decodeError: null, acceptedByNarrations: true });
    expect(JSON.stringify(fromFile)).not.toContain("祖母");
    const fromMic = await inspectAudio(new Blob([new Uint8Array(4)], { type: "audio/webm;codecs=opus" }), "mic", 2000);
    expect(fromMic).toMatchObject({ source: "mic", ext: null, durationMs: 2000, acceptedByNarrations: true });
    expect(closed).toBe(2);
  });

  it("読めない形式・AudioContext がないときも落ちない", async () => {
    stubAudioContext(async () => {
      throw new DOMException("bad", "EncodingError");
    });
    const bad = await inspectAudio(new Blob([new Uint8Array(4)], { type: "" }), "mic", 1000);
    expect(bad).toMatchObject({ decodedMs: null, acceptedByNarrations: false });
    expect(bad.decodeError).toContain("EncodingError");
    expect(closed).toBe(1);
    vi.stubGlobal("window", {});
    const none = await inspectAudio(new Blob([new Uint8Array(4)], { type: "audio/mp4" }), "mic", 1000);
    expect(none).toMatchObject({ decodedMs: null, decodeError: "AudioContext なし" });
  });
});

describe("buildReport: 余計な欄（文字起こしの送ったファイル名など）を出さない", () => {
  it("transcribes や device に余計な欄があっても出さない", () => {
    const md = buildReport({
      device: { userAgent: "UA", screenWidth: 1, innerWidth: 1, devicePixelRatio: 1, at: "x", location: "35.51,139.65" },
      recorderSupport: [],
      photos: [],
      audios: [],
      transcribes: [
        {
          source: "file",
          model: "whisper-1",
          fields: [],
          httpStatus: 401,
          openaiStatus: null,
          networkError: null,
          elapsedMs: null,
          sentContentType: null,
          acceptedByNarrations: null,
          body: "unauthorized",
          sent: { fileName: secretName },
          name: secretName,
        },
      ],
      voices: [],
      memo: "",
    } as any);
    expect(md).not.toContain("IMG_");
    expect(md).not.toContain("35.51");
    expect(md).toContain("HTTP: 401");
  });
});

// ---- ソースの決まりごと ----
const checkDir = path.join(repoRoot, "src/client/check");
const checkSources = (fs.readdirSync(checkDir) as string[])
  .filter((n) => /\.(ts|tsx)$/.test(n))
  .map((n) => ({ name: n, src: fs.readFileSync(path.join(checkDir, n), "utf8") as string }));
const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("確かめページは写真の情報を外へ送らず、console にも出さない", () => {
  it("外へ送る口は fetch(\"/api/check/transcribe\") の一か所だけ", () => {
    const all = checkSources.map((f) => stripComments(f.src)).join("\n");
    const fetches = [...all.matchAll(/\bfetch\s*\(\s*([^,)]*)/g)].map((m) => m[1]!.trim());
    expect(fetches).toEqual(['"/api/check/transcribe"']);
    for (const word of ["XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "/lib/api", "localStorage", "sessionStorage", "indexedDB"]) {
      expect(all).not.toContain(word);
    }
  });

  it("console を使わない", () => {
    for (const f of checkSources) expect(stripComments(f.src), f.name).not.toMatch(/\bconsole\s*\./);
  });

  it("文字起こしに送る FormData は、録音と params だけ。録音の名前は元のファイル名を使わない", () => {
    const page = stripComments(checkSources.find((f) => f.name === "CheckPage.tsx")!.src);
    const appends = [...page.matchAll(/form\.append\((.*)\);$/gm)].map((m) => m[1]!);
    expect(appends).toHaveLength(2);
    expect(appends[0]).toBe('"audio", lastAudio.blob, "check-audio"');
    expect(appends[1]).toMatch(/^"params", JSON\.stringify\(\{ model, fields \}\)$/);
  });

  it("記録に渡す写真は row だけ（location は渡さない）", () => {
    const page = stripComments(checkSources.find((f) => f.name === "CheckPage.tsx")!.src);
    expect(page).toContain("photos: photos.map((p) => p.row)");
    const report = /buildReport\(\{[\s\S]*?\n {4}\}\);/.exec(page)?.[0] ?? "";
    expect(report).not.toMatch(/location|latitude|longitude/);
  });
});

describe("App: /check は家族の読み込みをしない", () => {
  it("needsFamily から /check を外し、家族の画面より先に返す", () => {
    const app = stripComments(fs.readFileSync(path.join(repoRoot, "src/client/App.tsx"), "utf8") as string);
    expect(app).toMatch(/const needsFamily = [^;]*path !== "\/check"/);
    const checkAt = app.indexOf('if (path === "/check")');
    expect(checkAt).toBeGreaterThan(0);
    expect(checkAt).toBeLessThan(app.indexOf("if (joinToken)"));
  });
});

describe("CheckPage を DOM なしで描ける", () => {
  it("描いても落ちず、まだ何もない状態では位置を出さない", async () => {
    const { createElement: h } = await load("react");
    const { renderToStaticMarkup } = await load("react-dom/server");
    const { default: CheckPage } = await load("../../src/client/check/CheckPage");
    const html = renderToStaticMarkup(h(CheckPage));
    expect(html).toContain("確かめ（開発用）");
    expect(html).toContain("記録を写す");
    expect(html).toContain("MediaRecorder なし");
  });
});
