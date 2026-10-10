import { describe, expect, it, afterAll, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { POST as ClassifyRouteFn } from "@/app/api/vaani/tools/classify/route";
import type { POST as SlotsRouteFn } from "@/app/api/vaani/tools/slots/route";
import type { POST as BookRouteFn } from "@/app/api/vaani/tools/book/route";
import type { POST as PreCallRouteFn } from "@/app/api/vaani/pre-call/route";
import { CALL_FIXTURES } from "./fixtures/calls";

const hasDb = Boolean(process.env.DATABASE_URL);

// This project's .env.local sets GEMINI_MODE/CALCOM_MODE=live (DECISIONS.md)
// — the "book" tests below would otherwise create real bookings on the
// studio's actual Cal.com calendar on every run. Loaded dynamically after
// clearing both so classify/book run against mocks regardless of the
// ambient environment.
const originalGeminiMode = process.env.GEMINI_MODE;
const originalCalcomMode = process.env.CALCOM_MODE;
let classifyRoute: typeof ClassifyRouteFn;
let slotsRoute: typeof SlotsRouteFn;
let bookRoute: typeof BookRouteFn;
let preCallRoute: typeof PreCallRouteFn;

beforeAll(async () => {
  if (!hasDb) return;
  delete process.env.GEMINI_MODE;
  delete process.env.CALCOM_MODE;
  vi.resetModules();
  ({ POST: classifyRoute } = await import("@/app/api/vaani/tools/classify/route"));
  ({ POST: slotsRoute } = await import("@/app/api/vaani/tools/slots/route"));
  ({ POST: bookRoute } = await import("@/app/api/vaani/tools/book/route"));
  ({ POST: preCallRoute } = await import("@/app/api/vaani/pre-call/route"));
});

// VAANI_MODE is "live" in this project's .env.local (the deployed tools
// endpoints require the shared secret), so these test requests need the
// same header a real Vaani tool call would send.
function jsonRequest(body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.VAANI_TOOL_SHARED_SECRET) {
    headers["x-vaani-shared-secret"] = process.env.VAANI_TOOL_SHARED_SECRET;
  }
  return new Request("https://example.com", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// These routes write real rows to Neon (classify/book create a `calls` row
// via findOrCreateCallByVaaniId). Every call_id this file hands to a route
// is tracked here and deleted in afterAll, so this suite — which runs on
// every local `npm test` and every CI run — doesn't permanently litter the
// shared production branch with test-* rows on each run.
const createdCallIds: string[] = [];
function testCallId(): string {
  const id = `test-${randomUUID()}`;
  createdCallIds.push(id);
  return id;
}

afterAll(async () => {
  process.env.GEMINI_MODE = originalGeminiMode;
  process.env.CALCOM_MODE = originalCalcomMode;
  vi.resetModules();
  if (!hasDb || createdCallIds.length === 0) return;
  const { getDb } = await import("@/lib/db/client");
  const { calls } = await import("@/lib/db/schema");
  await getDb().delete(calls).where(inArray(calls.vaaniCallId, createdCallIds));
});

describe.skipIf(!hasDb)("mid-call tool routes", () => {
  it("classify: persists the call + answers and returns the expected verdict", async () => {
    const fixture = CALL_FIXTURES.find((f) => f.id === "T01")!;
    const callId = testCallId();

    const res = await classifyRoute(
      jsonRequest({
        call_id: callId,
        caller_phone: fixture.callerPhone,
        answers: fixture.answers,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe(fixture.expectedVerdict);
  });

  it("classify: rejects a malformed body with 400, not a 500", async () => {
    const res = await classifyRoute(jsonRequest({ not: "valid" }));
    expect(res.status).toBe(400);
  });

  it("classify: an empty enquiry asks for details and records nothing", async () => {
    const callId = testCallId();
    const res = await classifyRoute(jsonRequest({ call_id: callId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("maybe");
    expect(body.missingFields.length).toBeGreaterThan(0);
    const { getCallByVaaniCallId } = await import("@/lib/db/queries");
    expect(await getCallByVaaniCallId(callId)).toBeUndefined();
  });

  it("slots: returns the mock slots in the tool-contract shape", async () => {
    const res = await slotsRoute(jsonRequest({ call_id: testCallId() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.slots)).toBe(true);
    if (body.slots.length > 0) {
      expect(body.slots[0]).toHaveProperty("id");
      expect(body.slots[0]).toHaveProperty("start_iso");
      expect(body.slots[0]).toHaveProperty("designer_first_name");
    }
  });

  it("book: books a fetched slot and returns a confirmation", async () => {
    const callId = testCallId();
    const slotsRes = await slotsRoute(jsonRequest({ call_id: callId }));
    const { slots } = await slotsRes.json();
    expect(slots.length).toBeGreaterThan(0);

    const res = await bookRoute(
      jsonRequest({
        call_id: callId,
        caller_phone: "+91-90000-09999",
        slot_id: slots[0].id,
        name: "Test Caller",
        email: "test@example.com",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("confirmed");
    expect(body.meet_url).toContain(slots[0].id);
  });

  it("book: a second book call for the same call_id is idempotent, not a double booking", async () => {
    const callId = testCallId();
    const slotsRes = await slotsRoute(jsonRequest({ call_id: callId }));
    const { slots } = await slotsRes.json();

    const first = await bookRoute(
      jsonRequest({ call_id: callId, caller_phone: "+91-90000-08888", slot_id: slots[0].id, name: "A" })
    );
    const firstBody = await first.json();

    const second = await bookRoute(
      jsonRequest({ call_id: callId, caller_phone: "+91-90000-08888", slot_id: slots[1].id, name: "A" })
    );
    const secondBody = await second.json();

    expect(secondBody.status).toBe("confirmed");
    expect(secondBody.meet_url).toBe(firstBody.meet_url);
  });

  it("book: a missing/malformed email still books, phone-only, instead of failing", async () => {
    const callId = testCallId();
    const slotsRes = await slotsRoute(jsonRequest({ call_id: callId }));
    const { slots } = await slotsRes.json();

    const res = await bookRoute(
      jsonRequest({
        call_id: callId,
        caller_phone: "+91-90000-07777",
        slot_id: slots[0].id,
        name: "No Email Caller",
        email: "not-an-email",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("confirmed");
  });

  it("book: a missing name still books and flags a callback instead of failing", async () => {
    const callId = testCallId();
    const slotsRes = await slotsRoute(jsonRequest({ call_id: callId }));
    const { slots } = await slotsRes.json();

    const res = await bookRoute(jsonRequest({ call_id: callId, slot_id: slots[0].id, email: "test@example.com" }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("confirmed");
    const { getCallByVaaniCallId } = await import("@/lib/db/queries");
    expect((await getCallByVaaniCallId(callId))?.humanFollowup).toBe(true);
  });

  it("pre-call: a never-seen phone number is not a returning caller", async () => {
    const res = await preCallRoute(jsonRequest({ caller_phone: `+91-9${randomUUID().slice(0, 9)}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_returning_caller).toBe(false);
  });
});
