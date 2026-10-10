import { z } from "zod";
import { verifyToolRequest, unauthorized, badRequest } from "@/lib/api/vaani-tool-auth";
import { env } from "@/lib/env";
import { getSlots } from "@/lib/domain/slots";
import { getCallByVaaniCallId, updateCall } from "@/lib/db/queries";

const BodySchema = z.object({
  call_id: z.string().min(1),
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

  const { slots, humanFollowup } = await getSlots();

  // Best-effort bookkeeping only — get_slots can legitimately run before
  // classify has created the call row (brief: classify and get_slots run
  // in parallel), so a missing row here is not an error.
  if (humanFollowup) {
    const call = await getCallByVaaniCallId(parsed.data.call_id);
    if (call) {
      await updateCall(call.id, { humanFollowup: true });
    }
  }

  return Response.json({
    slots: slots.map((s) => ({
      id: s.id,
      start_iso: s.startIso,
      // Ready to read aloud, in the studio's timezone — the raw ISO is UTC.
      spoken: spokenSlot(new Date(s.startIso), env.TIMEZONE),
      designer_first_name: s.designerFirstName,
    })),
  });
}

/** "Monday, 12 October at 10:30 AM". */
function spokenSlot(d: Date, tz: string): string {
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d)
    .toUpperCase();
  return `${date.replace(/^(\w+),? /, "$1, ")} at ${time}`;
}
