import type { PhotoStore } from "../../core/ports";

/** R2 での写真と録音の保存。バケットは非公開。返すのは Worker が合言葉を確かめた後だけ。 */
export function createR2PhotoStore(bucket: R2Bucket): PhotoStore {
  return {
    async put(key, body, meta) {
      await bucket.put(key, body, { httpMetadata: { contentType: meta.contentType } });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return {
        body: obj.body,
        size: obj.size,
        contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
