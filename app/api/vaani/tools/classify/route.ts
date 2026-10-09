import { z } from "zod";
import { env } from "@/lib/env";
import { verifyToolRequest, unauthorized, badRequest } from "@/lib/api/vaani-tool-auth";
import { qualify } from "@/lib/domain/qualify";
import { isAfterHours } from "@/lib/domain/after-hours";
import { findOrCreateCallByVaaniId, insertAnswers, insertClassification, updateCall } from "@/lib/db/queries";

const AnswersSchema = z.object({
  propertyType: z.string().optional(),
  area: z.string().optional(),
  sizeSqFt: z.string().optional(),
  workType: z.string().optional(),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  decisionMaker: z.string().optional(),
});

// Vaani's custom-tool parameter extractor fills flat top-level fields from
// the conversation, not a nested object — a dotted parameter name like
// "answers.propertyType" was tried live and never got populated (see
// DECISIONS.md). The flat fields are the real shape Vaani sends; `answers`
// is kept for direct/test callers that already pass the nested shape.
const BodySchema = z.object({
  call_id: z.string().min(1),
  // No caller ID exists on a WebRTC call the way it does on telephony — the
  // agent can only capture a phone number if the caller says one out loud,
  // and may not get to it before calling classify. Falls back to "unknown"
  // rather than rejecting the call (same fallback call-ended.ts already uses).
  caller_phone: z.string().min(1).optional(),
  started_at: z.string().min(1).optional(),
  answers: AnswersSchema.optional(),
  propertyType: z.string().optional(),
  area: z.string().optional(),
  sizeSqFt: z.string().optional(),
  workType: z.string().optional(),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  decisionMaker: z.string().optional(),
});

export async function POST(request: Request) {
  if (!verifyToolRequest(request)) {
    return unauthorized();
  }

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    console.error("[classify] invalid body from caller", JSON.stringify({ json, errors: parsed.error.flatten() }));
    return badRequest("invalid request body", parsed.error.flatten());
  }

  const { call_id, caller_phone, started_at, answers, ...flatAnswers } = parsed.data;
  const startedAt = started_at ? new Date(started_at) : new Date();
  const mergedAnswers = { ...answers, ...flatAnswers };

  // Write to Neon before any slow side effect (brief section 7): the call
  // row and raw answers land first, classify's own fallback-on-timeout
  // behavior (lib/domain/qualify.ts) happens after.
  const call = await findOrCreateCallByVaaniId({
    vaaniCallId: call_id,
    callerPhone: caller_phone ?? "unknown",
    startedAt,
    afterHours: isAfterHours(startedAt, {
      timezone: env.TIMEZONE,
      hoursStart: env.STUDIO_HOURS_START,
      hoursEnd: env.STUDIO_HOURS_END,
    }),
  });

  const answerRows = Object.entries(mergedAnswers)
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => ({ field, value: value as string }));
  await insertAnswers(call.id, answerRows);

  const { result, humanFollowup } = await qualify(mergedAnswers);

  await insertClassification({
    callId: call.id,
    verdict: result.verdict,
    reason: result.reason,
    reasonCode: result.reasonCode,
    missingFields: result.missingFields,
    model: result.model,
    latencyMs: result.latencyMs,
  });

  if (humanFollowup) {
    await updateCall(call.id, { humanFollowup: true });
  }

  return Response.json({
    verdict: result.verdict,
    reason: result.reason,
    reasonCode: result.reasonCode,
    missingFields: result.missingFields,
  });
}
