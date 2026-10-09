import { z } from "zod";
import { env } from "@/lib/env";
import { verifyToolRequest, unauthorized, badRequest } from "@/lib/api/vaani-tool-auth";
import { getCalcomClient } from "@/lib/integrations/calcom";
import { isAfterHours } from "@/lib/domain/after-hours";
import {
  findOrCreateCallByVaaniId,
  getBookingForCall,
  insertAnswers,
  insertBooking,
  updateCall,
} from "@/lib/db/queries";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BodySchema = z.object({
  call_id: z.string().min(1),
  caller_phone: z.string().min(1),
  slot_id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional(),
});

export async function POST(request: Request) {
  if (!verifyToolRequest(request)) {
    return unauthorized();
  }

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest("invalid request body", parsed.error.flatten());
  }

  const { call_id, caller_phone, slot_id, name, email } = parsed.data;
  const now = new Date();

  const call = await findOrCreateCallByVaaniId({
    vaaniCallId: call_id,
    callerPhone: caller_phone,
    startedAt: now,
    afterHours: isAfterHours(now, {
      timezone: env.TIMEZONE,
      hoursStart: env.STUDIO_HOURS_START,
      hoursEnd: env.STUDIO_HOURS_END,
    }),
  });

  // Idempotent: a retried/duplicate book call for a call that already has
  // a confirmed booking returns that booking instead of booking again.
  const existing = await getBookingForCall(call.id);
  if (existing && existing.status === "confirmed") {
    return Response.json({
      status: "confirmed",
      start_iso: existing.startAt?.toISOString(),
      designer: null,
      meet_url: existing.meetUrl,
    });
  }

  // Brief section 7: missing/malformed email falls back to a phone-only
  // note and flags human_followup, rather than failing the booking.
  const emailValid = email !== undefined && EMAIL_RE.test(email);
  const emailFlagNeeded = email !== undefined && !emailValid;

  const calcom = getCalcomClient();
  const result = await calcom.book({
    slotId: slot_id,
    name,
    email: emailValid ? email : undefined,
    phone: caller_phone,
  });

  if (result.status === "slot_taken") {
    return Response.json({ status: "slot_taken" });
  }

  await insertBooking({
    callId: call.id,
    calcomUid: result.calcomUid,
    designerId: result.designerId,
    startAt: new Date(result.startIso),
    meetUrl: result.meetUrl,
    status: "confirmed",
  });

  // The designer note built after the call (lib/domain/note.ts) needs the
  // caller's name/email, and nowhere else persists them — `bookings` only
  // has Cal.com-side fields per the brief's schema. Stored as answers
  // rows rather than adding booking columns, reusing the table that
  // already exists for "whatever the call collected."
  await insertAnswers(
    call.id,
    [
      { field: "name", value: name },
      emailValid ? { field: "email", value: email } : undefined,
    ].filter((r): r is { field: string; value: string } => r !== undefined)
  );

  if (emailFlagNeeded) {
    await updateCall(call.id, { humanFollowup: true });
  }

  return Response.json({
    status: "confirmed",
    start_iso: result.startIso,
    designer: result.designer,
    meet_url: result.meetUrl,
  });
}
