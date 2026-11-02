import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { fakeDeps } from "./helpers";

describe("GET /api/health", () => {
  it("秘密の値なしで、通ったことだけを返す", async () => {
    const app = createApp(() => fakeDeps());
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("知らない API は JSON で返す（SPA の index.html を返さない）", async () => {
    const app = createApp(() => fakeDeps());
    const res = await app.request("/api/nope");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
