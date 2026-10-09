import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

function id() {
  return uuid("id").primaryKey().defaultRandom();
}

function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

// ---------------------------------------------------------------------------
// designers
// ---------------------------------------------------------------------------
export const designers = pgTable("designers", {
  id: id(),
  name: text("name").notNull(),
  calcomHostId: text("calcom_host_id"),
  email: text("email"),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// calls — one row per phone call, kept whether the verdict is yes/maybe/no
// ---------------------------------------------------------------------------
export const callRouteEnum = ["forwarded", "after_hours"] as const;
export type CallRoute = (typeof callRouteEnum)[number];

export const callStatusEnum = [
  "in_progress",
  "completed",
  "missed",
  "dropped",
  "not_an_enquiry",
] as const;
export type CallStatus = (typeof callStatusEnum)[number];

export const calls = pgTable(
  "calls",
  {
    id: id(),
    vaaniCallId: text("vaani_call_id").notNull(),
    callerPhone: text("caller_phone").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    afterHours: boolean("after_hours").notNull().default(false),
    route: varchar("route", { length: 20 }).$type<CallRoute>(),
    status: varchar("status", { length: 20 }).$type<CallStatus>().notNull().default("in_progress"),
    transcript: text("transcript"),
    recordingUrl: text("recording_url"),
    humanFollowup: boolean("human_followup").notNull().default(false),
    rawPayload: jsonb("raw_payload"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("calls_vaani_call_id_idx").on(table.vaaniCallId),
    index("calls_caller_phone_idx").on(table.callerPhone),
    index("calls_started_at_idx").on(table.startedAt),
  ]
);

// ---------------------------------------------------------------------------
// answers — one row per qualifying-question field collected on a call
// ---------------------------------------------------------------------------
export const answers = pgTable(
  "answers",
  {
    id: id(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: text("value"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    unclear: boolean("unclear").notNull().default(false),
    ...timestamps(),
  },
  (table) => [index("answers_call_id_idx").on(table.callId)]
);

// ---------------------------------------------------------------------------
// classifications — the Gemini verdict for a call
// ---------------------------------------------------------------------------
export const verdictEnum = ["yes", "maybe", "no"] as const;
export type Verdict = (typeof verdictEnum)[number];

export const classifications = pgTable(
  "classifications",
  {
    id: id(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    verdict: varchar("verdict", { length: 10 }).$type<Verdict>().notNull(),
    reason: text("reason").notNull(),
    reasonCode: text("reason_code"),
    missingFields: jsonb("missing_fields").$type<string[]>(),
    model: text("model").notNull(),
    latencyMs: integer("latency_ms"),
    ...timestamps(),
  },
  (table) => [index("classifications_call_id_idx").on(table.callId)]
);

// ---------------------------------------------------------------------------
// bookings — the Cal.com booking tied to a call
// ---------------------------------------------------------------------------
export const bookingStatusEnum = ["confirmed", "cancelled", "rescheduled"] as const;
export type BookingStatus = (typeof bookingStatusEnum)[number];

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    calcomUid: text("calcom_uid"),
    designerId: uuid("designer_id").references(() => designers.id),
    startAt: timestamp("start_at", { withTimezone: true }),
    meetUrl: text("meet_url"),
    status: varchar("status", { length: 20 }).$type<BookingStatus>().notNull().default("confirmed"),
    ...timestamps(),
  },
  (table) => [index("bookings_call_id_idx").on(table.callId)]
);

// ---------------------------------------------------------------------------
// notifications — Telegram/email delivery of the designer note
// ---------------------------------------------------------------------------
export const notificationChannelEnum = ["email"] as const;
export type NotificationChannel = (typeof notificationChannelEnum)[number];

export const notificationStatusEnum = ["pending", "sent", "failed", "acknowledged"] as const;
export type NotificationStatus = (typeof notificationStatusEnum)[number];

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 10 }).$type<NotificationChannel>().notNull(),
    status: varchar("status", { length: 15 }).$type<NotificationStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    error: text("error"),
    ...timestamps(),
  },
  (table) => [index("notifications_call_id_idx").on(table.callId)]
);

// ---------------------------------------------------------------------------
// hubspot_sync — contact/deal sync state, yes/maybe calls only
// ---------------------------------------------------------------------------
export const hubspotSyncStatusEnum = ["pending", "synced", "failed"] as const;
export type HubspotSyncStatus = (typeof hubspotSyncStatusEnum)[number];

export const hubspotSync = pgTable(
  "hubspot_sync",
  {
    id: id(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    contactId: text("contact_id"),
    dealId: text("deal_id"),
    status: varchar("status", { length: 10 }).$type<HubspotSyncStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (table) => [index("hubspot_sync_call_id_idx").on(table.callId)]
);

// ---------------------------------------------------------------------------
// outcomes — designer-reported result of a booking
// ---------------------------------------------------------------------------
export const outcomeEnum = ["held", "no_show", "not_fit", "won"] as const;
export type Outcome = (typeof outcomeEnum)[number];

export const outcomes = pgTable(
  "outcomes",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    outcome: varchar("outcome", { length: 10 }).$type<Outcome>().notNull(),
    amountInr: numeric("amount_inr", { precision: 12, scale: 2 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outcomes_booking_id_idx").on(table.bookingId)]
);

// ---------------------------------------------------------------------------
// cost_events — per-call cost line items for the dashboard cost panel
// ---------------------------------------------------------------------------
export const costKindEnum = ["voice", "gemini", "other"] as const;
export type CostKind = (typeof costKindEnum)[number];

export const costEvents = pgTable(
  "cost_events",
  {
    id: id(),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 10 }).$type<CostKind>().notNull(),
    units: numeric("units", { precision: 14, scale: 4 }).notNull(),
    unitCostInr: numeric("unit_cost_inr", { precision: 10, scale: 4 }).notNull(),
    amountInr: numeric("amount_inr", { precision: 12, scale: 4 }).notNull(),
    ...timestamps(),
  },
  (table) => [index("cost_events_call_id_idx").on(table.callId)]
);

// ---------------------------------------------------------------------------
// jobs — retry queue (HubSpot sync, Resend fallback, etc.)
// ---------------------------------------------------------------------------
export const jobStatusEnum = ["pending", "running", "succeeded", "failed"] as const;
export type JobStatus = (typeof jobStatusEnum)[number];

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    status: varchar("status", { length: 10 }).$type<JobStatus>().notNull().default("pending"),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (table) => [
    index("jobs_run_at_idx").on(table.runAt),
    index("jobs_status_idx").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// events — guard violations, signature failures, retries, etc.
// ---------------------------------------------------------------------------
export const events = pgTable(
  "events",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("events_type_idx").on(table.type), index("events_at_idx").on(table.at)]
);
