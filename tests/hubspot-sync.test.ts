import { describe, expect, it, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { attemptHubspotSync } from "@/lib/domain/hubspot-sync";
import { insertHubspotSyncPending, getHubspotSyncForCall } from "@/lib/db/queries";
import type { HubspotClient } from "@/lib/integrations/hubspot";
import { MAX_RETRY_ATTEMPTS } from "@/lib/domain/retry";

const hasDb = Boolean(process.env.DATABASE_URL);

function stubClient(behavior: "succeed" | { fail: string }): HubspotClient {
  return {
    async upsertContactAndDeal() {
      if (behavior !== "succeed") throw new Error(behavior.fail);
      return { contactId: "stub-contact-1", dealId: "stub-deal-1" };
    },
    async updateDealOutcome() {},
  };
}

const createdCallIds: string[] = [];

/** Creates a throwaway call row (FK target) + pending hubspot_sync row for isolated attemptHubspotSync tests. */
async function insertHubspotSyncPendingForTest() {
  const { getDb } = await import("@/lib/db/client");
  const { calls } = await import("@/lib/db/schema");
  const vaaniCallId = `test-hubspotsync-${randomUUID()}`;
  createdCallIds.push(vaaniCallId);
  const [call] = await getDb()
    .insert(calls)
    .values({ vaaniCallId, callerPhone: "+91-90000-00000", startedAt: new Date(), afterHours: false })
    .returning();
  const row = await insertHubspotSyncPending(call.id);
  return { ...row, callId: call.id };
}

afterAll(async () => {
  if (!hasDb || createdCallIds.length === 0) return;
  const { getDb } = await import("@/lib/db/client");
  const { calls } = await import("@/lib/db/schema");
  await getDb().delete(calls).where(inArray(calls.vaaniCallId, createdCallIds));
});

describe.skipIf(!hasDb)("attemptHubspotSync", () => {
  it("on success, marks the row synced with the returned ids", async () => {
    const row = await insertHubspotSyncPendingForTest();
    const result = await attemptHubspotSync(
      { hubspotSyncId: row.id, name: "Test", phone: "+91-90000-00000", verdict: "yes", summary: "s" },
      1,
      stubClient("succeed")
    );
    expect(result.success).toBe(true);

    const updated = await getHubspotSyncForCall(row.callId);
    expect(updated?.status).toBe("synced");
    expect(updated?.contactId).toBe("stub-contact-1");
    expect(updated?.dealId).toBe("stub-deal-1");
  });

  it("on failure, records the error and keeps status pending while attempts remain", async () => {
    const row = await insertHubspotSyncPendingForTest();
    const result = await attemptHubspotSync(
      { hubspotSyncId: row.id, name: "Test", phone: "+91-90000-00000", verdict: "yes", summary: "s" },
      1,
      stubClient({ fail: "simulated outage" })
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("simulated outage");

    const updated = await getHubspotSyncForCall(row.callId);
    expect(updated?.status).toBe("pending");
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBe("simulated outage");
  });

  it("marks the row permanently failed once MAX_RETRY_ATTEMPTS is reached", async () => {
    const row = await insertHubspotSyncPendingForTest();
    const result = await attemptHubspotSync(
      { hubspotSyncId: row.id, name: "Test", phone: "+91-90000-00000", verdict: "yes", summary: "s" },
      MAX_RETRY_ATTEMPTS,
      stubClient({ fail: "still down" })
    );
    expect(result.success).toBe(false);

    const updated = await getHubspotSyncForCall(row.callId);
    expect(updated?.status).toBe("failed");
    expect(updated?.attempts).toBe(MAX_RETRY_ATTEMPTS);
  });
});
