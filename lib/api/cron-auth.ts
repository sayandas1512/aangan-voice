import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Vercel Cron automatically sends "Authorization: Bearer <CRON_SECRET>"
 * when CRON_SECRET is set as a project env var. Unset locally on purpose
 * (see .env.example) so `curl localhost:3000/api/cron/retry` works in dev
 * without needing a secret — this route only ever retries our own queued
 * jobs, nothing destructive happens if it's hit an extra time.
 */
export function verifyCronRequest(request: Request): boolean {
  if (!env.CRON_SECRET) return true;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(auth, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
