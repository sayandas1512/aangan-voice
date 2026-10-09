import { z } from "zod";
import { verifyPassword, createSessionToken, DASHBOARD_COOKIE_NAME } from "@/lib/domain/dashboard-session";
import { countEventsOfTypeSince, logEvent } from "@/lib/db/queries";

const BodySchema = z.object({ password: z.string().min(1) });

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const recentFailures = await countEventsOfTypeSince(`dashboard_login_failed:${ip}`, since);
  if (recentFailures >= MAX_ATTEMPTS) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  if (!verifyPassword(parsed.data.password)) {
    await logEvent(`dashboard_login_failed:${ip}`, { at: new Date().toISOString() });
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = createSessionToken();
  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${DASHBOARD_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`
  );
  return response;
}
