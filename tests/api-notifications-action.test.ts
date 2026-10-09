import { describe, expect, it, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { POST as classifyRoute } from "@/app/api/vaani/tools/classify/route";
import { POST as slotsRoute } from "@/app/api/vaani/tools/slots/route";
import { POST as bookRoute } from "@/app/api/vaani/tools/book/route";
import { GET as actionGet, POST as actionPost } from "@/app/api/notifications/action/route";
import { signActionToken } from "@/lib/domain/action-link";
import { getBookingForCall, getCallByVaaniCallId, getOutcomesForBooking } from "@/lib/db/queries";
import { CALL_FIXTURES } from "./fixtures/calls";

const hasDb = Boolean(process.env.DATABASE_URL);

// VAANI_MODE is "live" in this project's .env.local, so the tool routes
// these tests call through require the shared secret header.
function jsonRequest(body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.VAANI_WEBHOOK_SECRET) {
    headers["x-vaani-shared-secret"] = process.env.VAANI_WEBHOOK_SECRET;
  }
  return new Request("https://example.com", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const createdCallIds: string[] = [];
function testCallId(): string {
  const id = `test-actionroute-${randomUUID()}`;
  createdCallIds.push(id);
  return id;
}

afterAll(async () => {
  if (!hasDb || createdCallIds.length === 0) return;
  const { getDb } = await import("@/lib/db/client");
  const { calls } = await import("@/lib/db/schema");
  await getDb().delete(calls).where(inArray(calls.vaaniCallId, createdCallIds));
});

async function setUpBooking() {
  const fixture = CALL_FIXTURES.find((f) => f.id === "T01")!;
  const callId = testCallId();
  await classifyRoute(jsonRequest({ call_id: callId, caller_phone: fixture.callerPhone, answers: fixture.answers }));
  const slotsRes = await slotsRoute(jsonRequest({ call_id: callId }));
  const { slots } = await slotsRes.json();
  await bookRoute(
    jsonRequest({ call_id: callId, caller_phone: fixture.callerPhone, slot_id: slots[0].id, name: fixture.callerName })
  );
  const call = await getCallByVaaniCallId(callId);
  const booking = await getBookingForCall(call!.id);
  return { callId: call!.id, bookingId: booking!.id };
}

describe.skipIf(!hasDb)("GET/POST /api/notifications/action", () => {
  it("rejects a missing token", async () => {
    const res = await actionGet(new Request("https://example.com/api/notifications/action"));
    expect(res.status).toBe(400);
  });

  it("rejects a garbage token", async () => {
    const res = await actionGet(new Request("https://example.com/api/notifications/action?token=garbage"));
    expect(res.status).toBe(400);
  });

  it("held: records the outcome and is idempotent on a second click", async () => {
    const { bookingId } = await setUpBooking();
    const token = signActionToken({ callId: "unused", bookingId, action: "held" });
    const url = `https://example.com/api/notifications/action?token=${encodeURIComponent(token)}`;

    const first = await actionGet(new Request(url));
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("Marked as held");

    const second = await actionGet(new Request(url));
    expect(second.status).toBe(200);

    const outcomes = await getOutcomesForBooking(bookingId);
    expect(outcomes.filter((o) => o.outcome === "held").length).toBe(1); // not 2
  });

  it("won: GET serves an amount form, POST with a valid amount records the outcome", async () => {
    const { bookingId } = await setUpBooking();
    const token = signActionToken({ callId: "unused", bookingId, action: "won" });

    const formRes = await actionGet(new Request(`https://example.com/api/notifications/action?token=${encodeURIComponent(token)}`));
    expect(formRes.status).toBe(200);
    const formHtml = await formRes.text();
    expect(formHtml).toContain("<form");
    expect(formHtml).toContain('name="amount"');

    const form = new FormData();
    form.set("token", token);
    form.set("amount", "950000");
    const postRes = await actionPost(new Request("https://example.com/api/notifications/action", { method: "POST", body: form }));
    expect(postRes.status).toBe(200);
    // en-IN groups by lakh, not thousand: "9,50,000" not "950,000".
    expect(await postRes.text()).toContain("9,50,000");

    const outcomes = await getOutcomesForBooking(bookingId);
    const won = outcomes.find((o) => o.outcome === "won");
    expect(won).toBeTruthy();
    expect(Number(won!.amountInr)).toBe(950000);
  });

  it("won: POST with an invalid amount re-renders the form with an error, not a 500", async () => {
    const { bookingId } = await setUpBooking();
    const token = signActionToken({ callId: "unused", bookingId, action: "won" });

    const form = new FormData();
    form.set("token", token);
    form.set("amount", "not-a-number");
    const res = await actionPost(new Request("https://example.com/api/notifications/action", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain("valid amount");
  });
});
