// アプリが外の世界に頼るもののインターフェース。
// ハンドラと core はこれだけを見る。D1・R2（Workers）でも、better-sqlite3・ローカルのファイル（VPS）でも実装できる形にする。
// 理由は docs/decisions/0002-cloudflare-workers.md

/** 写真と録音の保存先。非公開で持つ。返すのは、合言葉を確かめた後だけ。 */
export interface PhotoStore {
  /** 大きなファイルをメモリに載せないよう、ReadableStream のまま流せる形にする。 */
  put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array, meta: StoredObjectMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export interface StoredObjectMeta {
  contentType: string;
}

export interface StoredObject extends StoredObjectMeta {
  body: ReadableStream;
  size: number;
}

/**
 * データベースのリポジトリの集まり。
 * テーブルはまだない（データの形は fable-advisor と相談して決める）。リポジトリが決まったら、ここに足す。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Repositories {}

/** レスポンスを返した後に続ける処理。Workers では waitUntil、VPS ではそのまま待たずに走らせる。 */
export type RunInBackground = (task: Promise<unknown>) => void;

/** アプリが使う依存のすべて。入り口の層（platform/）が作って渡す。 */
export interface AppDeps {
  repos: Repositories;
  photos: PhotoStore;
  runInBackground: RunInBackground;
}
