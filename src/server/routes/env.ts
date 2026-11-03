import type { AppConfig, AppDeps, FamilyRow, MemberRow } from "../core/ports";

/**
 * Hono の変数。family と member は合言葉の確認（auth.ts）を通った後にだけある。
 * member はリンクが指す人。null は「最初の人のリンク」で、通れるのは auth.ts の FIRST_PERSON_ROUTES だけ（0036）
 */
export type AppEnv = { Variables: { deps: AppDeps; family: FamilyRow; member: MemberRow | null } };

/**
 * 開発用の入り口（/api/check/*）を開くか。本番（APP_ENV=production）では閉じて 404 にする（0014）。
 * 運営の記録（/api/ops/*）は環境では分けず、鍵と家族の種類で守る（0030）
 * APP_ENV がないとき、入り口の層が production として渡す（閉じる側に倒す）
 */
export const devToolsOpen = (config: AppConfig): boolean => config.appEnv !== "production";
