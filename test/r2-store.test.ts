// 手元の R2（getPlatformProxy、メモリだけ）で、multipart で受けた File をそのまま保存できること。
// R2 は長さの分からない ReadableStream（File.stream()）を受けないため、File のまま渡している。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createR2PhotoStore } from "../src/server/platform/cloudflare/r2-photo-store";
import { path, repoRoot } from "./node";

/* eslint-disable @typescript-eslint/no-explicit-any */
let proxy: any;
beforeAll(async () => {
  const wrangler: any = await import("wrangler" as string);
  proxy = await wrangler.getPlatformProxy({ configPath: path.join(repoRoot, "wrangler.jsonc"), persist: false });
}, 60_000);
afterAll(() => proxy?.dispose());

describe("R2 の保存", () => {
  it("File をそのまま保存し、中身と contentType を返す", async () => {
    const store = createR2PhotoStore(proxy.env.BUCKET as R2Bucket);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2])], "p.jpg", { type: "image/jpeg" });
    await store.put("test/file", file, { contentType: "image/jpeg" });
    const got = await store.get("test/file");
    expect(got?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await new Response(got!.body).arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2]));
  });
});
