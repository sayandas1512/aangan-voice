import { loadSnapshot } from "@/lib/domain/dashboard-metrics";
import { attemptHubspotSync, attemptHubspotOutcomeUpdate } from "@/lib/domain/hubspot-sync";
import { summarizeCall } from "@/lib/domain/summary";
import { strongestOutcome } from "@/lib/domain/dashboard-format";
import { getDb } from "@/lib/db/client";
import { hubspotSync } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * scripts/seed-sept-enquiries.ts seeded the 12 booked September calls with
 * placeholder HubSpot ids ("seed-deal-t01") because HubSpot was still in
 * mock mode. This replays the real sync for exactly those rows, through the
 * same attemptHubspotSync the live pipeline uses, so the dashboard's
 * "Open in HubSpot" links go to real records — then mirrors each booking's
 * recorded outcome onto the deal's stage.
 *
 * Idempotent: it only touches rows whose deal id is still a "seed-deal-*"
 * placeholder, so re-running after a partial failure picks up where it
 * stopped and never duplicates a deal. Pass `--limit N` to try a few first.
 */

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const snap = await loadSnapshot();
  const pending = snap.hubspot.filter((h) => h.dealId?.startsWith("seed-deal-")).slice(0, LIMIT);
  console.log(`${pending.length} placeholder HubSpot row(s) to sync`);

  let synced = 0;
  let failed = 0;

  for (const row of pending) {
    const call = snap.calls.find((c) => c.id === row.callId);
    const booking = snap.bookings.find((b) => b.callId === row.callId && b.status === "confirmed");
    const classification = snap.classifications
      .filter((c) => c.callId === row.callId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!call || !booking || !classification || classification.verdict === "no") {
      console.warn(`skip ${row.id}: missing call/booking/qualifying verdict`);
      continue;
    }

    const answers: Record<string, string> = {};
    for (const a of snap.answers) if (a.callId === call.id && a.value) answers[a.field] = a.value;
    const designerName = booking.designerId ? snap.designers.find((d) => d.id === booking.designerId)?.name : undefined;
    const name = answers.name ?? `Caller ${call.callerPhone.slice(-5)}`;

    const summary = await summarizeCall(call.transcript ?? "", call.id);
    const result = await attemptHubspotSync(
      {
        hubspotSyncId: row.id,
        name,
        phone: call.callerPhone,
        email: answers.email,
        verdict: classification.verdict,
        summary,
        bookingStartIso: booking.startAt?.toISOString(),
        designerName,
      },
      1
    );

    if (!result.success) {
      failed += 1;
      console.error(`✗ ${name}: ${result.error}`);
      await sleep(500);
      continue;
    }

    const [updated] = await getDb().select().from(hubspotSync).where(eq(hubspotSync.id, row.id));
    const best = strongestOutcome(snap.outcomes.filter((o) => o.bookingId === booking.id));
    let outcomeNote = "";
    if (best && updated?.dealId) {
      const o = await attemptHubspotOutcomeUpdate({
        dealId: updated.dealId,
        outcome: best.outcome as "held" | "no_show" | "not_fit" | "won",
        amountInr: best.amountInr ? Number(best.amountInr) : undefined,
      });
      outcomeNote = o.success ? ` → ${best.outcome}` : ` (outcome update failed: ${o.error})`;
    }
    synced += 1;
    console.log(`✓ ${name}: deal ${updated?.dealId}${outcomeNote}`);
    await sleep(500); // stay well inside HubSpot's per-10s request limit
  }

  console.log(`Done. synced=${synced} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
