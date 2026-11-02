import { drizzle } from "drizzle-orm/d1";
import type { Repositories } from "../../core/ports";
import * as schema from "../../db/schema";

/** D1 でのリポジトリ。テーブルが決まったら、ここに実装を足す。 */
export function createD1Repositories(d1: D1Database): Repositories {
  const db = drizzle(d1, { schema });
  void db;
  return {};
}
