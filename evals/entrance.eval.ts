// 入り口づくり（entrance）の出し比べ。本物の Sonnet を、架空の家族（evals/fixtures/*.json）で呼ぶ。
// npm test には入れない。手元で ANTHROPIC_API_KEY があるときだけ動く:
//   ANTHROPIC_API_KEY=... npm run eval:entrance
//   または .dev.vars の ANTHROPIC_API_KEY（worktree では EVAL_DEV_VARS=<メインの .dev.vars> npm run eval:entrance）
//   EVAL_FIXTURE=<名前>（evals/fixtures/<名前>.json。既定は family-a）
//   EVAL_REPEAT=2 で 2 回（2 回の朝）。EVAL_OUT=<path> で書き出し先を変える（同じ名前の .json に生の結果も書く）
//   EVAL_AVOID=0 で 0042 の前を再現する: 同じ日にほかの人へ出した写真を外さず、候補の並びに返事（g0）を使わない
//   （pickEntranceCandidates にだけ replyToId を null にした語りを渡す。Claude には元のまま渡す）。既定は本番と同じ
//   EVAL_IMAGES=0 で画像を渡さない。fixtures の imageFile は EVAL_IMAGES_DIR（既定 ~/omoide-demo-seed/prepared）から読む
//   EVAL_PROMPT=v3 で entrance/v3 を名指しで呼ぶ（既定は v2。0046）。v3 では fixtures の musubi を候補の並び（g1a）と <same_event> に、
//   records をつながりの検査に使う。EVAL_MUSUBI=0 で、v3 のプロンプトのまま、むすびの入力と g1a を外す
//   fixtures の base があれば、元の家族を読んで上書きする（変種）
// 結果は docs/evals/<日本時間の日付>-entrance-<名前>-avoid<0|1>.md（v2）、docs/evals/<日付>-entrance-v3-<名前>[-nomusubi].md（v3）に書く。
// アプリと同じ部品（pickEntranceCandidates、buildEntranceInput、checkEntrance、locateQuote、pickFixedPhoto、PROMPTS）を使う。
// 毎朝の処理と同じく、一回の朝の中で fixtures の人の順に一人ずつ作り、先に作った人の写真（固定に倒れたときは固定の写真）を
// 次の人の avoidPhotoIds に渡す。過去の入り口（pastEntrances）はその人の提示の履歴として渡す。朝と朝のあいだで履歴は増やさない（同じ朝を繰り返す）
// 本番との違い: 画像のない fixtures では、写真の説明（guess）だけを渡す（focus は null だけを許す）。
// fixtures の traits・mishearings・note・expectedPresence・continuation は期待値なので、プロンプトには渡さない。
import { describe, expect, it } from "vitest";
import { createAnthropicClaude } from "../src/server/adapters/anthropic-claude";
import { CLAUDE_PURPOSES, bytesToBase64 } from "../src/server/core/claude";
import { charCount } from "../src/server/core/claude-checks";
import { UNCERTAIN_PLACEHOLDER, locateQuote, quoteText } from "../src/server/core/clean-transcript";
import {
  ENTRANCE_LINK_WORDS,
  buildEntranceInput,
  checkEntrance,
  checkEntranceLinks,
  checkEntranceQuestion,
  checkEntranceV3,
  entranceSchema,
  entranceSchemaV3,
  pickEntranceCandidates,
  type EntranceOutput,
  type EntranceOutputV3,
  type MusubiForEntrance,
  type NarrationForEntrance,
} from "../src/server/core/entrance-claude";
import { pickFixedPhoto } from "../src/server/core/entrances";
import type { ClaudeCallResult, ClaudeContentPart, PhotoRow } from "../src/server/core/ports";
import { ENTRANCE_PROMPTS, type EntranceVersion } from "../src/server/prompts";
import { fs, path, processEnv, repoRoot } from "../test/node";
import type { FamilyFixture } from "./fixtures/types";

const env = processEnv();

/** キーは環境変数か、.dev.vars（リポジトリに入らないファイル）から読む。値は出さない */
function readKey(): string | undefined {
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  const file = env.EVAL_DEV_VARS ?? path.join(repoRoot, ".dev.vars");
  if (!fs.existsSync(file)) return undefined;
  for (const line of (fs.readFileSync(file, "utf8") as string).split(/\r?\n/)) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1]) return m[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}
