// 家族の一人ひとり: 足す、直す、その人のリンクを作る（0036）。
// 家族のことを触れるのは role = family の人だけ。祖父母の画面の人と、最初の人のリンクの端末（最初の一人を入れるときを除く）は 403。
import { Hono, type Context } from "hono";
import { memberInputSchema, type MemberInput, type MemberLinkResult } from "../../shared/api";
import type { MemberRow } from "../core/ports";
import { hashToken, newInviteToken } from "../core/secrets";
import { canManageFamily, setInviteCookie } from "./auth";
import { demoGuideOpen } from "./demo";
import type { AppEnv } from "./env";
import { fail, parseWith, readJson } from "./http";
import { memberView } from "./views";

/** 代わりに設定を入れた人は、同じ家族の人でなければならない */
async function setUpByIsValid(c: Context<AppEnv>, input: MemberInput): Promise<boolean> {
  if (input.setUpByMemberId === null) return true;
  return (await c.get("deps").repos.members.get(c.get("family").id, input.setUpByMemberId)) !== null;
}

/**
 * 自分の role（どちらの画面か）を変えようとしているか。自分を祖父母の画面に変えると、その端末から家族のことを触れなくなり、
 * 戻す人がいなくなることがあるので、自分では変えない（ほかの人が変える）。0036
 */
export function changesOwnRole(me: MemberRow, targetId: string, input: MemberInput): boolean {
  return me.id === targetId && me.role !== input.role;
}

async function newLink() {
  const token = newInviteToken();
  return { token, link: { id: crypto.randomUUID(), tokenHash: await hashToken(token) } };
}

async function hasActiveLink(c: Context<AppEnv>, memberId: string): Promise<boolean> {
  return (await c.get("deps").repos.members.listIdsWithActiveLink(c.get("family").id)).includes(memberId);
}

/** 審査員の案内が開いている間、デモの家族の人とリンクは変えられない（0062） */
function lockedByDemoGuide(c: Context<AppEnv>): boolean {
  return c.get("family").isDemo && demoGuideOpen(c.get("deps").config);
}

export const members = new Hono<AppEnv>()
  .post("/members", async (c) => {
    const me = c.get("member");
    if (me !== null && !canManageFamily(me)) return fail(c, "forbidden");
    const input = parseWith(memberInputSchema, await readJson(c));
    if (!input) return fail(c, "invalid_request");
    const deps = c.get("deps");
    const family = c.get("family");
    const row = { id: crypto.randomUUID(), familyId: family.id, createdAt: deps.now().getTime(), ...input };

    if (me === null) {
      // 最初の人のリンクの端末: 家族に人がまだいないときだけ、自分を入れる。最初の人は家族の画面の人
      if (input.role !== "family" || input.setUpByMemberId !== null) return fail(c, "invalid_request");
      if ((await deps.repos.members.list(family.id)).length > 0) return fail(c, "forbidden");
      const { token, link } = await newLink();
      if (!(await deps.repos.members.addFirst(row, link, row.createdAt))) return fail(c, "forbidden");
      // この端末は、いまからこの人。新しい合言葉は cookie にだけ置く（本文には返さない）
      setInviteCookie(c, token);
      return c.json(memberView(row, true), 201);
    }

    if (lockedByDemoGuide(c)) return fail(c, "forbidden");
    if (!(await setUpByIsValid(c, input))) return fail(c, "not_found");
    await deps.repos.members.create(row);
    return c.json(memberView(row, false), 201);
  })

  .patch("/members/:id", async (c) => {
    const me = c.get("member");
    if (!canManageFamily(me) || lockedByDemoGuide(c)) return fail(c, "forbidden");
    const input = parseWith(memberInputSchema, await readJson(c));
    if (!input) return fail(c, "invalid_request");
    const id = c.req.param("id");
    if (changesOwnRole(me, id, input)) return fail(c, "forbidden");
    if (input.setUpByMemberId === id) return fail(c, "invalid_request");
    if (!(await setUpByIsValid(c, input))) return fail(c, "not_found");
    const updated = await c.get("deps").repos.members.update(c.get("family").id, id, input);
    // 直した後に家族の画面の人が一人もいなくなる変更も 403（誰もリンクを作れなくなる）。changesOwnRole と並ぶ検査で、確かめはリポジトリが直すのと一つの文で行う
    if (updated === "no_family_left") return fail(c, "forbidden");
    if (!updated) return fail(c, "not_found");
    return c.json(memberView(updated, await hasActiveLink(c, updated.id)));
  })

  // その人のリンクを作る（作り直す）。その人の前のリンクだけが使えなくなる
  .post("/members/:id/link", async (c) => {
    const me = c.get("member");
    if (!canManageFamily(me) || lockedByDemoGuide(c)) return fail(c, "forbidden");
    const deps = c.get("deps");
    const familyId = c.get("family").id;
    const target = await deps.repos.members.get(familyId, c.req.param("id"));
    if (!target) return fail(c, "not_found");
    const { token, link } = await newLink();
    await deps.repos.members.replaceLink(familyId, target.id, link, deps.now().getTime());
    // 自分のリンクを作り直したら、この端末の cookie も替える（前のものは使えなくなっている）
    if (target.id === me.id) setInviteCookie(c, token);
    return c.json({ token } satisfies MemberLinkResult);
  });
