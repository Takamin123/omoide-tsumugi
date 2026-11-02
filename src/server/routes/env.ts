import type { AppDeps, FamilyRow } from "../core/ports";

/** Hono の変数。family は合言葉の確認（auth.ts）を通った後にだけある。 */
export type AppEnv = { Variables: { deps: AppDeps; family: FamilyRow } };
