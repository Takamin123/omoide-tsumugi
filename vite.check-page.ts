// 開発用の確かめページ（/check）を、クライアントのビルドに入れるかを決める。
// 本番（APP_ENV=production）では画面も出さない（docs/decisions/0014-keep-check-tools-outside-production.md）。
// APP_ENV がないときは本番として扱う（閉じる側に倒す。サーバーの入り口と同じ考え方）。
// 手元（vite dev）では、.dev.vars で APP_ENV=development に上書きする前提なので、入れる。

export type ViteCommand = "build" | "serve";

export function includeCheckPage(input: { command: ViteCommand; appEnv: string | undefined }): boolean {
  if (input.command === "serve") return true;
  return input.appEnv !== undefined && input.appEnv !== "" && input.appEnv !== "production";
}
