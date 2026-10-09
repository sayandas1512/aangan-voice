import { z } from "zod";
import { verifyCronRequest } from "@/lib/api/cron-auth";
import { listDueJobs, markJobSucceeded, rescheduleJob, logEvent } from "@/lib/db/queries";
import { attemptHubspotSync } from "@/lib/domain/hubspot-sync";
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

/**
 * Runs every minute (vercel.json). Picks up due jobs from the retry queue
 * (currently only `hubspot_sync`, brief section 7) and either marks them
 * succeeded, reschedules with exponential backoff, or — once
 * MAX_RETRY_ATTEMPTS is exhausted — marks them permanently failed. Never
 * touches the Telegram path; HubSpot retries are background-only by
 * design.
 */
export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const dueJobs = await listDueJobs();
  const results: Array<{ id: string; type: string; outcome: string }> = [];

  for (const job of dueJobs) {
    if (job.type !== "hubspot_sync") {
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

    const parsedPayload = HubspotSyncPayloadSchema.safeParse(job.payload);
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
    const result = await attemptHubspotSync(parsedPayload.data, attempt);

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
