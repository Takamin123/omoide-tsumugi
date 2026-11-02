// 開発用の確かめページ（/check）。家族向けの画面ではないので、言葉は words.ts に入れずここに置く。
// 人がスマホで開き、結果を「記録を写す」で写して docs/decisions/ に残す。
import { useEffect, useRef, useState } from "react";
import { checkTranscribeFieldNames, checkTranscribeModels, type CheckTranscribeResult } from "../../shared/check";
import { canRecord, preferredTypes, startRecording, type Recording } from "../lib/recorder";
import { AUDIO_FILE_ACCEPT } from "../lib/voice";
import { inspectAudio, inspectPhoto } from "./inspect";
import {
  buildReport,
  FIELD_TEMPLATES,
  pickTimings,
  SPEECH_RATES,
  SPEECH_SAMPLES,
  TRANSCRIBE_SAMPLE,
  UNSPOKEN_KEYWORD,
  type AudioRow,
  type Field,
  type Model,
  type PhotoPicker,
  type PhotoRow,
  type TimingRow,
  type TranscribeRow,
  type VoiceRow,
} from "./report";

type PhotoView = { id: number; row: PhotoRow; location: { latitude: number; longitude: number } | null };
type AudioView = { id: number; row: AudioRow; blob: Blob; url: string };
type FieldName = (typeof checkTranscribeFieldNames)[number];

let nextId = 1;

/** このページだけの見た目。ふだんの画面の styles.css には入れない */
const checkCss = `
.check table { border-collapse: collapse; font-size: 0.85rem; }
.check td, .check th { border: 1px solid #ccc; padding: 0.2rem 0.4rem; text-align: left; vertical-align: top; }
.check .scroll-x { overflow-x: auto; max-width: 100%; }
.check pre { white-space: pre-wrap; word-break: break-all; font-size: 0.8rem; max-height: 20rem; overflow: auto; }
.check textarea, .check input[type="text"] { width: 100%; font-size: 1rem; }
.check .row input[type="text"] { flex: 1; min-width: 6rem; }
.check audio { max-width: 12rem; }
.check-result { border-top: 1px solid #ccc; padding-top: 0.5rem; }
`;

