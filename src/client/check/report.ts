// 開発用の確かめページ（/check）の、DOM なしで確かめられる部分。家族に見せる言葉ではないので words.ts には入れない。
// 記録（Markdown）には緯度経度・写真や録音のファイル名を入れない。組み立てる関数が、決めた欄だけを拾う。
import { AUDIO_TYPE_PATTERN, type CheckTranscribeParams } from "../../shared/check";

export type Field = CheckTranscribeParams["fields"][number];
export type Model = CheckTranscribeParams["model"];

/** 写真を選んだ部品。a: AddPhotos と同じ属性、b: accept なし */
export type PhotoPicker = "accept-image" | "no-accept";

export type PhotoRow = {
  picker: PhotoPicker;
  ext: string;
  mime: string;
  size: number;
  takenAt: string | null;
  hasLocation: boolean;
  /** exifr で読めた EXIF の項目名（値は持たない）。空なら EXIF ごと消えている。null は読めなかった */
  exifTags: string[] | null;
  resize: { ok: true; width: number; height: number; size: number } | { ok: false; error: string };
};

export type AudioSource = "mic" | "file";

export type AudioRow = {
  source: AudioSource;
  ext: string | null;
  type: string;
  size: number;
  /** マイクの録音で測った長さ。ファイルのときは null */
  durationMs: number | null;
  decodedMs: number | null;
  decodeError: string | null;
  acceptedByNarrations: boolean;
};

export type TranscribeRow = {
  source: AudioSource;
  model: string;
  fields: Field[];
  /** HTTP の結果（401 や 404 など）か、CheckTranscribeResult の要点 */
  httpStatus: number;
  openaiStatus: number | null;
  networkError: string | null;
  elapsedMs: number | null;
  sentContentType: string | null;
  acceptedByNarrations: boolean | null;
  body: unknown;
};

export type VoiceRow = { name: string; lang: string; localService: boolean; default: boolean };

export type Report = {
  device: { userAgent: string; screenWidth: number; innerWidth: number; devicePixelRatio: number; at: string };
  recorderSupport: { type: string; supported: boolean | null }[];
  photos: PhotoRow[];
  audios: AudioRow[];
  transcribes: TranscribeRow[];
  voices: VoiceRow[];
  memo: string;
};

/** 拡張子だけ（ファイル名は外に出さない） */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  return name.slice(i + 1).toLowerCase();
}

export function acceptedByNarrations(type: string): boolean {
  return AUDIO_TYPE_PATTERN.test(type);
}

export type TimingRow = { text: string; start: number | null; end: number | null };

function timingRows(list: unknown, textKey: "word" | "text", limit: number): TimingRow[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit).map((item) => {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const t = o[textKey];
    return {
      text: typeof t === "string" ? t : JSON.stringify(t ?? null),
      start: typeof o.start === "number" ? o.start : null,
      end: typeof o.end === "number" ? o.end : null,
    };
  });
}

/** 応答の本文から words / segments の始めの数個を拾う。なければ null */
export function pickTimings(
  body: unknown,
  limit = 12,
): { words: TimingRow[] | null; segments: TimingRow[] | null; wordCount: number; segmentCount: number } {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const words = Array.isArray(o.words) ? timingRows(o.words, "word", limit) : null;
  const segments = Array.isArray(o.segments) ? timingRows(o.segments, "text", limit) : null;
  return {
    words,
    segments,
    wordCount: Array.isArray(o.words) ? o.words.length : 0,
    segmentCount: Array.isArray(o.segments) ? o.segments.length : 0,
  };
}

/** 読み上げてもらう例文（文字起こし） */
export const TRANSCRIBE_SAMPLE = "昭和四十五年の夏に、鶴見川のほとりで撮った写真です。";

/** 読み上げ（speechSynthesis）の例文。家族向けの問いかけに近い短い文 */
export const SPEECH_SAMPLES = [
  "この写真は、どこで撮ったものですか。",
  "このとき、一緒にいたのは誰ですか。",
  "昭和四十五年の夏に、鶴見川のほとりで撮った写真です。",
];

export const SPEECH_RATES = [0.8, 0.9, 1.0] as const;

const PROD_PROMPT = "家族が写真を見ながら思い出を語っています。";

/**
 * 欄のひな形。公式ドキュメント（developers.openai.com/api/docs/guides/speech-to-text）の書き方を実機で試す。
 * 「本番と同じ」は src/server/adapters/openai-transcriber.ts の今の欄と同じ順（prompt は transcribePrompt(null) と同じ文）。
 * 本番の keywords[] は家族の呼ばれ方（0013）。このページは家族を読まないので、例の呼ばれ方を入れている。
 * 本番の欄を変えたら、ここも変える（test/client/check-report.test.ts が本物の送り方と照らして気づく）。
 * サーバーのコードはここから読めないので、prompt の文とモデル名（TRANSCRIBE_MODEL）を写している。
 * どのひな形もモデルを決める（前に押したひな形のモデルが残ると、別のモデルで送ってしまうため）。
 */
