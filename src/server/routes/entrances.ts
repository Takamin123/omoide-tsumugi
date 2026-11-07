import { Hono } from "hono";
import { advanceClockInputSchema, type AdvanceClockResult, type Entrance } from "../../shared/api";
import { canAdvanceClock, familyClock, familyToday, nextMorning } from "../core/clock";
import { ensureFixedEntrance } from "../core/entrances";
import { runMorning } from "../core/morning";
import { currentMember } from "./auth";
import type { AppEnv } from "./env";
import { fail, parseWith, readJson } from "./http";
import { privateBody } from "./photos";
import { entranceView } from "./views";

export const entrances = new Hono<AppEnv>()
  // この端末の人（リンクの人）の今日の入り口。なければその場で固定の入り口を作って保存する（Claude は呼ばない）
  .get("/entrances/today", async (c) => {
    const deps = c.get("deps");
    const family = c.get("family");
    const member = currentMember(c);
    const now = deps.now();
    const r = await ensureFixedEntrance(deps, family, member, familyToday(family, now), now.getTime());
    if (!r) return c.json({ entrance: null as Entrance | null });

    const e = r.entrance;
    await deps.repos.entrances.markShown(family.id, e.id, now.getTime());
    const [photo, quoteFrom] = await Promise.all([
      deps.repos.photos.get(family.id, e.photoId),
      e.quoteNarrationId ? deps.repos.narrations.get(family.id, e.quoteNarrationId) : null,
    ]);
    if (!photo) return fail(c, "internal");
    return c.json({ entrance: entranceView(e, photo, quoteFrom) as Entrance | null });
  })

  // 問いかけの読み上げの音声（毎朝の処理が作ったもの）。合言葉の確認は app の一か所で済んでいる。ほかの家族の入り口は 404
  .get("/entrances/:id/question-audio", async (c) => {
    const deps = c.get("deps");
    const e = await deps.repos.entrances.getById(c.get("family").id, c.req.param("id"));
    if (!e || !e.questionAudioKey) return fail(c, "not_found");
    const obj = await deps.photos.get(e.questionAudioKey);
    if (!obj) return fail(c, "not_found");
    return privateBody(obj.body, obj.contentType, obj.size);
  })

  // デモの時計: どの時間帯からでも一押しで翌朝へ。毎朝の処理（Cron と同じ関数）を翌朝の日付で先に走らせ、終わってから時計を動かす（0062）。
  // 先に動かすと、待ちの間に誰かが開いたときに新しい日の固定の入り口ができ、その人だけ Claude の問いかけにならない。
  // 時計を動かすのは、時計がまだ from の日付のときだけ（一つの UPDATE）。同時に押しても一日しか進まない。毎朝の処理は重なっても一人一日に入り口は一つ
  .post("/demo/clock/advance", async (c) => {
    const deps = c.get("deps");
    const family = c.get("family");
    if (!canAdvanceClock(deps.config, family)) return fail(c, "not_demo");
    const input = parseWith(advanceClockInputSchema, (await readJson(c)) ?? {});
    if (!input) return fail(c, "invalid_request");
    const now = deps.now();
    const current = familyClock(family, now);
    if (input.from !== undefined && input.from !== current.date) return c.json({ clock: current } satisfies AdvanceClockResult);
    const clock = nextMorning(current);
    try {
      await runMorning(deps, now, { familyId: family.id, forDate: clock.date });
    } catch {
      // 入り口が作れなくても時計は進める。開いたときに固定の入り口が作られる
    }
    await deps.repos.families.moveClock(family.id, family.clock?.date ?? null, clock); // 別の押しが先に進めていれば何もしない（同じ翌朝になっている）
    return c.json({ clock } satisfies AdvanceClockResult);
  });