function recorderSupport(): { type: string; supported: boolean | null }[] {
  const has = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
  return preferredTypes.map((type) => ({ type, supported: has ? MediaRecorder.isTypeSupported(type) : null }));
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const sec = (ms: number | null) => (ms == null ? "-" : `${(ms / 1000).toFixed(2)} 秒`);

export default function CheckPage() {
  // ---- 写真 ----
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function onPhotos(files: File[], picker: PhotoPicker) {
    if (files.length === 0) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      for (const f of files) {
        const r = await inspectPhoto(f, picker);
        setPhotos((p) => [...p, { id: nextId++, ...r }]);
      }
    } catch (e) {
      setPhotoError(String(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  // ---- 録音 ----
  const [support] = useState(recorderSupport);
  const [audios, setAudios] = useState<AudioView[]>([]);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function addAudio(blob: Blob, source: "mic" | "file", durationMs: number | null) {
    const row = await inspectAudio(blob, source, durationMs);
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    setAudios((a) => [...a, { id: nextId++, row, blob, url }]);
  }

  async function toggleRecording() {
    setAudioError(null);
    if (recording) {
      setRecording(null);
      try {
        const { blob, durationMs } = await recording.stop();
        await addAudio(blob, "mic", durationMs);
      } catch (e) {
        setAudioError(String(e));
      }
      return;
    }
    try {
      setRecording(await startRecording());
    } catch (e) {
      setAudioError(String(e));
    }
  }

  // ---- 文字起こし ----
  const [model, setModel] = useState<Model>("gpt-transcribe");
  const [fields, setFields] = useState<Field[]>(FIELD_TEMPLATES[0]!.fields);
  const [transcribes, setTranscribes] = useState<TranscribeRow[]>([]);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const lastAudio = audios[audios.length - 1];

  async function transcribe() {
    if (!lastAudio) return;
    setSending(true);
    setSendNote(null);
    const form = new FormData();
    // ファイル名は送らない（サーバーが本番と同じ付け方で名前を付ける）
    form.append("audio", lastAudio.blob, "check-audio");
    form.append("params", JSON.stringify({ model, fields }));
    const base = { source: lastAudio.row.source, model, fields } as const;
    try {
      const res = await fetch("/api/check/transcribe", { method: "POST", body: form, credentials: "same-origin" });
      if (res.status === 401) setSendNote("家族の合言葉で入った端末で開いてください");
      else if (res.status === 404) setSendNote("本番では使えません");
      let body: unknown = await res.text();
      try {
        body = JSON.parse(body as string);
      } catch {
        // 文字のまま
      }
      if (res.ok) {
        const r = body as CheckTranscribeResult;
        setTranscribes((t) => [
          ...t,
          {
            ...base,
            httpStatus: res.status,
            openaiStatus: r.status,
            networkError: r.networkError,
            elapsedMs: r.elapsedMs,
            sentContentType: r.sent?.contentType ?? null,
            acceptedByNarrations: r.acceptedByNarrations,
            body: r.body,
          },
        ]);
      } else {
        setTranscribes((t) => [
          ...t,
          {
            ...base,
            httpStatus: res.status,
            openaiStatus: null,
            networkError: null,
            elapsedMs: null,
            sentContentType: null,
            acceptedByNarrations: null,
            body,
          },
        ]);
      }
    } catch (e) {
      setSendNote(`届かなかった: ${String(e)}`);
    } finally {
      setSending(false);
    }
  }

  // ---- 読み上げ ----
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [rate, setRate] = useState<number>(1.0);
  const [sampleIndex, setSampleIndex] = useState(0);
  const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => {
    if (!hasSpeech) return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => /^ja\b/i.test(v.lang.replace("_", "-"))));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, [hasSpeech]);

  function speak(voice: SpeechSynthesisVoice) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(SPEECH_SAMPLES[sampleIndex]);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;
    speechSynthesis.speak(u);
  }

  // ---- 記録 ----
  const [memo, setMemo] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  async function copyReport() {
    const voiceRows: VoiceRow[] = voices.map((v) => ({
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
    }));
    const text = buildReport({
      device: {
        userAgent: navigator.userAgent,
        screenWidth: screen.width,
        innerWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
        at: new Date().toString(),
      },
      recorderSupport: support,
      photos: photos.map((p) => p.row),
      audios: audios.map((a) => a.row),
      transcribes,
      voices: voiceRows,
      memo,
    });
    setFallback(null);
    setCopied(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("写しました");
    } catch {
      setFallback(text);
    }
  }

  return (
    <main className="stack check">
      <style>{checkCss}</style>
      <h1>確かめ（開発用）</h1>

      <section className="stack">
        <h2>1. 写真</h2>
        <p className="sub">端末の中だけで調べる。どこにも送らない。</p>
        <label className="button" aria-disabled={photoBusy}>
          (a) accept=image/* で選ぶ
          <input
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            disabled={photoBusy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void onPhotos(files, "accept-image");
            }}
          />
        </label>
        <label className="button" aria-disabled={photoBusy}>
          (b) accept なしで選ぶ
          <input
            type="file"
            multiple
            className="visually-hidden"
            disabled={photoBusy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void onPhotos(files, "no-accept");
            }}
          />
        </label>
        {photoBusy && <p>調べています…</p>}
        {photoError && <p role="alert">{photoError}</p>}
        {photos.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>選び方</th>
                  <th>拡張子</th>
                  <th>type</th>
                  <th>大きさ</th>
                  <th>撮影日</th>
                  <th>位置（丸め）</th>
                  <th>EXIF</th>
                  <th>縮小</th>
                </tr>
              </thead>
              <tbody>
                {photos.map(({ id, row, location }) => (
                  <tr key={id}>
                    <td>{row.picker === "accept-image" ? "a" : "b"}</td>
                    <td>{row.ext || "-"}</td>
                    <td>{row.mime || "(空)"}</td>
                    <td>{kb(row.size)}</td>
                    <td>{row.takenAt ?? "なし"}</td>
                    <td>{location ? `${location.latitude}, ${location.longitude}` : "なし"}</td>
                    <td>{row.exifTags == null ? "読めない" : row.exifTags.length > 0 ? row.exifTags.join(", ") : "なし"}</td>
                    <td>
                      {row.resize.ok
                        ? `${row.resize.width}x${row.resize.height} ${kb(row.resize.size)}`
                        : `失敗 ${row.resize.error}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack">
        <h2>2. 録音</h2>
        <table>
          <tbody>
            {support.map((s) => (
              <tr key={s.type}>
                <td>{s.type}</td>
                <td>{s.supported == null ? "MediaRecorder なし" : s.supported ? "○" : "×"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sample">例文: {TRANSCRIBE_SAMPLE}</p>
        <p className="sub">架空の例文だけを読む。家族の語りは録らない（記録は docs/ に残るため）。</p>
        <button type="button" className={recording ? "primary" : undefined} onClick={() => void toggleRecording()} disabled={!canRecord()}>
          {recording ? "止める" : "マイクで録音"}
        </button>
        <label className="button">
          録音済みファイルを選ぶ（アプリと同じ accept）
          <input
            type="file"
            accept={AUDIO_FILE_ACCEPT}
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void addAudio(f, "file", null).catch((err) => setAudioError(String(err)));
            }}
          />
        </label>
        <label className="button">
          録音済みファイルを選ぶ（accept なし）
          <input
            type="file"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void addAudio(f, "file", null).catch((err) => setAudioError(String(err)));
            }}
          />
        </label>
        {audioError && <p role="alert">{audioError}</p>}
        {audios.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>入力</th>
                  <th>type</th>
                  <th>大きさ</th>
                  <th>録音の長さ</th>
                  <th>decode</th>
                  <th>受け取り</th>
                  <th>再生</th>
                </tr>
              </thead>
              <tbody>
                {audios.map(({ id, row, url }) => (
                  <tr key={id}>
                    <td>{row.source === "mic" ? "マイク" : `ファイル(${row.ext || "-"})`}</td>
                    <td>{row.type || "(空)"}</td>
                    <td>{kb(row.size)}</td>
                    <td>{sec(row.durationMs)}</td>
                    <td>{row.decodeError ? `読めない ${row.decodeError}` : sec(row.decodedMs)}</td>
                    <td>{row.acceptedByNarrations ? "○" : "×"}</td>
                    <td>
                      <audio controls src={url} preload="metadata" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack">
        <h2>3. 文字起こし</h2>
        <p className="sub">
          送るもの: {lastAudio ? `最後の録音（${lastAudio.row.source === "mic" ? "マイク" : "ファイル"} ${lastAudio.row.type}）` : "まだ録音がない"}
        </p>
        <label>
          モデル{" "}
          <select value={model} onChange={(e) => setModel(e.target.value as Model)}>
            {checkTranscribeModels.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <div className="row">
          {FIELD_TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                setFields(t.fields.map((f) => [...f] as Field));
                if (t.model) setModel(t.model);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {fields.map(([name, value], i) => (
          <div className="row" key={i}>
            <select
              value={name}
              onChange={(e) =>
                setFields((fs) => fs.map((f, j) => (j === i ? [e.target.value as FieldName, f[1]] : f)))
              }
            >
              {checkTranscribeFieldNames.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <input
              type="text"
              value={value}
              onChange={(e) => setFields((fs) => fs.map((f, j) => (j === i ? [f[0], e.target.value] : f)))}
            />
            <button type="button" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}>
              消す
            </button>
          </div>
        ))}
        <div className="row">
          <button type="button" onClick={() => setFields((fs) => [...fs, ["language", ""]])}>
            欄を足す
          </button>
          <button type="button" onClick={() => setFields((fs) => [...fs, [...UNSPOKEN_KEYWORD] as Field])}>
            言わない語を足す（{UNSPOKEN_KEYWORD[0]}={UNSPOKEN_KEYWORD[1]}）
          </button>
        </div>
        <p className="sub">
          「{UNSPOKEN_KEYWORD[1]}」は例文で言わない語。本文に書き足されていないかを見る。
        </p>
        <button type="button" className="primary" onClick={() => void transcribe()} disabled={!lastAudio || sending}>
          {sending ? "送っています…" : "送る"}
        </button>
        {sendNote && <p role="alert">{sendNote}</p>}
        {transcribes
          .map((t, i) => ({ t, i }))
          .reverse()
          .map(({ t, i }) => (
            <TranscribeResult key={i} n={i + 1} t={t} />
          ))}
      </section>

      <section className="stack">
        <h2>4. 読み上げ</h2>
        {!hasSpeech && <p>speechSynthesis なし</p>}
        <label>
          例文{" "}
          <select value={sampleIndex} onChange={(e) => setSampleIndex(Number(e.target.value))}>
            {SPEECH_SAMPLES.map((s, i) => (
              <option key={s} value={i}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          速さ
          {SPEECH_RATES.map((r) => (
            <button key={r} type="button" className={rate === r ? "primary" : undefined} onClick={() => setRate(r)}>
              {r.toFixed(1)}
            </button>
          ))}
        </div>
        {hasSpeech && voices.length === 0 && <p>日本語の声が見つからない</p>}
        {voices.map((v, i) => (
          <div className="row" key={`${v.name}-${i}`}>
            <button type="button" onClick={() => speak(v)}>
              読む
            </button>
            <span>
              {v.name} / {v.lang} / local={String(v.localService)} / default={String(v.default)}
            </span>
          </div>
        ))}
      </section>

      <section className="stack">
        <h2>記録</h2>
        <label className="stack">
          メモ（声の自然さなど、聞いた感じ）
          <textarea rows={4} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <button type="button" className="primary" onClick={() => void copyReport()}>
          記録を写す
        </button>
        {copied && <p>{copied}</p>}
        {fallback != null && (
          <>
            <p>写せなかったので、下から手で写してください。</p>
            <textarea rows={12} readOnly value={fallback} onFocus={(e) => e.currentTarget.select()} />
          </>
        )}
      </section>
    </main>
  );
}

function Timings({ title, rows }: { title: string; rows: TimingRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{title}</th>
          <th>start</th>
          <th>end</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.text}</td>
            <td>{r.start ?? "-"}</td>
            <td>{r.end ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TranscribeResult({ n, t }: { n: number; t: TranscribeRow }) {
  const timings = pickTimings(t.body);
  return (
    <div className="stack check-result">
      <h3>
        {n}. {t.model}（{t.source === "mic" ? "マイク" : "ファイル"}）
      </h3>
      <p>
        HTTP {t.httpStatus} / OpenAI {t.openaiStatus ?? "-"}
        {t.networkError ? ` / ${t.networkError}` : ""} / {t.elapsedMs == null ? "-" : `${t.elapsedMs} ms`}
      </p>
      <p>
        送った type: {t.sentContentType ?? "-"} / 語りの受け取り:{" "}
        {t.acceptedByNarrations == null ? "-" : t.acceptedByNarrations ? "受け付ける" : "受け付けない"}
      </p>
      <ul>
        {t.fields.map(([k, v], i) => (
          <li key={i}>
            {k} = {JSON.stringify(v)}
          </li>
        ))}
      </ul>
      {timings.words && <Timings title={`words（${timings.wordCount} 個）`} rows={timings.words} />}
      {timings.segments && <Timings title={`segments（${timings.segmentCount} 個）`} rows={timings.segments} />}
      <pre>{typeof t.body === "string" ? t.body : JSON.stringify(t.body, null, 2)}</pre>
    </div>
  );
}