const apiKey = readKey();
const repeat = Math.max(1, Number(env.EVAL_REPEAT ?? "1") || 1);
const fixtureName = env.EVAL_FIXTURE ?? "family-a";
const avoid = env.EVAL_AVOID !== "0";
const useImages = env.EVAL_IMAGES !== "0";
const imagesDir = env.EVAL_IMAGES_DIR ?? path.join(env.HOME ?? "", "omoide-demo-seed/prepared");
const version: EntranceVersion = env.EVAL_PROMPT === "v3" ? "v3" : "v2";
const v3 = version === "v3";
/** v3 で、むすびを使うか（EVAL_MUSUBI=0 で外す） */
const useMusubi = v3 && env.EVAL_MUSUBI !== "0";

/** fixtures を読む。base があれば元の家族を読み、上書きする */
function loadFixture(name: string): FamilyFixture {
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, `evals/fixtures/${name}.json`), "utf8")) as FamilyFixture;
  if (!raw.base) return raw;
  const { base, ...over } = raw;
  return { ...loadFixture(base), ...over };
}

function jstDate(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
const jstMs = (date: string, at = "12:00") => Date.parse(`${date}T${at}:00+09:00`);

const quoteBlock = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

type ImagePart = Extract<ClaudeContentPart, { type: "image" }>;

export type Outcome = {
  memberId: string;
  run: number;
  /** 同じ朝に、先の人の入り口に出した写真（外したもの。EVAL_AVOID=0 でも記録だけする） */
  usedBefore: string[];
  candidates: string[];
  model: string;
  ok: boolean;
  reason: string | null;
  violation: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  rawAttempts: { value: EntranceOutput & Partial<Pick<EntranceOutputV3, "receiver_present">>; violation: string | null }[];
  /** 最後の応答の、つながりの検査の結果（v2 でも同じ物差しで数える。v2 では止めていない） */
  linkCheck: string | null;
  value: (EntranceOutput & Partial<Pick<EntranceOutputV3, "receiver_present">>) | null;
  /** 渡した <same_event> の行の数と、むすびの ID */
  sameEventLines: number;
  inputMusubiIds: string[];
  /** 固定の入り口に倒れたときの写真（本番の pickFixedPhoto と同じ選び方） */
  fixedPhotoId: string | null;
  /** アプリが位置を決めて引いた引用（画面に出るもの） */
  shownQuote: string | null;
};

describe.skipIf(!apiKey)("出し比べ: entrance", () => {
  it(`架空の家族（${fixtureName}）の一回の朝を、本物の Sonnet で一人ずつ順に作る`, async () => {
    const fixture = loadFixture(fixtureName);
    const claude = createAnthropicClaude(apiKey!, { log: () => {} });

    // fixtures を、アプリの行の形にする（位置はない。createdAt は登録の順）
    const photos: PhotoRow[] = fixture.photos.map((p, i) => ({
      id: p.id,
      familyId: fixture.id,
      ownerMemberId: p.ownerMemberId,
      storageKey: "",
      contentHash: "",
      width: 1,
      height: 1,
      takenAt: p.takenAt,
      latitude: null,
      longitude: null,
      createdAt: i,
    }));
    const images = new Map<string, ImagePart>();
    if (useImages) {
      for (const p of fixture.photos) {
        if (!p.imageFile) continue;
        const file = path.join(imagesDir, p.imageFile);
        if (!fs.existsSync(file)) continue;
        const bytes = new Uint8Array(fs.readFileSync(file));
        images.set(p.id, { type: "image", mediaType: "image/jpeg", base64: bytesToBase64(bytes) });
      }
    }
    // 声の語りは、整形済み（cleanedText、なければ文字起こしそのまま）とみなし、fixtures の聞き間違い（期待値）に印を付ける。
    // 印の範囲は「……」として渡るので、Claude が避けるか、検査（quote_uncertain_overlap）が止めるかを見る
    const spansOf = (n: FamilyFixture["narrations"][number]) =>
      n.mishearings
        .map((m) => ({ start: n.transcript.indexOf(m.heard), end: n.transcript.indexOf(m.heard) + m.heard.length }))
        .filter((sp) => sp.start >= 0)
        .sort((a, b) => a.start - b.start);
    const narrations: NarrationForEntrance[] = fixture.narrations.map((n, i) => ({
      id: n.id,
      speakerMemberId: n.speakerMemberId,
      photoId: n.photoId,
      replyToId: n.replyToId,
      kind: n.kind,
      transcript: n.transcript,
      cleanedText: n.kind === "voice" ? (n.cleanedText ?? n.transcript) : null,
      uncertainSpans: n.kind === "voice" ? spansOf(n) : null,
      forDate: n.forDate,
      createdAt: jstMs(n.forDate, n.at) + i,
    }));
    // 0042 の前の並び（g0 なし）を作るための写し。候補の絞り込みにだけ使う
    const narrationsBefore = narrations.map((n) => ({ ...n, replyToId: null }));
    const pastOf = (memberId: string) =>
      (fixture.pastEntrances ?? [])
        .filter((e) => e.memberId === memberId)
        .map((e) => ({ photoId: e.photoId, forDate: e.forDate, createdAt: jstMs(e.forDate, e.at) }));
    const outcomes: Outcome[] = [];
    // records の値は表示の文字の連続した部分（言い換えない）であることを確かめる
    const records = (fixture.records ?? []).map((r) => {
      const n = fixture.narrations.find((x) => x.id === r.narrationId);
      if (!n || n.photoId !== r.photoId || !(n.cleanedText ?? n.transcript).includes(r.value)) throw new Error(`fixture record mismatch: ${r.narrationId}`);
      return { photoId: r.photoId, value: r.value, origin: "told" as const };
    });
    const musubi: MusubiForEntrance[] = useMusubi
      ? (fixture.musubi ?? []).map((m) => ({
          id: m.id,
          photos: m.photos.map((p) => ({ photoId: p.photoId, status: p.status, decidedByMemberId: null, decidedAt: null })),
        }))
      : [];
    const familyPhotoIds = new Set(photos.map((p) => p.id));

    for (let run = 1; run <= repeat; run++) {
      // 同じ朝に、先に作った人の入り口の写真（本番は listByDate で読む）
      const usedToday: string[] = [];
      for (const member of fixture.members) {
        const past = pastOf(member.id);
        const picked = avoid
          ? pickEntranceCandidates(photos, narrations, past, member.id, fixture.asOfDate, new Set(usedToday), musubi)
          : pickEntranceCandidates(photos, narrationsBefore, past, member.id, fixture.asOfDate, new Set(), musubi);
        const input = buildEntranceInput({
          receiverId: member.id,
          members: fixture.members,
          candidates: picked.map((c) => ({
            photo: c.photo,
            image: images.get(c.photo.id) ?? null,
            guess: fixture.photos.find((p) => p.id === c.photo.id)?.description ?? null,
            shownCount: c.shownCount,
            lastShownDate: c.lastShownDate,
          })),
          narrations,
          ...(useMusubi ? { sameEvent: { musubi, familyPhotoIds } } : {}),
        });
        const rawAttempts: Outcome["rawAttempts"] = [];
        const prompt = ENTRANCE_PROMPTS[version];
        const traceId = `eval-${member.id}`;
        const r: ClaudeCallResult<EntranceOutput | EntranceOutputV3> = v3
          ? await claude.call({
              prompt,
              content: input.content,
              schema: entranceSchemaV3,
              check: (v) => {
                const violation = checkEntranceV3(v, input.context, records);
                rawAttempts.push({ value: v, violation });
                return violation;
              },
              traceId,
            })
          : await claude.call({
              prompt,
              content: input.content,
              schema: entranceSchema,
              check: (v) => {
                const violation = checkEntrance(v, input.context);
                rawAttempts.push({ value: v, violation });
                return violation;
              },
              traceId,
            });
        const last = rawAttempts.at(-1);
        const sameEventLines = input.content.reduce((n, p) => n + (p.type === "text" ? (p.text.match(/<same_event /g) ?? []).length : 0), 0);
        let shownQuote: string | null = null;
        if (r.ok && r.value.quote) {
          const n = input.context.narrations.get(r.value.quote.narration_id)!.narration;
          const at = locateQuote(n, r.value.quote.text);
          if (at.ok) shownQuote = quoteText(n, at.start, at.end);
        }
        const fixedPhotoId = r.ok ? null : (pickFixedPhoto(photos, past, member.id)?.id ?? null);
        outcomes.push({
          memberId: member.id,
          run,
          usedBefore: [...usedToday],
          candidates: picked.map((c) => c.photo.id),
          model: r.meta.model,
          ok: r.ok,
          reason: r.ok ? null : r.reason,
          violation: r.ok ? null : (r.violation ?? null),
          attempts: r.meta.attempts,
          inputTokens: r.meta.inputTokens,
          outputTokens: r.meta.outputTokens,
          rawAttempts,
          value: r.ok ? r.value : null,
          fixedPhotoId,
          shownQuote,
          sameEventLines,
          inputMusubiIds: input.inputMusubiIds,
          linkCheck: last ? checkEntranceLinks(last.value.question, last.value.photo_id, input.context, records) : null,
        });
        const chosen = r.ok ? r.value.photo_id : fixedPhotoId;
        if (chosen) usedToday.push(chosen);
      }
    }

    const defaultName = v3 ? `${jstDate()}-entrance-v3-${fixture.id}${useMusubi ? "" : "-nomusubi"}.md` : `${jstDate()}-entrance-${fixture.id}-avoid${avoid ? 1 : 0}.md`;
    const out = env.EVAL_OUT ?? path.join(repoRoot, `docs/evals/${defaultName}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, report(fixture, outcomes, images.size));
    fs.writeFileSync(
      out.replace(/\.md$/, ".json"),
      JSON.stringify({ fixture: fixture.id, prompt: ENTRANCE_PROMPTS[version].version, useMusubi, avoid, images: images.size, repeat, metrics: metrics(fixture, outcomes), outcomes }, null, 2),
    );
    console.log(`wrote ${path.relative(repoRoot, out)}`);
    expect(outcomes.length).toBe(fixture.members.length * repeat);
  });
});

/** 合否の基準（0046）の数を出す。方針違反の読み取り（呼びかけ・相づち・試す形の言い換え）は人が読む */
function metrics(fixture: FamilyFixture, outcomes: Outcome[]) {
  const ok = outcomes.filter((o) => o.ok && o.value);
  const violations: Record<string, number> = {};
  for (const o of outcomes) for (const a of o.rawAttempts) if (a.violation) violations[a.violation] = (violations[a.violation] ?? 0) + 1;
  const speakerOf = new Map(fixture.narrations.map((n) => [n.id, n.speakerMemberId]));
  const quoted = ok.filter((o) => o.value!.quote);
  const presence = ok.flatMap((o) => {
    const e = (fixture.expectedPresence ?? []).find((x) => x.photoId === o.value!.photo_id && x.memberId === o.memberId);
    return e ? [{ memberId: o.memberId, run: o.run, photoId: o.value!.photo_id, expected: e.present, got: o.value!.receiver_present ?? null, question: o.value!.question }] : [];
  });
  const c = fixture.continuation;
  return {
    total: outcomes.length,
    ok: ok.length,
    fixed: outcomes.length - ok.length,
    retried: outcomes.filter((o) => o.rawAttempts.some((a) => a.violation)).length,
    violations,
    /** 最後の応答が、つながりの検査（question_asserts_link / question_other_photo_words）に当たる数 */
    linkCheckHits: outcomes.filter((o) => o.linkCheck).map((o) => ({ memberId: o.memberId, run: o.run, kind: o.linkCheck })),
    linkWordsInFinal: ok.filter((o) => ENTRANCE_LINK_WORDS.some((w) => o.value!.question.includes(w))).length,
    quoteReuseMax: Math.max(0, ...ok.map((o) => (o.shownQuote ? longestCommon(o.value!.question, o.shownQuote) : 0))),
    quoteNull: ok.filter((o) => !o.value!.quote).length,
    quoteByOthers: `${quoted.filter((o) => speakerOf.get(o.value!.quote!.narration_id) !== o.memberId).length}/${quoted.length}`,
    focusViolations: Object.entries(violations).filter(([k]) => k.startsWith("focus")).reduce((n, [, x]) => n + x, 0),
    hokaniType: `${ok.filter((o) => o.value!.question.includes("ほかに")).length}/${ok.length}`,
    deshitaka: `${ok.filter((o) => /でしたか$/.test(o.value!.question)).length}/${ok.length}`,
    presenceMatched: `${presence.filter((p) => p.got === p.expected).length}/${presence.length}`,
    presence,
    receiverPresentCounts: ok.reduce<Record<string, number>>((m, o) => {
      const k = o.value!.receiver_present ?? "-";
      m[k] = (m[k] ?? 0) + 1;
      return m;
    }, {}),
    continuation: c
      ? `${outcomes.filter((o) => o.memberId === c.memberId && o.value?.photo_id === c.photoId).length}/${outcomes.filter((o) => o.memberId === c.memberId).length}`
      : null,
    sameEventLines: outcomes.reduce((n, o) => n + o.sameEventLines, 0),
    inputTokens: outcomes.reduce((n, o) => n + o.inputTokens, 0),
    outputTokens: outcomes.reduce((n, o) => n + o.outputTokens, 0),
  };
}

/** a と b に共通する、いちばん長い連続した文字列の長さ */
function longestCommon(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

function report(fixture: FamilyFixture, outcomes: Outcome[], imageCount: number): string {
  const prompt = ENTRANCE_PROMPTS[version];
  const called = new Map(fixture.members.map((m) => [m.id, m.calledAs]));
  const mt = metrics(fixture, outcomes);
  const speakerOf = new Map(fixture.narrations.map((n) => [n.id, n.speakerMemberId]));
  const lines: string[] = [];
  lines.push(
    `# 出し比べ: 入り口づくり（${prompt.version}${v3 && !useMusubi ? "、むすびなし" : ""}）${fixture.id}、${avoid ? "0042 の後（g0 と、同じ日の写真を外す）" : "0042 の前（g0 なし、外さない）"}`,
    "",
  );
  lines.push(`- 日付: ${jstDate()}`);
  lines.push(`- モデル: ${CLAUDE_PURPOSES.entrance.model}（応答に書かれたもの: ${[...new Set(outcomes.map((o) => o.model))].join("、")}）`);
  lines.push(
    `- データ: evals/fixtures/${fixture.id}.json の ${fixture.members.length} 人 × ${repeat} 回の朝。人の順（毎朝の処理の順）: ${fixture.members.map((m) => m.calledAs).join(" → ")}。今日 = ${fixture.asOfDate}`,
  );
  lines.push(`- 過去の入り口: ${(fixture.pastEntrances ?? []).map((e) => `${called.get(e.memberId)} ${e.photoId}（${e.forDate}）`).join("、") || "なし"}`);
  lines.push(`- 画像: ${imageCount > 0 ? `${imageCount} 枚を渡した（focus も検査）` : "なし（写真の説明だけ。focus は null だけを許す）"}`);
  lines.push("- 「引用の再利用」: 問いかけと画面に出る引用に共通する、いちばん長い連続した文字列の字数");
  lines.push(`- むすび: ${(fixture.musubi ?? []).map((m) => `${m.id} {${m.photos.map((p) => `${p.photoId}:${p.status}`).join(", ")}}`).join("、") || "なし"}（${useMusubi ? "使う" : "使わない"}）`, "");

  const tokensIn = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const tokensOut = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  lines.push("## まとめ", "");
  lines.push(`- 作れた: ${outcomes.filter((o) => o.ok).length} / ${outcomes.length}（固定の入り口に倒れたもの: ${outcomes.filter((o) => !o.ok).length}）`);
  lines.push(`- 検査で再試行になったもの: ${outcomes.filter((o) => o.rawAttempts.some((a) => a.violation)).length}`);
  lines.push(`- トークン: 入力 ${tokensIn}、出力 ${tokensOut}`);
  lines.push(`- 検査の違反（全試行）: ${Object.entries(mt.violations).map(([k, n]) => `${k} ${n}`).join("、") || "なし"}`);
  lines.push(`- つながりの検査に当たる最後の応答: ${mt.linkCheckHits.length}${mt.linkCheckHits.length ? `（${mt.linkCheckHits.map((h) => `${called.get(h.memberId)} ${h.run} 回目 ${h.kind}`).join("、")}）` : ""}`);
  lines.push(`- 引用の再利用の最大: ${mt.quoteReuseMax} 字。quote null: ${mt.quoteNull}。受け取る人以外の語りの引用: ${mt.quoteByOthers}。focus の違反: ${mt.focusViolations}`);
  lines.push(`- 「ほかに」: ${mt.hokaniType}。「でしたか」で終わる: ${mt.deshitaka}`);
  lines.push(`- receiver_present: ${Object.entries(mt.receiverPresentCounts).map(([k, n]) => `${k} ${n}`).join("、")}。期待値との合致: ${mt.presenceMatched}`);
  for (const p of mt.presence.filter((x) => x.got !== x.expected || x.expected === "no")) {
    lines.push(`  - ${called.get(p.memberId)} ${p.run} 回目 ${p.photoId}: 期待 ${p.expected} / 出力 ${p.got ?? "-"}「${p.question}」`);
  }
  if (mt.continuation) lines.push(`- 続きの向き（${called.get(fixture.continuation!.memberId)} に ${fixture.continuation!.photoId}）: ${mt.continuation}`);
  lines.push(`- 渡した <same_event> の行: ${mt.sameEventLines}`, "");
  for (let run = 1; run <= repeat; run++) {
    const os = outcomes.filter((o) => o.run === run);
    const photosOf = os.map((o) => o.value?.photo_id ?? o.fixedPhotoId).filter((x): x is string => !!x);
    const quotes = os.map((o) => o.value?.quote?.narration_id).filter((x): x is string => !!x);
    lines.push(`- ${run} 回目の朝: 異なる写真 ${new Set(photosOf).size} / ${os.length} 人、異なる引用 ${new Set(quotes).size}（引用あり ${quotes.length}）`);
  }
  lines.push("");
  lines.push("| 受け取る人 | 回 | 結果 | 試行 | 先の人の写真 | 写真 | 引用（語り手） | その場 | 問いかけ | 字数 | 引用の再利用 |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const o of outcomes) {
    const v = o.value;
    const result = o.ok ? "ok" : `fixed（${o.reason}${o.violation ? ` / ${o.violation}` : ""}）`;
    const q = v?.quote ? `${called.get(speakerOf.get(v.quote.narration_id) ?? "") ?? "?"}: ${v.quote.narration_id}` : "-";
    lines.push(
      `| ${called.get(o.memberId)} | ${o.run} | ${result} | ${o.attempts} | ${o.usedBefore.join("、") || "-"} | ${v?.photo_id ?? `${o.fixedPhotoId ?? "-"}（固定）`} | ${q} | ${v?.receiver_present ?? "-"} | ${v?.question ?? "-"} | ${v ? charCount(v.question) : "-"} | ${v && o.shownQuote ? longestCommon(v.question, o.shownQuote) : "-"} |`,
    );
  }
  lines.push("");

  lines.push("## 一人ずつ", "");
  for (const o of outcomes) {
    const m = fixture.members.find((x) => x.id === o.memberId)!;
    lines.push(`### ${m.calledAs}（${m.relation}、${m.role}。${o.run} 回目）`, "");
    lines.push(`候補（並べた順）: ${o.candidates.join("、")}${o.inputMusubiIds.length ? `。<same_event> のむすび: ${o.inputMusubiIds.join("、")}` : ""}`, "");
    o.rawAttempts.forEach((a, i) => {
      if (a.violation || i < o.rawAttempts.length - 1 || !o.ok) {
        lines.push(`${i + 1} 回目の応答${a.violation ? `（検査に外れた: ${a.violation}）` : ""}:`, "", "```json", JSON.stringify(a.value, null, 2), "```", "");
      }
    });
    const v = o.value;
    if (!v) {
      lines.push(`結果: 固定の入り口（${o.reason}${o.violation ? ` / ${o.violation}` : ""}）。写真: ${o.fixedPhotoId ?? "なし"}`, "");
      continue;
    }
    lines.push(`- 写真: ${v.photo_id}（説明: ${fixture.photos.find((p) => p.id === v.photo_id)?.description ?? "?"}）`);
    lines.push(`- focus: ${v.focus ? JSON.stringify(v.focus) : "null"}`);
    lines.push(`- 引用: ${v.quote ? `${v.quote.narration_id}（${called.get(speakerOf.get(v.quote.narration_id) ?? "") ?? "?"}）` : "なし"}`);
    if (o.shownQuote) lines.push("", quoteBlock(o.shownQuote), "");
    if (v.receiver_present) lines.push(`- receiver_present: ${v.receiver_present}`);
    lines.push(`- 問いかけ: ${v.question}`);
    lines.push(`- 問いかけの検査（保存の形）: ${checkEntranceQuestion(v.question) ?? "ok"}${o.shownQuote?.includes(UNCERTAIN_PLACEHOLDER) ? "。引用に「……」あり" : ""}`);
    lines.push(`- reason: ${v.reason}`, "");
  }
  return lines.join("\n");
}
