import { drizzle } from "drizzle-orm/d1";
import type { Repositories } from "../../core/ports";
import { createSqlRepositories, type SqliteDb } from "../../db/repositories";
import * as schema from "../../db/schema";

/** D1 でのリポジトリ。中身は db/repositories.ts（VPS と共通）。ここは D1 の drizzle と batch をつなぐだけ。 */
export function createD1Repositories(d1: D1Database): Repositories {
  const db = drizzle(d1, { schema });
  return createSqlRepositories(db as unknown as SqliteDb, async (items) => {
    await db.batch(items);
  });
}
