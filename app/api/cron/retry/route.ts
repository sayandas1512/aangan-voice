import { z } from "zod";
import { verifyCronRequest } from "@/lib/api/cron-auth";
import { listDueJobs, markJobSucceeded, rescheduleJob, logEvent } from "@/lib/db/queries";
import { attemptHubspotSync, attemptHubspotOutcomeUpdate } from "@/lib/domain/hubspot-sync";
import { nextRunAt, isExhausted } from "@/lib/domain/retry";

const HubspotSyncPayloadSchema = z.object({
  hubspotSyncId: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  verdict: z.enum(["yes", "maybe"]),
  summary: z.string(),
  bookingStartIso: z.string().optional(),
  designerName: z.string().optional(),
});

const HubspotOutcomeUpdatePayloadSchema = z.object({
  dealId: z.string(),
  outcome: z.enum(["held", "no_show", "not_fit", "won"]),
  amountInr: z.number().optional(),
});

type JobHandler = (payload: unknown, attempt: number) => Promise<{ success: boolean; error?: string }>;

const JOB_HANDLERS: Record<string, { schema: z.ZodType; run: JobHandler }> = {
  hubspot_sync: {
    schema: HubspotSyncPayloadSchema,
    run: (payload, attempt) => attemptHubspotSync(payload as z.infer<typeof HubspotSyncPayloadSchema>, attempt),
  },
  hubspot_outcome_update: {
    schema: HubspotOutcomeUpdatePayloadSchema,
    run: (payload) => attemptHubspotOutcomeUpdate(payload as z.infer<typeof HubspotOutcomeUpdatePayloadSchema>),
  },
};

/**
 * Runs every minute (vercel.json). Picks up due jobs from the retry queue
 * and either marks them succeeded, reschedules with exponential backoff,
 * or — once MAX_RETRY_ATTEMPTS is exhausted — marks them permanently
 * failed. Never touches the designer-email path; both job types here are
 * HubSpot-side follow-ups that run entirely in the background.
 */
export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const dueJobs = await listDueJobs();
  const results: Array<{ id: string; type: string; outcome: string }> = [];

  for (const job of dueJobs) {
    const handler = JOB_HANDLERS[job.type];
    if (!handler) {
      await logEvent("unknown_job_type", { jobId: job.id, type: job.type });
      await rescheduleJob(job.id, {
        runAt: job.runAt,
        attempts: job.attempts + 1,
        lastError: `unknown job type: ${job.type}`,
        status: "failed",
      });
      results.push({ id: job.id, type: job.type, outcome: "unknown_type" });
      continue;
    }

    const parsedPayload = handler.schema.safeParse(job.payload);
    if (!parsedPayload.success) {
      await logEvent("malformed_job_payload", { jobId: job.id, type: job.type });
      await rescheduleJob(job.id, {
        runAt: job.runAt,
        attempts: job.attempts + 1,
        lastError: "malformed payload",
        status: "failed",
      });
      results.push({ id: job.id, type: job.type, outcome: "malformed_payload" });
      continue;
    }

    const attempt = job.attempts + 1;
    const result = await handler.run(parsedPayload.data, attempt);

    if (result.success) {
      await markJobSucceeded(job.id);
      results.push({ id: job.id, type: job.type, outcome: "succeeded" });
    } else if (isExhausted(attempt)) {
      await rescheduleJob(job.id, {
        runAt: job.runAt,
        attempts: attempt,
        lastError: result.error ?? "unknown error",
        status: "failed",
      });
      results.push({ id: job.id, type: job.type, outcome: "exhausted" });
    } else {
      await rescheduleJob(job.id, {
        runAt: nextRunAt(attempt),
        attempts: attempt,
        lastError: result.error ?? "unknown error",
        status: "pending",
      });
      results.push({ id: job.id, type: job.type, outcome: "rescheduled" });
    }
  }

  return Response.json({ processed: results.length, results });
}
