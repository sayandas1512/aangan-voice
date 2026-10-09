# Decisions log

Running record of defaults chosen without a blocking question, and anything
that differs from the brief once real docs/APIs are consulted. Newest first.

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
