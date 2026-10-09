import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Minimal signed-cookie session for the founder dashboard (brief section
 * 10: "simple password gate, cookie session, rate limited"). Reuses the
 * same HMAC-token pattern as lib/domain/action-link.ts rather than pulling
 * in an auth library for one password-gated page.
 */

export const DASHBOARD_COOKIE_NAME = "aangan_dashboard_session";
const SESSION_TTL_HOURS = 12;

interface SessionPayload {
  exp: number; // unix seconds
}

export function createSessionToken(): string {
  const payload: SessionPayload = { exp: Math.floor(Date.now() / 1000) + SESSION_TTL_HOURS * 3600 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", env.ACTION_LINK_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, signature] = parts;

  const expected = createHmac("sha256", env.ACTION_LINK_SECRET).update(body).digest("base64url");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return false;
  }

  try {
    const payload: SessionPayload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function verifyPassword(candidate: string): boolean {
  const expectedBuf = Buffer.from(env.DASHBOARD_PASSWORD, "utf8");
  const actualBuf = Buffer.from(candidate, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
