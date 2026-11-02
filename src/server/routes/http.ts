import type { Context } from "hono";
import type { z } from "zod";
import type { ErrorKind } from "../../shared/api";

const statusOf = {
  unauthorized: 401,
  not_found: 404,
  invalid_request: 400,
  duplicate: 409,
  not_demo: 404,
  too_large: 413,
  internal: 500,
} as const satisfies Record<ErrorKind, number>;

/** エラーは種類だけを返す。受け取った値や日本語の文は返さない。 */
export function fail(c: Context, kind: ErrorKind): Response {
  return c.json({ error: kind }, statusOf[kind]);
}

/** 検証に失敗したら null。中身は返さない。 */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> | null {
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function parseJsonString(s: unknown): unknown {
  if (typeof s !== "string") return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * multipart を読む前に、大きさを Content-Length で確かめる。
 * Content-Length がないものは受けない（中身を読む前に大きさが分からないため）。
 */
export function checkContentLength(c: Context, max: number): "ok" | "too_large" | "missing" {
  const raw = c.req.header("content-length");
  if (!raw || !/^\d+$/.test(raw)) return "missing";
  return Number(raw) > max ? "too_large" : "ok";
}

export async function readForm(c: Context): Promise<FormData | null> {
  try {
    return await c.req.raw.formData();
  } catch {
    return null;
  }
}
