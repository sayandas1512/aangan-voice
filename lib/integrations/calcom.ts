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
// live — Cal.com API v2. Endpoints per https://cal.com/docs/api-reference/v2
// (unverified against real docs until Phase 9 live smoke test — see
// DECISIONS.md).
// ---------------------------------------------------------------------------
const CALCOM_API_BASE = "https://api.cal.com/v2";

async function liveGetSlots(): Promise<Slot[]> {
  if (!env.CALCOM_API_KEY || !env.CALCOM_EVENT_TYPE_ID) {
    throw new Error("CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID are required in live mode.");
  }
  const now = new Date();
  const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const res = await fetch(
    `${CALCOM_API_BASE}/slots?eventTypeId=${env.CALCOM_EVENT_TYPE_ID}&startTime=${now.toISOString()}&endTime=${until.toISOString()}`,
    { headers: { Authorization: `Bearer ${env.CALCOM_API_KEY}` } }
  );
  if (!res.ok) {
    throw new Error(`Cal.com getSlots failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  interface RawSlot {
    time: string;
    attendees?: Array<{ name?: string }>;
  }
  const allSlots: Slot[] = (Object.values(data.data ?? {}) as RawSlot[][])
    .flat()
    .slice(0, 3)
    .map((s) => ({
      id: s.time,
      startIso: s.time,
      designerFirstName: s.attendees?.[0]?.name ?? "Studio Designer",
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
    },
    body: JSON.stringify({
      eventTypeId: Number(env.CALCOM_EVENT_TYPE_ID),
      start: input.slotId,
      attendee: { name: input.name, email: input.email, phoneNumber: input.phone, timeZone: env.TIMEZONE },
      location: { type: "integrations:google:meet" },
    }),
  });
  if (res.status === 409) {
    return { status: "slot_taken" };
  }
  if (!res.ok) {
    throw new Error(`Cal.com book failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return {
    status: "confirmed",
    startIso: data.data?.start ?? input.slotId,
    designer: data.data?.hosts?.[0]?.name ?? "Studio Designer",
    designerId: data.data?.hosts?.[0]?.id ?? "unknown",
    meetUrl: data.data?.location ?? "",
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
