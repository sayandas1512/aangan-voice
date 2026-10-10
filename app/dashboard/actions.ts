"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isDashboardAuthed } from "@/lib/api/dashboard-auth";
import { getCallById, updateCall } from "@/lib/db/queries";
import { recordSimpleOutcome, recordWonOutcome } from "@/lib/domain/outcome-action";

/**
 * Server actions are public POST endpoints — the page's own auth redirect
 * does NOT protect them, so each one re-checks the dashboard session itself.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIMPLE_OUTCOMES = ["held", "no_show", "not_fit"] as const;

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Only ever redirect back inside the dashboard — never to a caller-supplied absolute URL. */
function safeReturnTo(value: string, fallback: string): string {
  return value.startsWith("/dashboard") && !value.startsWith("//") ? value : fallback;
}

export async function logOutcomeAction(form: FormData): Promise<void> {
  if (!(await isDashboardAuthed())) redirect("/dashboard/login");

  const callId = text(form, "callId");
  const bookingId = text(form, "bookingId");
  const outcome = text(form, "outcome");
  if (!UUID_RE.test(callId) || !UUID_RE.test(bookingId)) redirect("/dashboard");

  const back = `/dashboard/calls/${callId}`;

  if (outcome === "won") {
    const amount = Number(text(form, "amount").replace(/[,\s₹]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) redirect(`${back}?error=amount#outcome`);
    await recordWonOutcome(bookingId, amount);
  } else if ((SIMPLE_OUTCOMES as readonly string[]).includes(outcome)) {
    await recordSimpleOutcome(bookingId, outcome as (typeof SIMPLE_OUTCOMES)[number]);
  } else {
    redirect(back);
  }

  revalidatePath("/dashboard", "layout");
  redirect(`${back}?saved=outcome#outcome`);
}

export async function resolveFollowupAction(form: FormData): Promise<void> {
  if (!(await isDashboardAuthed())) redirect("/dashboard/login");

  const callId = text(form, "callId");
  if (!UUID_RE.test(callId)) redirect("/dashboard");

  const call = await getCallById(callId);
  if (call && !call.followupResolvedAt) {
    await updateCall(callId, { followupResolvedAt: new Date() });
  }

  revalidatePath("/dashboard", "layout");
  redirect(safeReturnTo(text(form, "returnTo"), "/dashboard"));
}
