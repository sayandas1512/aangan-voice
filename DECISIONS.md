# Decisions log

Running record of defaults chosen without a blocking question, and anything
that differs from the brief once real docs/APIs are consulted. Newest first.

## Phase 10 — Dashboard redesign, HubSpot backfill, public front door (2026-10-10)

**Design principle**: the old dashboard answered "what are the system's
metrics?" (six sections of identical tiles, raw `out_of_area` codes, phone
numbers instead of names). A studio founder's real questions are "who do I
need to call back today?" and "is this worth what it costs?" — so it's now
attention-first. References: Stripe's Dashboard (few hero numbers with
context), Linear/HubSpot task inboxes (the "needs attention" queue is the
first thing under the numbers), Pipedrive/HubSpot funnels, Front/Intercom
conversation view (facts + chat-style transcript), status pages (one health
strip instead of six operational tiles). Warm neutral palette with a single
clay accent, chosen for an interior-design studio; colour is reserved for
status so red/amber/green always mean something. No chart library — the
daily chart and funnel are plain CSS.

- **Everything is derived from one snapshot** (`loadSnapshot()` +
  pure functions in `lib/domain/dashboard-metrics.ts`) rather than SQL per
  tile, so rules like "what counts as needing attention" are unit-tested
  (`tests/dashboard-attention.test.ts`). Fine at founder scale; revisit if
  the call log reaches tens of thousands of rows.
- **Times were wrong, and nobody would have noticed**: the old pages called
  `toLocaleString("en-IN")` on the server, which runs in UTC on Vercel, so
  every time was 5½ hours off. All dashboard dates now render in the
  studio's timezone explicitly (`lib/domain/dashboard-format.ts`).
- **Next.js 16 Cache Components bit again**: with the password gate off,
  nothing marked the dashboard as request-time before `new Date()` was
  read, which fails prerender validation (it surfaced as a dev-overlay
  error; `next build` would have failed). Fixed with `await connection()`
  at the top of each dashboard page, alongside the existing
  `instant = false`.
- **Follow-ups clear themselves when they're resolved** instead of nagging
  forever: `human_followup` stays true as the historical fact, but a call
  leaves the to-do list when the founder clicks "Mark handled", its booking
  has an outcome logged, or the same number later got through on a
  completed call (a dropped line followed by a successful call-back).
  "Mark handled" needed one new nullable column,
  `calls.followup_resolved_at` (applied via the Neon migration flow after
  explicit approval; additive, no data touched).
- **Outcomes can now be logged from the dashboard**, not only from the
  emailed links, reusing `recordSimpleOutcome`/`recordWonOutcome` so HubSpot
  stage updates and idempotency behave identically. Server actions are
  public POST endpoints, so each one re-checks the dashboard session itself
  rather than trusting the page's redirect, validates ids as UUIDs, and only
  redirects to paths inside `/dashboard`.
- **Mobile**: tables become cards under 720px and the four headline numbers
  stay a 2×2 grid so the attention list isn't pushed off the first screen.
- **The site's front door was still the Next.js starter page** ("To get
  started, edit page.tsx") with the tab titled "Create Next App". `/` is now
  a short landing page with the two entry points (talk to the assistant /
  founder dashboard), and `/talk` was brought into the same visual system,
  with a suggested thing to say and a link to see what was captured.
- **Backfilled the 12 booked September enquiries into the real HubSpot**
  (`scripts/resync-hubspot-sept.ts`, idempotent — only touches rows still
  holding a `seed-deal-*` placeholder), through the same `attemptHubspotSync`
  the live pipeline uses, then mirrored each recorded outcome onto the
  deal's stage. Deliberately only those 12, not all 40 PDF records: the
  pipeline only ever creates a deal for a qualified, booked call, so
  pushing declined calls or the WhatsApp/web-form enquiries would create CRM
  records the real system would never have made. Caveats: HubSpot sets
  `createdate` itself, so these deals show today's date rather than their
  September call date; calls with no captured name became contacts named
  "Caller <last 5 digits>".
- **Not built, on purpose**: a weekly digest email, per-designer views,
  editing a classification, and Gemini token-cost tracking. Each is
  plausible, none is needed to run the studio day to day.

## Phase 9 (continued) — Live tool wiring confirmed, real integrations wired (2026-10-09/10)

Resolves the single biggest open risk from the previous section: **Vaani
does call our mid-call tool endpoints**, confirmed via Vercel function logs
during a live test, not by inference. Several real-API mismatches surfaced
along the way — each one found by testing against the actual deployed
endpoint or the actual third-party API directly (curl), not by reading
docs, since in every case here the docs/assumptions were wrong in some way.

- **Deployed to Vercel** (`aangan-voice-pied.vercel.app` alias) via the
  CLI. The retry cron (`vercel.json`) was `* * * * *` (every minute);
  Hobby-plan accounts only allow daily crons, so it's now `0 0 * * *` —
  the job it drives (HubSpot sync retries) already has its own
  exponential backoff, so once-daily is a fine floor, not a regression.
