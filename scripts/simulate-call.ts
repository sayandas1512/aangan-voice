import { getGeminiClient } from "@/lib/integrations/gemini";
import { getCalcomClient } from "@/lib/integrations/calcom";
import { getResendClient } from "@/lib/integrations/resend";
import { getHubspotClient } from "@/lib/integrations/hubspot";
import { listActiveDesigners } from "@/lib/db/queries";
import { CALL_FIXTURES, type CallFixture } from "../tests/fixtures/calls";

/**
 * Phase 3 smoke test: replays a fixture (structured answers derived from a
 * real knowledge/transcripts/*.md call) through the integration layer —
 * classify + getSlots in parallel, book, and (for yes/maybe) a designer
 * note + HubSpot sync. Runs entirely against the mock clients by default
 * (INTEGRATIONS_MODE=mock, no keys needed).
 *
 * This does not yet hit the Next.js API routes (app/api/vaani/tools/*,
 * app/api/vaani/webhook/call-ended) — those are built in Phases 5-6. Once
 * they exist, extend this script (or add a parallel one) to POST to them
 * instead of calling the integration clients directly, per brief section 12.
 */

async function runFixture(fixture: CallFixture) {
  console.log(`\n=== ${fixture.id} — ${fixture.note} ===`);

  const gemini = getGeminiClient();
  const calcom = getCalcomClient();

  const [classification, slots] = await Promise.all([
    gemini.classify(fixture.answers),
    calcom.getSlots(),
  ]);

  console.log(`classify -> verdict=${classification.verdict} reasonCode=${classification.reasonCode ?? "-"} reason="${classification.reason}"`);

  const verdictOk = classification.verdict === fixture.expectedVerdict;
  console.log(verdictOk ? "  [ok] verdict matches expected" : `  [MISMATCH] expected ${fixture.expectedVerdict}`);
  if (fixture.expectedReasonCode && classification.reasonCode !== fixture.expectedReasonCode) {
    console.log(`  [MISMATCH] expected reasonCode ${fixture.expectedReasonCode}, got ${classification.reasonCode}`);
  }

  if (classification.verdict === "no") {
    console.log("  -> agent closes politely. No booking, no email, no HubSpot deal.");
    return { fixture, classification, booking: null };
  }

  if (slots.length === 0) {
    console.log("  [warn] no slots returned — seed designers first (npm run seed).");
    return { fixture, classification, booking: null };
  }

  const booking = await calcom.book({
    slotId: slots[0].id,
    name: fixture.callerName,
    email: fixture.callerEmail,
    phone: fixture.callerPhone,
  });

  if (booking.status === "slot_taken") {
    console.log("  [warn] slot_taken on first attempt — offering next slot would happen here.");
    return { fixture, classification, booking };
  }

  console.log(`booked -> ${booking.designer} at ${booking.startIso}, meet=${booking.meetUrl}`);

  const designers = await listActiveDesigners();
  const designer = designers.find((d) => d.id === booking.designerId);
  const resend = getResendClient();
  const note = buildQuickNote(fixture, classification.reason, booking);
  const sent = await resend.sendEmail({
    to: designer?.email ?? "mock-designer@example.com",
    subject: `New consultation booked — ${fixture.callerName}`,
    text: note,
  });
  console.log(`email -> id=${sent.id}`);

  const hubspot = getHubspotClient();
  const synced = await hubspot.upsertContactAndDeal({
    name: fixture.callerName,
    phone: fixture.callerPhone,
    email: fixture.callerEmail,
    verdict: classification.verdict,
    summary: fixture.note,
    bookingStartIso: booking.startIso,
    designerName: booking.designer,
  });
  console.log(`hubspot -> contactId=${synced.contactId} dealId=${synced.dealId}`);

  return { fixture, classification, booking };
}

function buildQuickNote(fixture: CallFixture, reason: string, booking: Extract<Awaited<ReturnType<ReturnType<typeof getCalcomClient>["book"]>>, { status: "confirmed" }>) {
  return [
    "New consultation booked",
    `When: ${booking.startIso}  |  Meet: ${booking.meetUrl}`,
    `Caller: ${fixture.callerName}  ${fixture.callerPhone}  ${fixture.callerEmail ?? ""}`,
    `Verdict: ${fixture.expectedVerdict} because ${reason}`,
  ].join("\n");
}

async function main() {
  const onlyId = process.argv[2];
  const fixtures = onlyId ? CALL_FIXTURES.filter((f) => f.id === onlyId) : CALL_FIXTURES;
  if (fixtures.length === 0) {
    console.error(`No fixture found for "${onlyId}". Available: ${CALL_FIXTURES.map((f) => f.id).join(", ")}`);
    process.exit(1);
  }

  const results = [];
  for (const fixture of fixtures) {
    results.push(await runFixture(fixture));
  }

  const mismatches = results.filter((r) => r.classification.verdict !== r.fixture.expectedVerdict);
  console.log(`\n${results.length} fixture(s) run, ${mismatches.length} verdict mismatch(es).`);
  if (mismatches.length > 0) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
