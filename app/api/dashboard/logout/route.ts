import { DASHBOARD_COOKIE_NAME } from "@/lib/domain/dashboard-session";

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", `${DASHBOARD_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
