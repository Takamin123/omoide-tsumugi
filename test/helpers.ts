import type { AppDeps, PhotoStore } from "../src/server/core/ports";

/** テスト用の、メモリに持つ PhotoStore。架空の小さなデータだけを入れる。 */
export function memoryPhotoStore(): PhotoStore & { keys(): string[] } {
  const items = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async put(key, body, meta) {
      const bytes =
        body instanceof ReadableStream
          ? new Uint8Array(await new Response(body).arrayBuffer())
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : body;
      items.set(key, { bytes, contentType: meta.contentType });
    },
    async get(key) {
      const item = items.get(key);
      if (!item) return null;
      return { body: new Response(item.bytes).body!, size: item.bytes.byteLength, contentType: item.contentType };
    },
    async delete(key) {
      items.delete(key);
    },
    keys: () => [...items.keys()],
  };
}

export function fakeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return { repos: {}, photos: memoryPhotoStore(), runInBackground: () => {}, ...overrides };
}
