import { z } from "zod";
import { verifyToolRequest, unauthorized, badRequest } from "@/lib/api/vaani-tool-auth";
import { getMostRecentCallByPhone } from "@/lib/db/queries";

/**
 * Optional pre-call hook (brief section 6: "Does it support a pre-call
 * hook — look up the caller number — and dynamic variables?"). Whether
 * Vaani actually calls this before connecting the agent is unconfirmed
 * (DECISIONS.md [ASK] item 1's broader unknown); this exists so the
 * capability is ready to wire in once confirmed, without blocking on it.
 * Returns dynamic variables the agent can use to skip small talk for a
 * repeat caller, never anything price-related.
 */
const BodySchema = z.object({
  caller_phone: z.string().min(1),
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

  const lastCall = await getMostRecentCallByPhone(parsed.data.caller_phone);

  return Response.json({
    is_returning_caller: Boolean(lastCall),
    last_call_at: lastCall?.startedAt?.toISOString() ?? null,
  });
}
