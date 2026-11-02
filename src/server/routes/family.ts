// 家族の場: 作る、合言葉で入る、合言葉を作り直す、家族の様子を見る。
import { Hono } from "hono";
import {
  createFamilyInputSchema,
  sessionInputSchema,
  type CreateFamilyResult,
  type FamilyView,
  type RegenerateInviteResult,
} from "../../shared/api";
import { canAdvanceClock, familyClock, jstDate } from "../core/clock";
import { hashToken, newInviteToken, timingSafeEqual } from "../core/secrets";
import { setInviteCookie } from "./auth";
import type { AppEnv } from "./env";
import { fail, parseWith, readJson } from "./http";
import { memberView } from "./views";

export const family = new Hono<AppEnv>()
  // 家族を作る。CREATE_FAMILY_TOKEN（Bearer）で守る。設定がなければ誰も作れない
  .post("/families", async (c) => {
    const deps = c.get("deps");
    const expected = deps.config.createFamilyToken;
    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!expected || !given || !(await timingSafeEqual(given, expected))) return fail(c, "unauthorized");

    const input = parseWith(createFamilyInputSchema, (await readJson(c)) ?? {});
    if (!input) return fail(c, "invalid_request");

    const now = deps.now();
    const token = newInviteToken();
    const familyId = crypto.randomUUID();
    await deps.repos.families.create(
      // デモの家族は、作ったときから時計を持つ（その日の朝から）
      { id: familyId, name: null, isDemo: input.isDemo, clock: input.isDemo ? { date: jstDate(now), slot: "morning" } : null },
      { id: crypto.randomUUID(), tokenHash: await hashToken(token) },
      now.getTime(),
    );
    setInviteCookie(c, token);
    return c.json({ familyId, token } satisfies CreateFamilyResult, 201);
  })

  // 合言葉で入る
  .post("/session", async (c) => {
    const input = parseWith(sessionInputSchema, await readJson(c));
    if (!input) return fail(c, "invalid_request");
    const found = await c.get("deps").repos.families.findByActiveInviteHash(await hashToken(input.token));
    if (!found) return fail(c, "unauthorized");
    setInviteCookie(c, input.token);
    return c.body(null, 204);
  })

  // 合言葉を作り直す。古いものはすぐ無効になる
  .post("/invite/regenerate", async (c) => {
    const deps = c.get("deps");
    const token = newInviteToken();
    await deps.repos.families.regenerateInvite(
      c.get("family").id,
      { id: crypto.randomUUID(), tokenHash: await hashToken(token) },
      deps.now().getTime(),
    );
    setInviteCookie(c, token);
    return c.json({ token } satisfies RegenerateInviteResult);
  })

  .get("/family", async (c) => {
    const deps = c.get("deps");
    const f = c.get("family");
    const members = await deps.repos.members.list(f.id);
    const view: FamilyView = {
      family: {
        id: f.id,
        isDemo: f.isDemo,
        clock: familyClock(f, deps.now()),
        canAdvanceClock: canAdvanceClock(deps.config, f),
      },
      members: members.map(memberView),
    };
    return c.json(view);
  });
