import { integrationMode, env } from "@/lib/env";
import { listActiveDesigners } from "@/lib/db/queries";

export interface Slot {
  id: string;
  startIso: string;
  designerFirstName: string;
}

export interface BookInput {
  slotId: string;
  name: string;
  email?: string;
  phone: string;
}

export type BookResult =
  | { status: "confirmed"; startIso: string; designer: string; designerId: string; meetUrl: string; calcomUid: string }
  | { status: "slot_taken" };

export interface CalcomClient {
  getSlots(): Promise<Slot[]>;
  book(input: BookInput): Promise<BookResult>;
}

// ---------------------------------------------------------------------------
// mock — generates 2-3 round-robin slots across active designers for the
// next 3 business days at fixed times, and tracks bookings in-memory so a
// second attempt on the same slot within a process returns slot_taken.
// ---------------------------------------------------------------------------
const mockBookedSlots = new Set<string>();

function nextBusinessDays(count: number, fromHour = 11): Date[] {
  const days: Date[] = [];
  const cursor = new Date();
  cursor.setHours(fromHour, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  while (days.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      days.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// slotId -> {startIso, designerId}. A regex trying to recover these from the
// slotId string is unreliable (the ISO timestamp embedded in the id itself
// contains hyphens), so the generating call records them directly instead.
const mockSlotIndex = new Map<string, { startIso: string; designerId: string }>();

async function mockGetSlots(): Promise<Slot[]> {
  const designers = await listActiveDesigners();
  if (designers.length === 0) {
    return [];
  }
  const days = nextBusinessDays(3);
  return days.map((d, i) => {
    const designer = designers[i % designers.length];
    const startIso = d.toISOString();
    const id = `mock-slot-${crypto.randomUUID()}`;
    mockSlotIndex.set(id, { startIso, designerId: designer.id });
    return { id, startIso, designerFirstName: designer.name };
  });
}

async function mockBook(input: BookInput): Promise<BookResult> {
  if (mockBookedSlots.has(input.slotId)) {
    return { status: "slot_taken" };
  }
  const slot = mockSlotIndex.get(input.slotId);
  if (!slot) {
    throw new Error(`Unknown mock slot id: ${input.slotId}. Call getSlots() first.`);
  }
  mockBookedSlots.add(input.slotId);

  const designers = await listActiveDesigners();
  const designer = designers.find((d) => d.id === slot.designerId) ?? designers[0];

  return {
    status: "confirmed",
    startIso: slot.startIso,
    designer: designer?.name ?? "Studio Designer",
    designerId: designer?.id ?? "unknown",
    meetUrl: `https://meet.mock/${input.slotId}`,
    calcomUid: `mock-booking-${input.slotId}`,
  };
}

const mockClient: CalcomClient = {
  getSlots: mockGetSlots,
  book: mockBook,
};

// ---------------------------------------------------------------------------
// live — Cal.com API v2, verified directly against the real API during
// Phase 9's live smoke test (see DECISIONS.md). Endpoints are individually
// versioned via the `cal-api-version` header, not the URL; getting it wrong
// produces a generic 404 "Cannot GET", not a 400, which is what the
// original unverified implementation hit. Query/body param names below
// (`start`/`end`, `start` not `time` in slot rows, `attendee.email`
// required) are also real-API findings, not guesses.
// ---------------------------------------------------------------------------
const CALCOM_API_BASE = "https://api.cal.com/v2";
// Cal.com's booking form hard-requires attendee.email and actively
// verifies the domain can receive mail (verified live: an RFC 2606
// `.invalid` placeholder was rejected with `email_domain_cannot_receive_mail`,
// not just a format check) — even though our own book tool treats a
// missing/invalid caller email as a soft fallback, not a failure (see
// app/api/vaani/tools/book/route.ts). Falls back to the studio's own inbox
// rather than a fake domain, since it has to be a real, deliverable
// address — the booking confirmation just lands with the studio instead
// of nowhere, which is harmless since this only fires when the caller
// never gave an email at all.
function calcomFallbackEmail(): string {
  return env.CALCOM_FALLBACK_EMAIL ?? "no-email-given@aangan-studio.invalid";
}

async function liveGetSlots(): Promise<Slot[]> {
  if (!env.CALCOM_API_KEY || !env.CALCOM_EVENT_TYPE_ID) {
    throw new Error("CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID are required in live mode.");
  }
  const now = new Date();
  const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const res = await fetch(
    `${CALCOM_API_BASE}/slots?eventTypeId=${env.CALCOM_EVENT_TYPE_ID}&start=${now.toISOString().slice(0, 10)}&end=${until.toISOString().slice(0, 10)}`,
    {
      headers: {
        Authorization: `Bearer ${env.CALCOM_API_KEY}`,
        "cal-api-version": "2024-09-04",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Cal.com getSlots failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  interface RawSlot {
    start: string;
  }
  // The slots endpoint doesn't return host/attendee info per slot (only
  // the booking response does) — designerFirstName is generic until a
  // booking actually confirms who the designer is.
  const allSlots: Slot[] = (Object.values(data.data ?? {}) as RawSlot[][])
    .flat()
    .slice(0, 3)
    .map((s) => ({
      id: s.start,
      startIso: s.start,
      designerFirstName: "Studio Designer",
    }));
  return allSlots;
}

async function liveBook(input: BookInput): Promise<BookResult> {
  if (!env.CALCOM_API_KEY || !env.CALCOM_EVENT_TYPE_ID) {
    throw new Error("CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID are required in live mode.");
  }
  const res = await fetch(`${CALCOM_API_BASE}/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CALCOM_API_KEY}`,
      "Content-Type": "application/json",
      "cal-api-version": "2024-08-13",
    },
    body: JSON.stringify({
      eventTypeId: Number(env.CALCOM_EVENT_TYPE_ID),
      start: input.slotId,
      attendee: {
        name: input.name,
        email: input.email ?? calcomFallbackEmail(),
        phoneNumber: input.phone,
        timeZone: env.TIMEZONE,
      },
    }),
  });
  if (res.status === 409) {
    return { status: "slot_taken" };
  }
  if (!res.ok) {
    throw new Error(`Cal.com book failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const calcomHostId: string | undefined = data.data?.hosts?.[0]?.id ? String(data.data.hosts[0].id) : undefined;

  // bookings.designer_id is a UUID FK into OUR OWN designers table, not
  // Cal.com's id space — writing Cal.com's numeric host id there directly
  // crashes the insert (verified live: Postgres rejects "3338149" as a
  // UUID). Resolve back to our internal designer by matching calcomHostId,
  // same field scripts/seed.ts already seeds for exactly this purpose.
  const designers = await listActiveDesigners();
  const matchedDesigner = calcomHostId ? designers.find((d) => d.calcomHostId === calcomHostId) : undefined;
  const fallbackDesigner = matchedDesigner ?? designers[0];

  return {
    status: "confirmed",
    startIso: data.data?.start ?? input.slotId,
    designer: fallbackDesigner?.name ?? data.data?.hosts?.[0]?.name ?? "Studio Designer",
    designerId: fallbackDesigner?.id ?? "unknown",
    meetUrl: data.data?.meetingUrl ?? data.data?.location ?? "",
    calcomUid: data.data?.uid ?? "",
  };
}

const liveClient: CalcomClient = {
  getSlots: liveGetSlots,
  book: liveBook,
};

export function getCalcomClient(): CalcomClient {
  return integrationMode("CALCOM") === "live" ? liveClient : mockClient;
}
