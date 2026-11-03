import { words } from "../words";
import { ApiError } from "./api";

/** 例外を、家族に見せる文にする。外のライブラリのエラー文は出さない */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return words.errors[e.kind];
  return words.errors.internal;
}

/**
 * /join/<token> で入れなかったときの文。使えないリンク（作り直した、一度きりのリンクを使った後、形が違う）は
 * 家族に知らせてもらう。つながらないなどは、ほかと同じ文（0036）
 */
export function joinErrorText(e: unknown): string {
  if (e instanceof ApiError && (e.kind === "unauthorized" || e.kind === "invalid_request")) return words.join.invalid;
  return errorText(e);
}
