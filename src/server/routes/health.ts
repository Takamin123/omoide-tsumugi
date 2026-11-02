import { Hono } from "hono";
import type { AppEnv } from "../app";

// 秘密の値を使わない、通ったことだけを返すヘルスチェック。
// Claude や文字起こしまで確かめるもの（/api/health/deep）は、秘密の値で守って別に作る。
export const health = new Hono<AppEnv>().get("/", (c) => c.json({ ok: true }));
