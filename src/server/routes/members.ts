import { Hono, type Context } from "hono";
import { memberInputSchema, type MemberInput } from "../../shared/api";
import type { AppEnv } from "./env";
import { fail, parseWith, readJson } from "./http";
import { memberView } from "./views";

/** 代わりに設定を入れた人は、同じ家族の人でなければならない */
async function setUpByIsValid(c: Context<AppEnv>, input: MemberInput): Promise<boolean> {
  if (input.setUpByMemberId === null) return true;
  return (await c.get("deps").repos.members.get(c.get("family").id, input.setUpByMemberId)) !== null;
}

export const members = new Hono<AppEnv>()
  .post("/members", async (c) => {
    const input = parseWith(memberInputSchema, await readJson(c));
    if (!input) return fail(c, "invalid_request");
    if (!(await setUpByIsValid(c, input))) return fail(c, "not_found");
    const deps = c.get("deps");
    const row = { id: crypto.randomUUID(), familyId: c.get("family").id, createdAt: deps.now().getTime(), ...input };
    await deps.repos.members.create(row);
    return c.json(memberView(row), 201);
  })
  .patch("/members/:id", async (c) => {
    const input = parseWith(memberInputSchema, await readJson(c));
    if (!input) return fail(c, "invalid_request");
    if (input.setUpByMemberId === c.req.param("id")) return fail(c, "invalid_request");
    if (!(await setUpByIsValid(c, input))) return fail(c, "not_found");
    const updated = await c.get("deps").repos.members.update(c.get("family").id, c.req.param("id"), input);
    if (!updated) return fail(c, "not_found");
    return c.json(memberView(updated));
  });
