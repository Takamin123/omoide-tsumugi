import { Hono } from "hono";
import type { AdvanceClockResult, Entrance } from "../../shared/api";
import { canAdvanceClock, familyClock, familyToday, nextClock } from "../core/clock";
import { ensureFixedEntrance } from "../core/entrances";
import { runMorning } from "../core/morning";
import type { AppEnv } from "./env";
import { fail } from "./http";
import { privateBody } from "./photos";
import { entranceView } from "./views";

export const entrances = new Hono<AppEnv>()
  // 今日の入り口。なければその場で固定の入り口を作って保存する（Claude は呼ばない）
  .get("/entrances/today", async (c) => {
    const memberId = c.req.query("memberId");
    if (!memberId) return fail(c, "invalid_request");
    const deps = c.get("deps");
    const family = c.get("family");
    const member = await deps.repos.members.get(family.id, memberId);
    if (!member) return fail(c, "not_found");
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

  // デモの時計: 朝 → 昼 → 夜 → 翌朝。翌朝になったら毎朝の処理（Cron と同じ関数）を、その家族について呼ぶ
  .post("/demo/clock/advance", async (c) => {
    const deps = c.get("deps");
    const family = c.get("family");
    if (!canAdvanceClock(deps.config, family)) return fail(c, "not_demo");
    const now = deps.now();
    const clock = nextClock(familyClock(family, now));
    await deps.repos.families.setClock(family.id, clock);
    if (clock.slot === "morning") {
      try {
        await runMorning(deps, now, { familyId: family.id });
      } catch {
        // 入り口が作れなくても時計は進める。開いたときに固定の入り口が作られる
      }
    }
    return c.json({ clock } satisfies AdvanceClockResult);
  });
