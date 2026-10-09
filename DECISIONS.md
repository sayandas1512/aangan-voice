# Decisions log

Running record of defaults chosen without a blocking question, and anything
that differs from the brief once real docs/APIs are consulted. Newest first.

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