export const FIELD_TEMPLATES: { label: string; model: Model; fields: Field[] }[] = [
  {
    label: "本番と同じ",
    model: "gpt-transcribe",
    fields: [
      ["languages[]", "ja"],
      ["response_format", "json"],
      ["prompt", PROD_PROMPT],
      ["keywords[]", "ばあば"],
    ],
  },
  {
    label: "公式の書き方",
    model: "gpt-transcribe",
    fields: [
      ["languages[]", "ja"],
      ["prompt", PROD_PROMPT],
      ["keywords[]", "鶴見川"],
      ["keywords[]", "昭和四十五年"],
    ],
  },
  {
    label: "時刻つき（gpt-transcribe）",
    model: "gpt-transcribe",
    fields: [
      ["response_format", "verbose_json"],
      ["timestamp_granularities[]", "word"],
      ["timestamp_granularities[]", "segment"],
      ["languages[]", "ja"],
    ],
  },
  {
    label: "時刻つき（whisper-1 で比べる）",
    model: "whisper-1",
    fields: [
      ["language", "ja"],
      ["response_format", "verbose_json"],
      ["timestamp_granularities[]", "word"],
      ["timestamp_granularities[]", "segment"],
    ],
  },
  {
    label: "keywords 括弧なし",
    model: "gpt-transcribe",
    fields: [
      ["languages[]", "ja"],
      ["keywords", "鶴見川"],
    ],
  },
];

/** 例文で言わない語。keywords に入れても、本文に書き足されないかを見る */
export const UNSPOKEN_KEYWORD: Field = ["keywords[]", "多摩川"];

const BODY_LIMIT = 4_000;

const yn = (b: boolean) => (b ? "あり" : "なし");
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const sec = (ms: number | null) => (ms == null ? "-" : `${(ms / 1000).toFixed(2)} 秒`);
/** 表の中に入れる文字の | と改行を逃がす */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function table(head: string[], rows: string[][]): string {
  if (rows.length === 0) return "（なし）";
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function bodyText(body: unknown): string {
  const s = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  const t = s ?? "null";
  return t.length > BODY_LIMIT ? `${t.slice(0, BODY_LIMIT)}\n…（${t.length} 文字のうち先頭 ${BODY_LIMIT} 文字）` : t;
}

/**
 * 記録の Markdown。決めた欄だけを一つずつ拾う（渡したものに余計な欄があっても出さない）。
 * 写真は位置の有無だけ、ファイルは拡張子だけ。
 */
export function buildReport(r: Report): string {
  const out: string[] = [];
  out.push("# 実機での確かめの記録", "");
  out.push("## 端末", "");
  out.push(`- userAgent: ${r.device.userAgent}`);
  out.push(`- 画面の幅: screen ${r.device.screenWidth}px / window ${r.device.innerWidth}px / dpr ${r.device.devicePixelRatio}`);
  out.push(`- 日時: ${r.device.at}`, "");

  out.push("## 写真（撮影日と位置）", "");
  out.push(
    table(
      ["選び方", "拡張子", "type", "大きさ", "撮影日", "位置", "EXIF", "縮小"],
      r.photos.map((p) => [
        p.picker === "accept-image" ? "accept=image/*" : "accept なし",
        p.ext || "-",
        p.mime || "(空)",
        kb(p.size),
        p.takenAt ?? "なし",
        yn(p.hasLocation),
        p.exifTags == null ? "読めない" : p.exifTags.length > 0 ? `あり（${p.exifTags.join(", ")}）` : "なし",
        p.resize.ok ? `できた ${p.resize.width}x${p.resize.height} ${kb(p.resize.size)}` : `失敗 ${p.resize.error}`,
      ]),
    ),
    "",
  );

  out.push("## 録音の形式（MediaRecorder.isTypeSupported）", "");
  out.push(
    table(
      ["候補", "対応"],
      r.recorderSupport.map((s) => [s.type, s.supported == null ? "MediaRecorder なし" : s.supported ? "○" : "×"]),
    ),
    "",
  );

  out.push("## 録音（マイクと録音済みファイル）", "");
  out.push(
    table(
      ["入力", "拡張子", "type", "大きさ", "録音の長さ", "decodeAudioData", "語りの受け取り"],
      r.audios.map((a) => [
        a.source === "mic" ? "マイク" : "ファイル",
        a.ext ?? "-",
        a.type || "(空)",
        kb(a.size),
        sec(a.durationMs),
        a.decodeError ? `読めない（${a.decodeError}）` : sec(a.decodedMs),
        a.acceptedByNarrations ? "受け付ける" : "受け付けない",
      ]),
    ),
    "",
  );

  out.push("## 文字起こし", "");
  out.push(`例文: ${TRANSCRIBE_SAMPLE}`, "");
  if (r.transcribes.length === 0) out.push("（なし）", "");
  r.transcribes.forEach((t, i) => {
    out.push(`### ${i + 1}. ${t.model}（${t.source === "mic" ? "マイク" : "ファイル"}）`, "");
    out.push(`- HTTP: ${t.httpStatus} / OpenAI: ${t.openaiStatus ?? "-"}${t.networkError ? ` / ${t.networkError}` : ""}`);
    out.push(`- 所要時間: ${t.elapsedMs == null ? "-" : `${t.elapsedMs} ms`}`);
    out.push(`- 送った type: ${t.sentContentType ?? "-"} / 語りの受け取り: ${t.acceptedByNarrations == null ? "-" : t.acceptedByNarrations ? "受け付ける" : "受け付けない"}`);
    out.push("- 欄:");
    for (const [name, value] of t.fields) out.push(`  - \`${name}\` = ${JSON.stringify(value)}`);
    const timings = pickTimings(t.body);
    if (timings.words) out.push(`- words: ${timings.wordCount} 個`);
    if (timings.segments) out.push(`- segments: ${timings.segmentCount} 個`);
    out.push("", "```json", bodyText(t.body), "```", "");
  });

  out.push("## 読み上げ（speechSynthesis の日本語の声）", "");
  out.push(
    table(
      ["名前", "lang", "localService", "default"],
      r.voices.map((v) => [v.name, v.lang, String(v.localService), String(v.default)]),
    ),
    "",
  );

  out.push("## メモ", "", r.memo.trim() || "（なし）", "");
  return out.join("\n");
}
