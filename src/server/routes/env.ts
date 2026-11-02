import type { AppConfig, AppDeps, FamilyRow } from "../core/ports";

/** Hono の変数。family は合言葉の確認（auth.ts）を通った後にだけある。 */
export type AppEnv = { Variables: { deps: AppDeps; family: FamilyRow } };

/**
 * 開発用の入り口（/api/check/*、/api/ops/*）を開くか。本番（APP_ENV=production）では閉じて 404 にする（0014、0024）。
 * APP_ENV がないとき、入り口の層が production として渡す（閉じる側に倒す）
 */
export const devToolsOpen = (config: AppConfig): boolean => config.appEnv !== "production";
