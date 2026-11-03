import { Hono } from "hono";
import type { AppEnv } from "./env";

// 秘密の値を使わない、通ったことだけを返すヘルスチェック。
// Claude や文字起こしまで確かめる入り口は作っていない。デプロイの後は、毎朝の処理のログで確かめる（.claude/skills/verify-deploy）。
export const health = new Hono<AppEnv>().get("/", (c) => c.json({ ok: true }));
