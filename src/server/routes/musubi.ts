// 家族の手のむすび（「この写真に追加する」。0048）。推測のむすびは家族向けの API に出さない（0044）
import { Hono } from "hono";
import { currentMember } from "./auth";
import type { AppEnv } from "./env";
import { fail } from "./http";

export const musubi = new Hono<AppEnv>()
  // 「はずす」: この端末の人が足した行だけ消す。写真は消さない。それ以外は 404（あるかどうかも区別しない）
  .delete("/musubi/:musubiId/photos/:photoId", async (c) => {
    const removed = await c
      .get("deps")
      .repos.musubi.unlinkByFamily(c.get("family").id, c.req.param("musubiId"), c.req.param("photoId"), currentMember(c).id);
    if (!removed) return fail(c, "not_found");
    return c.body(null, 204);
  });
