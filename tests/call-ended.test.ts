import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, and, gte, lte } from "drizzle-orm";
import { POST as classifyRoute } from "@/app/api/vaani/tools/classify/route";
import { POST as slotsRoute } from "@/app/api/vaani/tools/slots/route";
import { POST as bookRoute } from "@/app/api/vaani/tools/book/route";
import { processCallEnded } from "@/lib/domain/call-ended";
import { getCallByVaaniCallId, getNotificationsForCall, getHubspotSyncForCall, listActiveDesigners } from "@/lib/db/queries";
import { CALL_FIXTURES } from "./fixtures/calls";

const hasDb = Boolean(process.env.DATABASE_URL);

// processCallEnded logs real rows to the shared production events table
// (classification_missing_at_call_end, no_designer_email,
// yes_or_maybe_without_booking, call_failed). The vaani-delivery:<id>
// dedup event is logged by the HTTP webhook route, not processCallEnded
// itself — this file calls processCallEnded directly, so it never
// generates one. Deleting the `calls` rows in afterAll below does NOT
// cascade to events — it's a generic log table with no FK. Cleaned up by
// exact type match + this run's time window, rather than a blanket
// time-window delete, since other test files can log events in the same
// second when the suite runs with parallelism.
const testRunStartedAt = new Date();
const CALL_ENDED_EVENT_TYPES = [
  "classification_missing_at_call_end",
  "no_designer_email",
  "yes_or_maybe_without_booking",
  "call_failed",
];

// The seeded placeholder designers (scripts/seed.ts) have no email — a
// real deployment fills it in once the founder sets it up. The Cal.com
// mock round-robins across all active designers with no guaranteed query
// ordering, so rather than guess which one a given booking lands on, patch
// all of them with a placeholder email for this file's duration, and
// restore each one's original value (not delete the rows — they aren't
// this file's to remove) in afterAll.
const patchedDesigners: Array<{ id: string; originalEmail: string | null }> = [];

beforeAll(async () => {
  if (!hasDb) return;
  const designers = await listActiveDesigners();
  const { getDb } = await import("@/lib/db/client");
  const { designers: designersTable } = await import("@/lib/db/schema");
  for (const d of designers) {
    patchedDesigners.push({ id: d.id, originalEmail: d.email });
    await getDb()
      .update(designersTable)
      .set({ email: `test-designer-${d.id}@example.com` })
      .where(eq(designersTable.id, d.id));
  }
});

function jsonRequest(body: unknown) {
  return new Request("https://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createdCallIds: string[] = [];
function testCallId(): string {
  const id = `test-callended-${randomUUID()}`;
  createdCallIds.push(id);
  return id;
}

afterAll(async () => {
  if (!hasDb) return;
  const { getDb } = await import("@/lib/db/client");
  const { calls, designers: designersTable, events } = await import("@/lib/db/schema");
  if (createdCallIds.length > 0) {
    await getDb().delete(calls).where(inArray(calls.vaaniCallId, createdCallIds));
  }
  for (const d of patchedDesigners) {
    await getDb().update(designersTable).set({ email: d.originalEmail }).where(eq(designersTable.id, d.id));
  }
  await getDb()
    .delete(events)
    .where(and(gte(events.at, testRunStartedAt), lte(events.at, new Date()), inArray(events.type, CALL_ENDED_EVENT_TYPES)));
});

/** Drives a call through classify + slots + book, as a real call would before ending. */
async function setUpBookedCall(fixture: (typeof CALL_FIXTURES)[number]) {
  const callId = testCallId();
  await classifyRoute(
    jsonRequest({ call_id: callId, caller_phone: fixture.callerPhone, answers: fixture.answers })
  );
  const slotsRes = await slotsRoute(jsonRequest({ call_id: callId }));
  const { slots } = await slotsRes.json();
  await bookRoute(
    jsonRequest({
      call_id: callId,
      caller_phone: fixture.callerPhone,
      slot_id: slots[0].id,
      name: fixture.callerName,
      email: fixture.callerEmail,
    })
  );
  return callId;
}

describe.skipIf(!hasDb)("processCallEnded", () => {
  it("yes verdict: sends the designer email and syncs HubSpot", async () => {
    const fixture = CALL_FIXTURES.find((f) => f.id === "T01")!;
    const callId = await setUpBookedCall(fixture);

    const status = await processCallEnded({
      vaaniCallId: callId,
      transcript: "Front Desk: Hello.\nCaller: Hi, I'd like a consultation.",
      durationSec: 240,
      rawPayload: { test: true },
    });
    expect(status).toBe("processed");

    const call = await getCallByVaaniCallId(callId);
    expect(call?.status).toBe("completed");

    const notifications = await getNotificationsForCall(call!.id);
    expect(notifications.length).toBe(1);
    expect(notifications[0].channel).toBe("email");
    expect(notifications[0].status).toBe("sent");

    const hubspotSync = await getHubspotSyncForCall(call!.id);
    expect(hubspotSync?.status).toBe("synced");
    expect(hubspotSync?.dealId).toBeTruthy();
  });

  it("is idempotent: processing the same call_id twice only runs the pipeline once", async () => {
    const fixture = CALL_FIXTURES.find((f) => f.id === "T01")!;
    const callId = await setUpBookedCall(fixture);

    const first = await processCallEnded({ vaaniCallId: callId, transcript: "t", rawPayload: {} });
    const second = await processCallEnded({ vaaniCallId: callId, transcript: "t", rawPayload: {} });

    expect(first).toBe("processed");
    expect(second).toBe("already_processed");

    const call = await getCallByVaaniCallId(callId);
    const notifications = await getNotificationsForCall(call!.id);
    expect(notifications.length).toBe(1); // not 2 — the second run did nothing
  });

  it("no verdict: persists the call but never sends an email or touches HubSpot", async () => {
    const fixture = CALL_FIXTURES.find((f) => f.id === "T03")!; // out_of_area -> no
    const callId = testCallId();
    await classifyRoute(
      jsonRequest({ call_id: callId, caller_phone: fixture.callerPhone, answers: fixture.answers })
    );

    const status = await processCallEnded({ vaaniCallId: callId, transcript: "t", rawPayload: {} });
    expect(status).toBe("processed");

    const call = await getCallByVaaniCallId(callId);
    expect(call?.status).toBe("completed");

    const notifications = await getNotificationsForCall(call!.id);
    expect(notifications.length).toBe(0);

    const hubspotSync = await getHubspotSyncForCall(call!.id);
    expect(hubspotSync).toBeUndefined();
  });

  it("missing classification: flags human_followup instead of guessing", async () => {
    const callId = testCallId();
    // No classify call at all — simulates a call-ended webhook arriving
    // for a call that never reached mid-call classify.
    const status = await processCallEnded({
      vaaniCallId: callId,
      callerPhone: "+91-90000-01111",
      transcript: "t",
      rawPayload: {},
    });
    expect(status).toBe("processed");

    const call = await getCallByVaaniCallId(callId);
    expect(call?.humanFollowup).toBe(true);
  });
});
