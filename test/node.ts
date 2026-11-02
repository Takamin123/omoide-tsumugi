// テストの中だけで使う Node の API。
// test/ は、entry.ts を試すために Workers の型（tsconfig.worker.json、types: []）で検査する。
// Node の型（@types/node）を同じ所に入れると、Workers の型と ProcessEnv や URL がぶつかる（試して確かめた）。
// そこで動的 import にして、Node の API を any として読み込む。
/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (name: string): Promise<any> => import(name);

export const fs: any = await load("node:fs");
export const path: any = await load("node:path");
export const os: any = await load("node:os");
export const childProcess: any = await load("node:child_process");
export const url: any = await load("node:url");

/** リポジトリの根（test/ の一つ上）。 */
export const repoRoot: string = path.resolve(url.fileURLToPath(new URL(".", (import.meta as unknown as { url: string }).url)), "..");

/** 子プロセスに渡す環境変数（今の環境の写し）。 */
export const processEnv = (): Record<string, string | undefined> => ({ ...(globalThis as any).process.env });
