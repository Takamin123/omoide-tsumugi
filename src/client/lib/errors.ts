import { words } from "../words";
import { ApiError } from "./api";

/** 例外を、家族に見せる文にする。外のライブラリのエラー文は出さない */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return words.errors[e.kind];
  return words.errors.internal;
}
