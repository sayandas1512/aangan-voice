import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { DASHBOARD_COOKIE_NAME, verifySessionToken } from "@/lib/domain/dashboard-session";

export async function isDashboardAuthed(): Promise<boolean> {
  if (!env.DASHBOARD_REQUIRE_PASSWORD) return true;
  const store = await cookies();
  return verifySessionToken(store.get(DASHBOARD_COOKIE_NAME)?.value);
}
