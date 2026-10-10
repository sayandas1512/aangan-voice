import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import type { getCalcomClient as GetCalcomClientFn } from "@/lib/integrations/calcom";
import { restoreEnv } from "./helpers/restore-env";

// These exercise lib/db/queries.ts (listActiveDesigners), which needs a real
// DATABASE_URL. Locally that comes from .env.local (loaded by
// vitest.config.ts); CI has no DB secret configured yet, so skip there
// rather than fail the pipeline — see DECISIONS.md, Phase 3 notes.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

// This project's .env.local sets CALCOM_MODE=live (DECISIONS.md) — this
// suite tests the deterministic mock client specifically (and would
// otherwise create real bookings on the studio's actual Cal.com calendar
// on every run), so it isolates CALCOM_MODE regardless of the ambient
// environment.
describeIfDb("calcom mock", () => {
  const originalMode = process.env.CALCOM_MODE;
  let client: ReturnType<typeof GetCalcomClientFn>;

  beforeAll(async () => {
    delete process.env.CALCOM_MODE;
    vi.resetModules();
    const { getCalcomClient } = await import("@/lib/integrations/calcom");
    client = getCalcomClient();
  });

  afterAll(() => {
    restoreEnv("CALCOM_MODE", originalMode);
    vi.resetModules();
  });

  it("returns slots with distinct ids and real ISO start times", async () => {
    const slots = await client.getSlots();
    expect(slots.length).toBeGreaterThan(0);
    const ids = new Set(slots.map((s) => s.id));
    expect(ids.size).toBe(slots.length);
    for (const slot of slots) {
      expect(new Date(slot.startIso).toString()).not.toBe("Invalid Date");
    }
  });

  it("books a slot and the returned startIso matches the slot that was offered", async () => {
    const slots = await client.getSlots();
    const target = slots[0];
    const result = await client.book({
      slotId: target.id,
      name: "Test Caller",
      phone: "+91-90000-00000",
    });
    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") {
      expect(result.startIso).toBe(target.startIso);
    }
  });

  it("returns slot_taken on a second booking attempt for the same slot", async () => {
    const slots = await client.getSlots();
    const target = slots[0];
    const first = await client.book({ slotId: target.id, name: "A", phone: "+91-1" });
    const second = await client.book({ slotId: target.id, name: "B", phone: "+91-2" });
    expect(first.status).toBe("confirmed");
    expect(second.status).toBe("slot_taken");
  });
});