- **Vaani's custom-tool parameter extractor fills flat top-level fields
  from the conversation, not a nested object.** The `classify` tool was
  configured with dotted parameter names (`answers.propertyType` etc.,
  matching our endpoint's original nested `{ answers: {...} }` body) —
  live logs showed `classify` being called with `{"call_id":"1"}` only,
  across every attempt, zero of the seven dotted params ever populated.
  Fixed by flattening: `classify`/`book` now accept flat top-level answer
  fields (still backward-compatible with a nested `answers` object, since
  nothing stops a different caller from sending that shape), and the
  Vaani tool configs were updated to flat parameter names.
- **No caller-ID on a WebRTC call.** Real telephony gives you the caller's
  number for free; the WebRTC embed doesn't — `caller_phone` only exists
  if the caller says it out loud and the agent extracts it in time. Made
  `caller_phone` optional on `classify`/`book`, falling back to
  `"unknown"` (same convention `call-ended.ts` already used for its own
  webhook fallback) rather than hard-rejecting the call.
- **Parameters left optional in Vaani don't get collected.** Vaani appears
  to only make the agent actually pursue a parameter conversationally if
  it's marked Required — with everything optional, `classify` fired
  before any qualifying answers were gathered at all. Marked
  `propertyType`/`area`/`workType`/`timeline` Required on `classify` and
  `name` Required on `book` (budget/decisionMaker stay optional — matches
  the rubric's own "never probe" guidance).
- **Gemini key works, but `gemini-2.0-flash` (the brief's model) is
  retired** — the API's own 404 pointed at `gemini-3.8-flash`. That model
  defaults to extended "thinking" (~440 hidden tokens, 5-6s latency for a
  trivial classification — verified with a direct timed curl), blowing
  past `qualify.ts`'s 2.5s budget. Fixed with `thinkingConfig: {
  thinkingBudget: 0 }` (cuts it to ~2.4s) and raised the timeout to 6000ms
  for realistic network-variance headroom — the agent already says a
  filler line before calling classify (context-pack.md's Latency
  section), so a few seconds here is expected, not dead air.
- **Cal.com's real v2 API differs from what the original unverified
  implementation assumed, confirmed by curl against the live API**:
  endpoints are versioned via a `cal-api-version` header (not the URL) —
  getting it wrong is a generic 404 "Cannot GET", not a 400, which is
  exactly what the original code hit silently. Slots use `start`/`end`
  query params (not `startTime`/`endTime`) and return `{start: iso}` rows
  (not `{time: iso}` — the original field name was simply wrong). Fixed
  all three.
- **Cal.com hard-requires `attendee.email` and verifies the domain can
  receive mail** — an RFC 2606 `.invalid` placeholder (the "obviously
  safe" choice) was rejected outright with `email_domain_cannot_receive_mail`.
  Our own `book` tool treats a missing/invalid caller email as a soft
  fallback (phone-only + `human_followup`), not a failure, so this needed
  a real, receivable address rather than a dummy one. Falls back to a new
  `CALCOM_FALLBACK_EMAIL` env var (set to the studio's own inbox) only
  when the caller never gave one — the booking confirmation just lands
  with the studio instead of nowhere.
- **Found and fixed a real crash, not just a mismatch**: `liveBook` wrote
  Cal.com's own numeric host id (e.g. `3338149`) directly into
  `bookings.designer_id`, which is a UUID FK into *our* `designers`
  table, not Cal.com's id space — Postgres rejected the insert
  (`invalid input syntax for type uuid`). Fixed by resolving Cal.com's
  returned host id back to our internal designer via the `calcomHostId`
  column (already in the schema, already seeded as a placeholder for
  exactly this) rather than ever returning Cal.com's own id as if it were
  ours.
- **One real Cal.com member, not two** — the live Cal.com account has a
  single host (the founder's own account) on its one event type ("30 min
  meeting", reused rather than creating a new one). Both seeded designers
  (Asha/Rohan) now point `calcomHostId` at that same real host, so either
  internal label can be credited; a second real Cal.com team member can
  be added later without any code change.
- **All designer notification email routed to one real inbox** by request
  — both seeded designers' `email` column was pointed at the founder's
  own address for this phase, rather than fictitious `@aanganstudio.example`
  addresses that would bounce in live Resend mode.
- **Seeded the 20 real September 2026 phone enquiries** from the
  assignment's own PDF (`knowledge/transcripts/T01–T20.md`, verbatim) as
  historical `calls` rows via `scripts/seed-sept-enquiries.ts`, replaying
  the same side effects the real call-ended pipeline produces (answers,
  classification, booking, notification, HubSpot sync) with backdated
  timestamps. Deliberately did **not** seed the PDF's WhatsApp/web-form
  sections (W01-10, F01-10) — the schema is call-centric by design (the
  product is a voice AI for phone calls), and forcing other channels into
  `calls` rows would misrepresent them as calls that never happened.
- **Test-suite env isolation**: flipping `VAANI_MODE`/`GEMINI_MODE`/
  `RESEND_MODE`/`CALCOM_MODE` to `live` in `.env.local` (needed for the
  deployed app) broke several tests that assumed mock-mode defaults or
  would otherwise have hit real APIs on every local/CI run (real Cal.com
  bookings on the studio's actual calendar, real emails to a fake
  `@example.com`). Each affected suite now explicitly clears the relevant
  `*_MODE` var (and `vi.resetModules()`s before a dynamic re-import)
  before running, so it tests the mock path regardless of the ambient
  environment, and restores it in `afterAll`.

## Phase 9 (start) — Vaani live wiring, phone → WebRTC pivot (2026-10-09)

- **Found and fixed a clock-skew bug in Phase 8's own event-cleanup fix,
  the same day it shipped**: `tests/{price-guard,note,summary,call-ended}.test.ts`
  scope their `price_guard_violation`/call-ended event cleanup to a time
  window using this machine's `Date.now()`, but the `at` column is
  timestamped by **Neon's** server clock at insert time
  (`defaultNow()`). Any drift between the two clocks can put a real
  event's timestamp just outside the computed window, so it survives
  `afterAll`'s delete — caught by literally re-checking the `events` table
  after a clean test run and finding 2 rows that should've been deleted.
  Fixed by widening both bounds by 60s (`testRunStartedAt - 60s` /
  `now() + 60s` at cleanup time) instead of trying to use exact
  boundaries — cheap insurance against a class of bug that's easy to miss
  because it only sometimes leaves a trace.

**User-directed architecture change**, not a default: the brief's original
telephony design (a Twilio number, 15s forward-on-no-answer, after-hours
routing) is replaced with Vaani's browser-based WebRTC session. No phone
number, no Twilio, no telephony config at all — a caller instead opens a
web page and talks into their mic. The same `call.completed` webhook with
a transcript fires either way, so nothing downstream of the webhook
changes; only how the call begins does.

- **Real Vaani credentials received**: wallet funded (₹100), a real API
  key provided and stored in `.env.local` (gitignored, never committed).
- **`app/talk/page.tsx`** mounts Vaani's official drop-in embed widget
  (`window.VaaniVoice.textvoice(...)`, loaded from
  `vaanilabs.in/embed/v1/vaanivoice.js`) rather than hand-rolling the raw
  WebSocket audio protocol — their docs don't fully specify the
  client→server audio frame format (only server→client frames were
  documented), and no public npm SDK exists under any name I checked
  (`vaanivoice`, `@vaanilabs/voice`, `vaani-voice` all 404). The embed
  widget is Vaani's own supported integration path for exactly this case.
- **Security trade-off made explicitly, not silently**: Vaani's own docs
  warn that a key embedded in a public page is visible to anyone via
  view-source, and recommend minting a second key scoped tightly to
  `textvoice` with a capped per-minute budget for this use. Asked the
  user; they chose to reuse the one full-access key for simplicity given
  the small capped wallet. Recorded here so the trade-off is visible later,
  not rediscovered by surprise. `NEXT_PUBLIC_VAANI_API_KEY` carries the
  same value as the server-side `VAANI_API_KEY` deliberately — Next.js
  requires the literal `NEXT_PUBLIC_` prefix to inline a value into the
  client bundle, there's no way to alias it.
- **Could not visually verify the widget renders, from this tool's
  browser pane** — spent real effort chasing what looked like an infinite
  reload loop (thousands of buffered requests, repeated
  `ERR_CONNECTION_REFUSED`/`ERR_BLOCKED_BY_RESPONSE`), which turned out to
  be the pane's own cumulative session buffer from many hours of earlier
  testing, not a live bug — the dev server's own log showed exactly 3
  clean requests for the real test. The actual remaining symptom
  (`window.VaaniVoice` stays `undefined`, no network entry for
  `vaanivoice.js` ever appears) was then isolated with `curl`: the script
  URL is confirmed live, HTTP 200, valid JS, correct CSP/CORS headers
  (`access-control-allow-origin: *`) — so the script is fine and the
  failure is specific to this sandboxed preview pane silently restricting
  injected third-party cross-origin `<script src>` loads, not a bug in
  the shipped code. Left the dev server running at `localhost:3000/talk`
  so the user can verify directly in their own browser on the same
  machine. Added `onError`/missing-global handling to the page regardless,
  since surfacing a real load failure to a real user is good practice on
  its own merits.
- **All languages enabled** per explicit instruction — no code change
  needed on our side (Vaani-side flow/language config only); updated
  guidance given to the user for where in their dashboard this lives.
- **Flow-builder placement is best-effort, not verified**: gave the user a
  mapping from `agent/context-pack.md` sections to Vaani's documented
  dashboard sections (personality/voice settings, conversation flow
  builder, edge-case handling, language config) but explicitly flagged
  that an API key is not a login session — I cannot see their actual
  authenticated dashboard UI, so exact field names may differ from the
  mapping given. Asked them to report back what they actually see.
- **Still unresolved**: whether Vaani's flow builder can call out to our
  mid-call tool endpoints (classify/get_slots/book) during a live session
  — the single biggest open risk, now compounded by the channel change:
  even if mid-call tools work over phone/PSTN, it's not yet confirmed they
  work identically over the WebRTC/embed surface. To be confirmed once the
  user has a flow built and can test it.

## Phase 8 — Founder dashboard (2026-10-09)

- **Password gate built, but off by default** — a user-directed override of
  brief section 10's "simple password gate." This is an assignment
  submission, and the reviewer needs to open `/dashboard` directly with no
  login. Rather than deleting the auth work, added
  `DASHBOARD_REQUIRE_PASSWORD` (default `false`) gating
  `isDashboardAuthed()`; the login page, signed-cookie session
  (`lib/domain/dashboard-session.ts`), and rate-limited login route
  (`app/api/dashboard/login/route.ts`, 5 attempts / 15 min via the events
  table) are all fully functional and ready to flip on for a real
  deployment.
- **Metrics computed in JS after a small fetch, not raw SQL**: at this
  studio's real scale (~200 calls/month), pulling all rows for a metric
  and computing percentiles/aggregates in application code
  (`lib/domain/dashboard-metrics.ts`) is simpler and more testable than
  `percentile_cont` queries through the neon-http driver, whose raw-SQL
  `.execute()` return shape I hadn't verified. Would reconsider at a much
  higher call volume.
- **Gemini cost is honestly shown as untracked, not estimated**: nothing
  in the pipeline records Gemini token usage (`classifications` stores
  `latencyMs`, not tokens), so `GEMINI_COST_INR_PER_1K_TOKENS` has no real
  data to multiply against. The cost panel computes voice cost from real
  call `duration_sec` (this part is solid) and labels Gemini cost as not
  tracked, rather than inventing a number from an assumed average token
  count. Flagged as a gap, not silently zeroed.
- **Next.js 16 Cache Components bug, found via `npm run build`, not
  `dev`**: `export const dynamic = "force-dynamic"` (the Next ≤15 way to
  mark a route as always server-rendered) is rejected outright under
  `cacheComponents` — `next dev` never surfaced this, only `next build`
  did, as an explicit built-in error naming the exact fix. The real
  replacement is `export const instant = false`, confirmed by reading
  `node_modules/next/dist/docs/01-app/.../instant.md` rather than guessing
  from the error text alone (the error only said what to remove, not
  what — if anything — to add in its place).
- **Real accessibility/contrast bug caught by actually looking at it in
  the browser, not just curling it**: the login heading and body text were
  rendering near-invisible (light grey on white). Root cause:
  `app/globals.css` sets `body { color: var(--foreground) }`, which
  resolves to a near-white value under `prefers-color-scheme: dark`
  (this machine's browser was in dark mode); `.loginWrap` never set its
  own `color`, so it inherited the near-white value onto a white card.
  `.dashShell` had the override, `.loginWrap` didn't — simple omission.
  Also found the password input rendering with native dark-OS
  chrome (black background) because `globals.css` sets `color-scheme: dark`
  globally — added `color-scheme: light` to both dashboard containers so
  native form controls render light regardless of OS theme, since this
  dashboard doesn't have its own dark mode. Neither bug was visible from
  `curl`; both only showed up once the page was actually opened and looked
  at — reinforces "test it in a browser," not just "the route returns 200."
- **Found and fixed a real test-hygiene gap while smoke-testing**: the
  dashboard's own "Price guard hits" tile read 75 — `tests/price-guard.test.ts`,
  `tests/note.test.ts`, and `tests/summary.test.ts` each deliberately
  trigger a real `price_guard_violation` row in the shared production
  `events` table to test the guard's fallback path, and none of them had
  ever cleaned it up (unlike the `calls`/`designers` self-cleaning pattern
  established since Phase 3). Same gap existed for
  `tests/call-ended.test.ts`'s `classification_missing_at_call_end`
  events. All four files now delete their own event rows in `afterAll`,
  scoped by exact `type` match + the test run's time window (not a blanket
  time-window delete, since parallel test files can log events in the same
  second). Deleted the 75+11+1 stray rows that had accumulated across this
  session's many manual test runs and CI runs.
- **Kept the dashboard's demo data on request**: generated 4 real calls
  through the live mock pipeline while smoke-testing (3 yes/1 no, 3
  bookings, 1 held, 1 won ₹10,50,000) so every panel has something to show
  instead of an all-zero empty state. Asked before keeping vs. clearing it
  — user chose to keep it; cleaned up the `+smoke`-tagged designer email
  addresses used during testing to plausible-looking placeholders instead.
- **Verified with a real browser smoke test**, not just the build: logged
  in (both with and without the password gate), viewed the dashboard with
  real seeded data (every tile showing correct computed numbers, cross-
  checked against what was actually seeded), opened a "no" call's detail
  page and a "won" call's detail page, and checked the mobile viewport
  (375px) — cards reflow to a 2-column grid, nothing overflows.
- **Known gap, not blocking**: there's no automated test exercising the
  real HTTP webhook route (`app/api/vaani/webhook/call-ended/route.ts`)
  end to end — `verifyHmacSignature` is unit-tested and `processCallEnded`
  is integration-tested, but the two aren't tested wired together through
  the actual route handler. Worth adding before live Vaani rollout
  (Phase 9), not before.

## CI-only test timeout, found after the Phase 7 push (2026-10-09)

The Phase 7 push went green locally (97/97, every DB-backed test under
~2.5s) but failed CI: `tests/call-ended.test.ts`'s two heaviest tests hit
vitest's default 5000ms timeout there specifically. Not a code bug —
GitHub Actions' network path to Neon is evidently slower than this
machine's, and those two tests make several sequential real round trips
(classify → slots → book → processCallEnded's own handful of queries) that
added up past 5s only under CI's latency. Fixed by setting
`testTimeout: 20000` globally in `vitest.config.ts` rather than special-
casing those two tests — other integration tests could hit the same wall
under slightly worse network conditions. Confirmed the DB was still clean
(0 calls, 0 designer emails) after the failed CI run — its `afterAll`
hooks never got to run once vitest killed the timed-out tests, so this was
worth checking by hand rather than assuming the push's local cleanup
guarantees still held.

## Phase 7 — Telegram → email pivot, designer outcome actions (2026-10-09)

**User-directed architecture change**, not a default I chose: mid-build on
what was originally planned as "Phase 7: Telegram bot webhook," the user
asked to replace Telegram entirely with Resend/email as the designer
handoff channel, with outcome actions as clickable links rather than
Telegram's inline buttons, and a tiny web form for "Won" since a link
can't collect free-text input. Confirmed both decisions before building
(full Telegram removal, not just "default to email but keep the code").

- **Telegram fully removed**: deleted `lib/integrations/telegram.ts`
  entirely; no `/start` registration flow or bot webhook was ever built
  (the plan to build `app/api/telegram/webhook` was abandoned before any
  code existed for it, so there was nothing to delete there). Removed
  `TELEGRAM_MODE`/`TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` from
  `lib/env.ts` and `.env.example`, and `designers.telegram_chat_id` from
  the schema (two-step migration — see below).
- **Resend promoted from "optional fallback" to the only channel**:
  removed `ENABLE_RESEND_FALLBACK` entirely (it no longer means anything —
  there's nothing left for email to be a fallback *to*). `RESEND_API_KEY`/
  `RESEND_FROM` stay optional in the schema (mock mode needs neither) but
  are effectively required once `INTEGRATIONS_MODE`/`RESEND_MODE` is live.
- **Outcome actions are stateless signed links, not a stored
  conversation**: an earlier version of this phase (before the pivot) had
  already built and *applied* a `pending_prompts` table for a Telegram
  "what was the amount?" follow-up message — tracking per-chat
  conversational state, since Vercel functions are stateless between
  requests. The email+link design doesn't need that: each of the 5 links
  (`lib/domain/action-link.ts`) carries `{callId, bookingId, action}` as an
  HMAC-signed, expiring token (`ACTION_LINK_SECRET`, 30-day TTL,
  constant-time verification) — the state lives in the link itself, not in
  a database row. The `pending_prompts` table was dropped again in the
  same phase it was added, via a second migration
  (`0003_gigantic_dagger.sql`) — a real example of a design explored,
  built, proven premature, and cleanly reverted rather than left as dead
  code once the requirements changed mid-phase.
- **Schema migrations needed two steps to avoid drizzle-kit's
  rename-ambiguity prompt**: dropping `telegram_chat_id` and adding
  `email` on the same table in one `drizzle-kit generate` made it try to
  interactively ask "is this a rename?" (text→text, same table) — which
  fails outright in a non-TTY shell (`Interactive prompts require a TTY
  terminal`). Split into two migrations (`0003`: add `email` +
  drop `pending_prompts`; `0004`: drop `telegram_chat_id` only) so neither
  diff was ambiguous. Both applied via the usual prepare/test-on-temp-
  branch/apply Neon flow.
- **"Won" needs a form, not a link, so it's two routes in one**:
  `GET /api/notifications/action?token=...` records the outcome directly
  for acknowledge/held/no_show/not_fit, but for `won` it renders a minimal
  HTML page with an amount input that `POST`s back to the same path
  (reusing the same token, re-verified server-side — the token proves
  *which* booking, the form only supplies the number). No client JS, no
  new dependency — plain HTML forms submit natively.
- **Outcome recording is idempotent by outcome type**
  (`lib/domain/outcome-action.ts`): clicking "Held" twice (a reloaded
  confirmation page, a doubly-delivered email open) checks existing
  `outcomes` rows for that booking+type before inserting again. A
  genuinely different later outcome (e.g. "won" after an earlier "held")
  is still allowed to add a second row — outcomes are treated as a
  timeline, not a single mutable status.
- **HubSpot outcome updates reuse the Phase 6 retry-queue machinery**:
  added `attemptHubspotOutcomeUpdate` alongside `attemptHubspotSync`
  (same never-throws-failure-is-recorded-and-returned shape) and a second
  job type, `hubspot_outcome_update`, handled by the same
  `/api/cron/retry` worker — refactored into a small per-job-type handler
  map instead of duplicating the due-jobs loop. Caught a real bug while
  doing this refactor: the first draft of the generic handler hardcoded
  `attempt = 1` for every job type instead of threading through the
  computed retry attempt number, which would have broken `hubspot_sync`'s
  backoff/exhaustion tracking on every retry past the first. Fixed before
  it shipped.
- **Verified with 97 passing tests** (11 new: `action-link.test.ts`,
  `api-notifications-action.test.ts`, plus updates across
  `call-ended.test.ts`/`note.test.ts`/`env.test.ts` for the channel
  switch), a production build, and direct inspection of a real generated
  email (via the test suite's console output) confirming the five signed
  links round-trip correctly end to end. One genuine test-writing mistake
  caught and fixed along the way: an assertion expected `"950,000"` but
  `toLocaleString("en-IN")` correctly groups by lakh (`"9,50,000"`) — the
  test was wrong, not the code.
- **Two Neon write mishaps from an unrelated transient DNS failure,
  found and fixed**: a mid-run network outage (`getaddrinfo ENOTFOUND
  api.c-4.ap-southeast-1.aws.neon.tech`) killed a test run before its
  cleanup hooks could run, leaving 4 stale `calls` rows and 2 designers
  with leftover test email addresses in `production`. Both found by
  checking actual DB state after the suite reported green, not assumed
  clean — deleted/reset by hand (same user-approved `test-%` pattern as
  prior phases) and reverified at zero / `email IS NULL`.

## Phase 6 — Call-ended pipeline, retry queue, cron (2026-10-09)

- **`app/api/vaani/webhook/call-ended/route.ts`** receives Vaani's real,
  confirmed webhook envelope (`{id, type, created, data}`,
  `X-VaaniVoice-Signature: sha256=…`) rather than a guessed shape. `data`'s
  own fields are "not guaranteed" per Vaani's docs, so the route tries
  several plausible key names (`call_id`/`vaani_call_id`/`callId`, etc.)
  for each field instead of requiring one exact name — genuinely unverified
  until a real delivery arrives, flagged rather than hidden.
- **Two-layer idempotency, matching brief section 7 exactly**: delivery-id
  dedup first (`vaaniDeliveryIdempotencyKey`, catching Vaani's own retries
  of the *same* delivery — confirmed they reuse the `evt_…` id up to 8
  times) via a cheap exact-match on `events.type` reusing its existing
  index; call-id dedup second (`calls.status !== "in_progress"` means
  already processed). A call already marked complete is never
  re-processed — prevents double-sending Telegram/HubSpot on a retried
  webhook.
- **Found two real gaps while wiring this together, both fixed**:
  1. The designer note (`lib/domain/note.ts`, Phase 4) needs the caller's
     name and email, and nothing persisted them after the `book` tool call
     — `bookings` only has Cal.com-side columns per the brief's own
     schema. Fixed by having `book`'s route also write `name`/`email` as
     `answers` rows (reusing the table that already exists for "whatever
     the call collected" rather than adding new columns).
  2. `classify`'s `missingFields` (used for the note's "Open questions"
     line) was computed but never stored — `classifications` had no column
     for it. Added one (`missing_fields` jsonb, migration
     `0001_burly_changeling.sql`, applied via the same prepare/test/apply
     Neon flow as Phase 2) rather than re-deriving an approximation from
     the answers table at call-end time, which would drift from what
     classify actually returned.
- **`listDueJobs` had a real bug fixed before it was ever exercised**: the
  Phase 2 version filtered only on `status = 'pending'`, with no `runAt`
  check — a job scheduled an hour out would have been picked up by the
  very next cron tick. Added `AND runAt <= now()`.
- **Resend fallback is wired for the decision point but not the send**:
  `ENABLE_RESEND_FALLBACK` is checked, but actually sending requires a
  designer email, which isn't in the brief's own `designers` schema
  (`id, name, calcom_host_id, telegram_chat_id, active` — no email). Rather
  than add a column the brief didn't ask for, a Telegram-send failure with
  the flag on logs `resend_fallback_skipped_no_designer_email` instead of
  silently doing nothing — surfaces the gap the moment anyone flips the
  flag on, rather than hiding it. The brief's other Resend trigger ("no
  designer acknowledgement within the escalation window") is **not
  implemented this phase** — it needs a separate scheduled check
  (notifications where `sent_at` is old and `acknowledged_at` is still
  null), which belongs with Phase 7's Telegram acknowledgement buttons,
  not here.
- **Exponential backoff**: 1/2/4/8/16/32 minutes (`lib/domain/retry.ts`),
  capped at 60, giving up after `MAX_RETRY_ATTEMPTS = 6` (≈1 hour of
  retrying). Arbitrary but reasonable defaults — not specified in the
  brief; revisit once real HubSpot outage patterns are known.
- **HubSpot failure never blocks Telegram, verified structurally and by
  test**: in `processCallEnded`, the Telegram send is fully awaited and
  resolved (success or logged failure) *before* the HubSpot attempt even
  starts — not run in parallel with a shared error boundary, which could
  let a slow/hung HubSpot call delay the function's return and thus the
  webhook's response to Vaani. `tests/call-ended.test.ts`'s "yes verdict"
  test asserts both the notification and the hubspot_sync row land
  correctly in one pipeline run.
- **Verified three ways**: 86 passing vitest tests (including a dedicated
  `attemptHubspotSync` failure/backoff/exhaustion suite using a stub
  HubSpot client, since the mock client always succeeds and can't exercise
  that path on its own); a real HTTP smoke test (classify → slots → book →
  call-ended → call-ended again → cron retry) against the dev server, with
  the resulting Neon rows inspected directly — correctly showed
  `human_followup: true` because the seeded placeholder designers still
  have no Telegram chat id, exactly as expected; and `npm run build`.
  Asked before deleting the 1 test row this left in `production`, same
  pattern as before.

## Phase 5 — Mid-call endpoints (2026-10-09)

- **Four routes added**: `app/api/vaani/tools/{classify,slots,book}/route.ts`
  and `app/api/vaani/pre-call/route.ts`. Each: zod-validates the body (400
  on failure, never a 500 from bad input), writes to Neon before any slow
  side effect, and is idempotent where it matters.
- **`classify` and `slots` both reuse their Phase 4 domain wrappers**
  (`lib/domain/qualify.ts`, new `lib/domain/slots.ts`) for the 2.5s-timeout
  /no-dead-air behavior — the route handlers themselves don't duplicate
  that logic, they just persist the result and flag `human_followup` on
  timeout.
- **Call rows are created lazily, mid-call, not by the webhook.** Added
  `findOrCreateCallByVaaniId` (`lib/db/queries.ts`) using
  `onConflictDoNothing` on the unique `vaani_call_id` index, since
  `classify`/`book` may be the first time a given call is ever seen — the
  call-ended webhook (Phase 6) will update this same row, not create a
  second one.
- **`book` is idempotent against the DB, not just in-memory**: a second
  `book` call for a `call_id` that already has a confirmed booking returns
  the existing booking instead of calling Cal.com again. Verified with a
  real test (`tests/api-vaani-tools.test.ts`) that books twice with two
  *different* slot ids for the same call and asserts the second response's
  `meet_url` matches the first — proving it short-circuited rather than
  booking the second slot too.
- **Email handling matches brief section 7 exactly**: a missing or
  malformed email doesn't fail the booking — it proceeds phone-only and
  flags `human_followup`. Validated with a plain regex rather than
  `zod`'s `.email()`, to sidestep any zod-v4 format-validator
  version churn and keep the check trivially testable in isolation.
- **Tool-call auth is a placeholder, clearly marked as such**
  (`lib/api/vaani-tool-auth.ts`): a constant-time shared-secret header
  check against `VAANI_WEBHOOK_SECRET`, skipped entirely in mock mode. This
  is **not** the confirmed webhook HMAC scheme from the earlier Vaani docs
  review — that's for Vaani's registered async webhooks
  (`call.completed` etc.), a different mechanism from whatever the flow
  builder uses to call *our* tool endpoints mid-call, which is still
  unconfirmed. Denies-by-default if live mode has no secret configured
  (tested) rather than silently allowing unauthenticated requests.
- **Verified with a real HTTP smoke test, not just vitest**: started the
  dev server and curled the full classify → slots → book → book-again →
  pre-call chain, then confirmed the resulting rows directly in Neon via
  `run_sql` (verdict, booking status, meet URL all correct). Asked before
  deleting the 5 test rows this left in `production`, per the destructive-
  SQL rule — user confirmed, rows deleted, verified back to 0.
- **`tests/api-vaani-tools.test.ts` is self-cleaning**: it writes real
  `calls` rows to the shared `production` Neon branch (same tradeoff as
  Phase 3's `calcom.test.ts`), and this suite now runs on every CI push too
  (Phase "Repo/CI wiring"). Without cleanup, every `npm test` — local or
  CI — would permanently add 4 `test-*` rows to production forever. Added
  an `afterAll` that deletes exactly the `call_id`s this file itself
  created, tracked via a `testCallId()` helper. Briefly suspected this
  wasn't working (4 rows survived a full `npm test` run) — turned out those
  were orphans from the *first* run, before the cleanup code existed;
  every run since correctly nets to zero, confirmed by checking row UUIDs
  matched the stale run, not the latest one, and by rerunning with
  temporary debug logging before removing it. Deleted the stale orphans
  once by hand (same user-approved `test-%` deletion as above).
- **`pre-call` built per brief section 6's optional pre-call hook**, kept
  deliberately minimal (just "is this a returning caller + when") since
  whether Vaani even calls it is unconfirmed — ready to extend once that's
  known, not speculatively built out further now.

## Bug found: .env.example was never actually committed (2026-10-09)

Phase 1's `.gitignore` used `.env*` to keep real secrets out of git — but
that glob also matched `.env.example`, which the brief explicitly lists as
a committed file (section 5 repo layout, section 11 contents) and which
`README.md`'s own setup instructions tell the reader to `cp .env.example
.env.local`. It silently existed on disk through every phase so `cp` kept
working locally, but was never once in any commit — `git ls-files` only
showed `.env.local` as the untracked, correctly-ignored real-secrets file.
Nobody writing or reviewing `.gitignore` entries caught that the glob was
too broad in the other direction. Fixed with `!.env.example` after the
`.env*` line; confirmed with `git check-ignore` before and after, and
`git ls-files` after committing to verify it actually landed this time.

## Vaani Labs real docs reviewed (2026-10-09)

Browsed vaanilabs.in and its public docs directly (not just search
snippets) to replace guesses with sourced facts. Updates [ASK] item 1 from
"fully unconfirmed" to "partially confirmed" — see below for what's still
open.

- **Confirmed: this is the right Vaani Labs.** Mumbai-based (BKC), built
  specifically for Indian businesses, phone/WhatsApp/browser voice agents,
  explicit lending/healthcare/real-estate/D2C use cases, a Pune dental
  group testimonial. Matches the brief's description exactly.
- **Languages — confirmed, and broader than the brief assumed.** The
  platform supports 40+ languages and accents platform-wide (landing page:
  "Hindi, English, Tamil and 40+ more — switching naturally, whatever the
  caller uses"). This is **not a per-project limit** — which languages are
  *active* for this studio's agent is a dashboard/flow-builder config
  choice, not a code constraint. Updated `agent/context-pack.md` to default
  to **English, Hindi, Marathi** (Marathi added because this studio is in
  Pune/Maharashtra — a caller defaulting to Marathi is a realistic case the
  brief's own English/Hindi-only framing missed) and documented that more
  of the 40+ can be enabled on request — tracked as [ASK] item 4, not
  blocking.
- **Confirmed: webhook signature scheme**, from
  `vaanilabs.in/docs/api/webhooks`. Real shape, which my Phase 4
  implementation had guessed wrong:
  - Header is `X-VaaniVoice-Signature: sha256=<hex>` — **the `sha256=`
    prefix is part of the literal header value**, not a separate field.
    `lib/integrations/vaani.ts`'s `verifyHmacSignature` originally compared
    the bare hex digest against the header and would have silently failed
    every real verification. Fixed to prepend `sha256=` before comparing.
  - Webhook secret format is `vv_whk_…`, shown once at creation time via a
    dashboard-session-authenticated `POST /api/webhooks` call (not the
    public `vv_live_…` API key).
  - Event catalog includes `call.completed` and `call.failed` (not
    `call-ended` as our folder name `app/api/vaani/webhook/call-ended/`
    assumed — keeping that as our route's name is fine, it's our path, not
    theirs, but the code must match on the real event `type` field).
  - Retries use the same envelope `id` (`evt_…`); the brief's dedup
    requirement maps directly onto this. Added
    `vaaniDeliveryIdempotencyKey()` to `lib/domain/idempotency.ts`
    alongside the existing call-id and phone-window keys — check delivery
    id first (catches literal retries), then call id (catches Vaani
    re-sending the same call under a new delivery).
- **Confirmed: a real per-minute voice rate exists**, resolving [ASK] item
  6 with a sourced default rather than leaving it at 0.
  `vaanilabs.in/docs/api/billing`: textvoice/voicebot bills 4 paise/sec,
  rounded up to whole billable minutes = **₹2.40/min**. Set as the new
  `VOICE_COST_INR_PER_MIN` default in `.env.example`/`.env.local`. Caveat
  recorded in the env comment: this is Vaani's own session rate: if the
  phone number is a "bring your own Twilio" setup (the quickstart
  mentions "Configure your Twilio number"), Twilio's separate per-minute
  PSTN charge would stack on top — unconfirmed whether this studio's
  number will be Vaani-provided or BYO Twilio.
- **Still unconfirmed: mid-call tool calling** (the actual biggest risk,
  [ASK] item 1). The public WebSocket frame protocol
  (`vaanilabs.in/docs/api/textvoice`) only documents
  `transcript_partial`/`transcript_final`/`agent_speech`/audio/`end` frames
  server→client — no tool-call or function-call frame type is shown. The
  conversation branching logic (`flow_id`, built in a dashboard "visual
  flow builder" per the marketing copy) is where mid-call external calls
  would plausibly be configured, but inspecting it needs an actual account
  ("Create an account and get approved" is the first quickstart step) — not
  something reachable from public docs alone. **Still building against the
  assumption that it works**, per the original reasoning (harder path,
  more complete if true), but this is no longer a blind guess — it's an
  identified gap with a concrete next step: sign up for an account and
  check the flow builder before Phase 9's live Vaani wiring.

## Phase 4 — Domain logic (2026-10-09)

- **Six domain modules** in `lib/domain/`: `price-guard.ts`, `qualify.ts`,
  `summary.ts`, `note.ts`, `cost.ts`, `after-hours.ts`, `idempotency.ts`
  (seven, counting both) — matching brief section 12's explicit unit-test
  list ("price guard, classification parsing, note builder, cost maths,
  idempotency keys, timezone and after-hours logic") one-for-one.
- **`qualify.ts` made testable via dependency injection**: added an
  optional `client` override so tests can inject a deliberately slow fake
  Gemini client and actually exercise the 2.5s-timeout fallback path.
  First attempt tried forcing it with `timeoutMs: 0`, which doesn't work —
  Node's event loop always drains microtasks (the already-resolved mock
  classify promise) before firing even a 0ms `setTimeout` macrotask, so the
  timeout branch was silently never hit. Caught by the test failing, not
  by inspection.
- **Price guard is deliberately over-broad**: "rate" and "per sq" alone are
  blocked even in sentences with nothing to do with pricing (documented and
  tested in `tests/price-guard.test.ts`) — a false positive just means a
  safe fallback string ships instead of the generated one; a false negative
  means a price reaches a caller. Includes Hindi-transliterated terms
  (sasta/mehenga/keemat/daam) alongside English, per brief section 7.
- **Live Gemini prompt now embeds real rubric content, not filenames**: the
  first cut of `buildClassifyPrompt()` just told Gemini "use the rubric in
  knowledge/qualified.md" — which does nothing, since Gemini has no
  filesystem access. Added `lib/domain/knowledge.ts`
  (`loadQualifiedRubric`/`loadServicesScope`) and now inline the real file
  contents into every live classify call, loaded fresh each time (no
  redeploy needed when the rubric changes). Deliberately **no
  `loadPricing()` export exists** in that module — not just unused, not
  present at all, so there's no code path that could accidentally wire it
  in later.
- **`/agent` files authored**: `context-pack.md` (Vaani agent config, per
  section 6 — identity, opening line, the 7 questions, latency handling,
  situation handling, tool contract), `gemini-classify.prompt.md` and
  `gemini-summary.prompt.md` (documentation copies of the prompts actually
  assembled in `lib/integrations/gemini.ts`, since Gemini prompts are code,
  not static files — these exist for reviewability and to match the
  brief's repo layout, and must be kept in sync by hand if the real prompt
  logic changes).
- **Cost maths (`cost.ts`) is pure, dashboard not built yet**: functions
  take rates/counts as plain arguments rather than reading `env` directly,
  so they're trivially unit-testable and the Phase 8 dashboard can call
  them with whatever period/aggregation it needs. `estimatedPipelineValue`
  and `actualWonValue` are kept as separate functions on purpose — brief
  section 10 is explicit that estimate and actual must never be combined
  into one number.

## Repo/CI wiring (2026-10-09)

- **Bug found and fixed via CI, not locally**: `npm run typecheck` passed
  on this machine but failed on a clean CI checkout with
  `Cannot find name 'LayoutProps'` in `app/layout.tsx`. Next.js 16's typed
  routes generate `LayoutProps`/`PageProps`/etc. into `.next/types/` during
  `next dev`, `next build`, or `next typegen` — locally that had already
  run from earlier `npm run dev`/`build` calls, so `tsc --noEmit` alone
  worked; a fresh clone has no `.next/` at all (correctly gitignored) and
  nothing had generated those types first. Fixed by changing `typecheck` to
  `next typegen && tsc --noEmit`, verified by deleting `.next` locally and
  re-running. This is the kind of gap only a genuinely clean environment
  (CI) catches — worth remembering before claiming "typecheck passes" means
  anything beyond "passes on a machine with build artifacts already present."
- **GitHub repo created**: private repo `sayandas1512/aangan-voice`, `main`
  pushed, confirmed with the user before pushing (and before authorizing
  the `workflow` OAuth scope needed to push `.github/workflows/ci.yml`).
- **CI DB gap closed**: added `DATABASE_URL` as a GitHub Actions repo
  secret (same Neon `production` connection string from `.env.local`) and
  wired it into the `npm test` step's `env:` in `ci.yml`. The
  `describe.skip`-when-unset guard in `tests/calcom.test.ts` (Phase 3) now
  actually runs in CI instead of always skipping. Safe to point CI at
  `production` directly because the only DB-touching test path
  (`listActiveDesigners`) is read-only — the Cal.com mock's
  book()/getSlots() never write to Neon, only to an in-memory map. Revisit
  if a future test starts writing to the DB; a separate Neon branch for CI
  would be the right move at that point, not reusing production.
- **Full health check before resuming Phase 4**: confirmed `npm run build`
  (production Next.js build) succeeds — this had not been checked since
  scaffolding, only `dev`/`typecheck`/`lint`/`test`. All green: build,
  typecheck, lint, test (12/12), `npm run simulate-call` (0 mismatches).

## Phase 3 — Integration interfaces, mocks, simulate-call (2026-10-09)

- **Six integration modules** in `lib/integrations/` (`gemini.ts`,
  `calcom.ts`, `telegram.ts`, `hubspot.ts`, `resend.ts`, `vaani.ts`), each
  exporting a typed client interface plus a `mock`/`live` implementation
  selected by `integrationMode()` from `lib/env.ts`. No service-specific
  code anywhere else in the app talks to these APIs directly.
- **`vaani.ts` is intentionally thin**: Vaani calls *us* (mid-call tool
  endpoints, call-ended webhook) rather than the other way around, so there
  is no general outbound "client" the way there is for the other five. This
  module only covers HMAC webhook-signature verification and a
  `pushAgentConfig` stub that **throws in live mode** — the real Vaani
  agent-config API shape is unconfirmed (still [ASK] item 1), so guessing
  at it felt worse than failing loudly with a pointer to paste
  `agent/context-pack.md` into the Vaani dashboard manually until Phase 9.
- **Gemini mock classify is a deliberate approximation**, not the real
  rubric: a small rule-based heuristic (service-area list, 6-week minimum
  lead time, advisory-only keyword match, a crude lakh-threshold budget
  check) that mirrors `knowledge/qualified.md`'s five criteria closely
  enough to produce plausible, testable verdicts with no API key. The real
  rubric text only goes to the live Gemini call (`buildClassifyPrompt`);
  Phase 4's `agent/gemini-classify.prompt.md` is the authoritative version.
  Do not tighten the mock heuristic to match edge cases in the brief's
  remaining 15 transcripts — it only needs to stay plausible, not correct,
  since live mode is what actually matters.
- **Cal.com live client built against the documented v2 shape** (`/v2/slots`,
  `/v2/bookings`, Google Meet location type) without having fetched Cal.com's
  actual docs yet — flagged here so Phase 9's live smoke test knows to
  verify request/response shapes before trusting this, not just the API key.
- **Bug found and fixed**: the Cal.com mock's first cut encoded the slot's
  ISO timestamp directly into the slot id string and tried to regex it back
  out in `book()`. Since an ISO timestamp itself contains hyphens
  (`2026-10-12T05:30:00.000Z`), the regex silently matched the wrong thing
  and `book()` returned the *current* time instead of the slot's start
  time. Fixed by keeping a `slotId -> {startIso, designerId}` map populated
  by `getSlots()` instead of parsing the id. Caught by running
  `scripts/simulate-call.ts` against real fixtures, not by typecheck/lint
  — a reminder that integration mocks need to actually be exercised, not
  just compiled.
- **`scripts/simulate-call.ts`** replays 5 hand-picked fixtures (from
  `tests/fixtures/calls.ts`, derived from real `knowledge/transcripts/`
  calls: T01 yes, T03 out-of-area, T04 advisory-only, T07 rushed timeline,
  T10 budget mismatch) through classify + getSlots in parallel, then
  book/telegram/hubspot for yes/maybe. **Scope note**: this calls the
  integration clients directly, not the Next.js API routes — those
  (`app/api/vaani/tools/*`, `app/api/vaani/webhook/call-ended`) don't exist
  until Phases 5–6. Once they do, extend or parallel this script to POST to
  them instead, per brief section 12's actual wording ("replays a
  transcript through the tool endpoints").
- **Test coverage added early**: `tests/gemini.test.ts` and
  `tests/calcom.test.ts` run the same 5 fixtures and the slot_taken path
  through vitest, not just the manual script. `tests/calcom.test.ts` needs
  a real `DATABASE_URL` (it calls `listActiveDesigners()`), which
  `vitest.config.ts` now loads from `.env.local` via a small hand-rolled
  parser (no `dotenv` dependency added — logged here per the "no deps
  beyond the stack without recording why" rule, though strictly this just
  avoids adding one, not the reverse). CI has no DB secret configured, so
  these tests use `describe.skip` when `DATABASE_URL` is unset rather than
  fail the pipeline — tracked as a gap: CI currently can't catch a
  regression in the DB-touching integration tests. Revisit once a CI-scoped
  Neon branch or secret is set up.

## Phase 2 — Database (2026-10-09)

- **Neon project reachable**: `empty-meadow-33722721` (name `aangan-voice`,
  region `aws-ap-southeast-1`) exists and is accessible via the Neon MCP
  tools, with a `production` branch (`br-hidden-frog-b3gdb4c7`) already set
  as default — matches the brief's section 11 note exactly.
- **Schema**: all 11 tables from brief section 9 implemented in
  `lib/db/schema.ts` (Drizzle), covering `designers`, `calls`, `answers`,
  `classifications`, `bookings`, `notifications`, `hubspot_sync`,
  `outcomes`, `cost_events`, `jobs`, `events`. UUID primary keys
  (`gen_random_uuid()`), `created_at` timestamptz on every table, indexes
  on `vaani_call_id` (unique), `caller_phone`, `started_at` per the brief,
  plus FK cascades from child tables back to `calls`/`bookings` so a call
  can be deleted cleanly in dev/test without orphaning rows.
- **Migration applied to `production`** via the Neon MCP
  prepare/test/complete flow (tested on a temp branch first, verified all
  11 tables landed, then applied) — not run blind. Migration file:
  `lib/db/migrations/0000_aberrant_surge.sql`.
- **Drizzle config split**: `drizzle.config.ts` (real config: schema path,
  migrations dir, postgres dialect, `DATABASE_URL` credential) is separate
  from `neon.ts`, which stays exactly `defineConfig({})` as the brief
  requires. `neon.ts` is excluded from `tsc --noEmit` in `tsconfig.json`
  since an empty config object doesn't satisfy drizzle-kit's `Config` type
  — that's expected, since the brief says not to change the file's content.
- **Env bug found and fixed**: `lib/env.ts`'s per-service `*_MODE` fields
  (`z.enum([...]).optional()`) rejected `.env.local`'s own
  `.env.example`-derived convention of shipping unset overrides as
  `VAANI_MODE=` (present, empty string) rather than omitted entirely —
  zod's `.optional()` only accepts `undefined`, not `""`. Fixed by
  stripping empty-string env vars before `safeParse` in `loadEnv()`, with
  a regression test in `tests/env.test.ts` asserting the schema rejects
  `""` directly (documenting why the strip step exists).
- **`.env.local`** created locally (gitignored) with the real Neon
  `DATABASE_URL` from `get_connection_string`. Not committed; `DATABASE_URL`
  value must be quoted in `.env.local` because of the `&` in the query
  string — noted here since it broke a naive `source .env.local` the first
  time.
- **Seeded 2 placeholder designers** (`Asha`, `Rohan`, placeholder
  `calcom_host_id`s, no Telegram chat ID yet) via `npm run seed` against
  the live `production` branch, confirmed with a direct `run_sql` read —
  verifies schema, client, and queries all work end-to-end against real
  Neon, not just typecheck. Replace with real designers once given
  (DECISIONS.md "Open [ASK] items", item 7).

## Ground truth received (2026-10-09)

Real `knowledge/qualified.md`, `knowledge/services.md`, and a transcript
drop (`Aangan_Sep 2026_Enquiries.pdf`) were supplied and have replaced the
Phase 1 placeholders.

- **`qualified.md`**: real rubric from Nikhil. Five criteria (real project
  vs advice-only, in-area, realistic timeline, budget band, decision-maker
  present), with explicit guidance not to probe on budget — only flag an
  obvious mismatch if the caller volunteers a number. This is more nuanced
  than the Phase 1 placeholder rubric; `agent/gemini-classify.prompt.md`
  and the mid-call classify tool must be rebuilt against this version
  (tracked for Phase 4).
- **`services.md`**: real scope — residential + small commercial (up to
  ~3,000 sq ft) across Pune city and PCMC, with a named locality list.
  Explicitly excludes architecture/structural work, decor-only/advisory,
  standalone furniture sourcing, standalone Vastu, and
  restaurants/hotels/retail. Minimum lead time: 6 weeks from today;
  minimum commercial scope implied at ~500 sq ft (confirmed by transcript
  T18, a 180 sq ft coworking pod being declined).
- **`pricing.md`**: received and placed at `knowledge/pricing.md`. **Not
  read, not opened, not loaded into any context by me or by the agent** —
  per the hard rule in the brief. It is gitignored (`npm run
  lint:no-pricing` / CI confirms it never gets tracked).
- **Transcripts**: the supplied PDF contained **20 real phone-call
  transcripts** (`T01`–`T20`, labelled "Phone" in the source), not the 40
  mentioned in the brief's placeholder count — split out individually into
  `knowledge/transcripts/T01.md`…`T20.md`. The same PDF also had a
  "WhatsApp threads" and a "web form submissions" section; both are **out
  of scope** per the brief ("Scope is incoming phone calls only") and were
  not extracted. If more phone transcripts arrive later, add them with the
  same `T##.md` naming so `scripts/simulate-call.ts` (Phase 3) can glob
  them.
  - These 20 already cover most of the required unhappy-path test cases
    from brief section 12: price pressure (T02, T13), out-of-service-area
    (T03), advisory-only/no-execution (T04), unrealistic timeline (T07),
    existing-client complaint/escalation (T09), budget clearly below scope
    (T10), rented apartment edge case (T11), dropped/re-called call (T17),
    below-minimum commercial scope (T18), and out-of-scope project type —
    restaurant (T19). Missing from brief's 5-unhappy-path list: an abusive
    caller and a non-English caller — neither appears in this batch, so
    synthetic test cases will be needed for those two in Phase 3/12.
  - T08 is a missed call with no transcript (logged metadata only) — useful
    for after-hours/no-answer routing tests, not for classify/dialogue tests.

## Phase 1 — Scaffold (2026-10-09)

- **Next.js setup**: App Router, TypeScript, ESLint, no Tailwind (dashboard
  will use plain CSS modules / a restrained hand-rolled design per spec),
  no `src/` dir, import alias `@/*`.
- **Package manager**: npm (already the lockfile in use; no stated preference).
- **Vitest version pinned to v2** instead of latest v5, because v5 requires
  `@types/node` ^22/^24 which conflicted with the Next.js-installed
  `@types/node` 26 (peer conflict on `npm install`). Revisit once the
  `@types/node` pin is no longer in the way — tracked as a known limitation.
- **`neon.ts`** left exactly as `defineConfig({})` per the brief's explicit
  instruction. Actual Drizzle Kit config (schema path, migrations out dir,
  dialect, credentials) lives in a separate `drizzle.config.ts`, since
  `drizzle-kit` needs real config to generate migrations and the brief says
  not to change `neon.ts`.
- **`GEMINI_MODEL` default**: `gemini-2.0-flash`, used only until the real
  model name is confirmed live. Placeholder per spec section 2.
- **Env validation**: single `lib/env.ts` using zod, parsed once at import
  time, fails fast with a readable error. Per-service `*_MODE` overrides
  layered on top of a global `INTEGRATIONS_MODE` so individual integrations
  can be flipped to `live` independently during the Phase 9 rollout.
- **`knowledge/qualified.md` and `knowledge/services.md`** do not exist yet.
  Placeholders will be added in `/agent` and flagged clearly; see section 4
  of the brief. Do not treat placeholder rubric/questions as final.
- **`pricing.md`**: not created, not read. Added to `.gitignore` pre-emptively
  so that if it's dropped into `/knowledge` later it is never committed or
  loaded into any agent/Gemini context.

## Open [ASK] items (batched, non-blocking — see brief section 15)

1. Vaani docs URL + confirmation of mid-call tool/webhook support. **This is
   the single biggest architectural risk** — if Vaani cannot call out to our
   API mid-call, the entire "classify + offer slots + book, all inside the
   call" design (steps 6–12) falls back to: collect answers, end the call,
   confirm booking by SMS/WhatsApp/callback afterward. Built behind
   `VAANI_SUPPORTS_MIDCALL_TOOLS` reasoning in `lib/integrations/vaani.ts`;
   mock implementation currently assumes mid-call tools ARE supported, since
   that's the harder/more complete path to build against.
2. Is the consultation free? Slot length 30 or 45 min? Defaulting to a
   45-minute Cal.com event type until told otherwise; opening line avoids
   the word "free".
3. What a "no" caller hears, and whether anyone follows up. Default: a
   polite close ("Thank you for your time, this isn't something our studio
   can help with — have a good day"), no scheduled follow-up, logged to
   Neon with `reason_code`.
4. Languages: defaulting to English + Hindi (switch-on-detection) per
   section 6 identity line, since the brief's own sample opening line
   already describes this behavior. Voice gender: unset / provider default.
5. Front desk ring time defaults to 15s (spec default). Resend escalation
   windows default to 15 min (slot within 24h) / 60 min (otherwise), per
   spec defaults, `ENABLE_RESEND_FALLBACK=false` until confirmed live.
6. Vaani per-minute INR rate: left as `VOICE_COST_INR_PER_MIN=0` (clearly
   an unset assumption) until given.
7. Designers: using 2 placeholder test designers (`Asha`, `Rohan`) in seed
   data until real names / Cal.com host IDs / Telegram accounts are given.
8. HubSpot pipeline/stage: left as empty env vars; integration mock uses
   placeholder IDs `default-pipeline` / `booked` until given.
9. Demo date: unknown — no deadline-driven prioritization applied yet.

## Dependencies beyond the fixed stack

None added yet beyond what section 2 specifies (`zod`, `vitest`,
`drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`, plus `tsx` and
`@vitejs/plugin-react` as vitest's own tooling requirements). Any future
addition will be recorded here with a reason before it's installed.
