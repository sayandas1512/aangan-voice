# Aangan Enquiry Responder

AI voice-agent system for Aangan Studio (Pune interior design) that answers
missed/after-hours calls, qualifies the lead, books a consultation with a
designer inside the same call, hands the designer full context by email,
and pushes qualified leads into HubSpot — all with a hard rule that **no
price is ever stated by the AI**.

See the component map and full build brief this repo was built from in
`DECISIONS.md` for every default chosen along the way, and the open
`[ASK]` items still outstanding.

## Status

Phases 1–7 complete (scaffold, database, integration mocks, domain logic,
mid-call endpoints, call-ended pipeline, designer outcome actions). See
`DECISIONS.md` for what's been decided and what's still open. Dashboard
and live-integration rollout are still ahead.

## Stack

Next.js (App Router) + TypeScript on Vercel, Vaani Labs (voice), Gemini
Flash (classification + summary), Cal.com API v2 (booking + Meet), Neon
Postgres + Drizzle ORM, Resend (designer handoff + CRM email), HubSpot CRM
(free tier).

Note: the original brief specified Telegram for designer handoff with
Resend as an optional fallback. That was swapped to make Resend/email the
primary (and only) designer-notification channel — see DECISIONS.md's
"Telegram → email pivot" entry for the full reasoning. Outcome actions
(Acknowledge/Held/No-show/Not a fit/Won) are signed links in the email
instead of Telegram's inline buttons.

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app runs entirely in **mock mode** with no API keys (`INTEGRATIONS_MODE=mock`,
the `.env.example` default). Every external integration in `lib/integrations/`
has a real and a mock implementation; the mock implementations are what
let `npm run simulate-call` and the test suite run with zero live
credentials.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run lint:no-pricing` | Fails if `pricing.md` is ever tracked by git |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm test` | Run the vitest suite once |
| `npm run test:watch` | Run vitest in watch mode |
| `npm run db:generate` | Generate a Drizzle migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:push` | Push schema directly (dev convenience) |
| `npm run simulate-call` | Replay a transcript through the mock call pipeline |
| `npm run seed` | Seed Neon with placeholder designers/fixtures |

## The price guard

`pricing.md` is indicative-only internal material. It must never be loaded
into any agent context, any Gemini prompt, or any generated output. This is
enforced three ways:

1. It's listed in `.gitignore` so it can never be committed.
2. `npm run lint:no-pricing` fails CI if it's ever tracked anyway.
3. `lib/domain/price-guard.ts` scans every piece of system-generated text
   (agent strings, summaries, designer emails) for currency symbols, "lakh",
   "crore", per-sq-ft language, and cheap/expensive framing, and blocks the
   output if it finds any (see `tests/` for the guard's own test cases).

Designer-entered "won" amounts are the one exception — they're a human
closing a deal, not generated text.

## Knowledge files

`knowledge/qualified.md` (real qualification rubric) and
`knowledge/services.md` (real scope/service area) have been supplied and
are no longer placeholders. `knowledge/transcripts/` has 20 real phone-call
transcripts (`T01`–`T20`) used as test fixtures (`tests/fixtures/calls.ts`)
— see `scripts/simulate-call.ts` for how they're replayed through the
pipeline. `knowledge/pricing.md`, if present, is gitignored and never read
by any code path (see the price guard section above).

## Repository layout

See `DECISIONS.md` and the brief for the full layout rationale. Short version:

- `app/api/vaani/tools/{classify,slots,book}` — mid-call tool endpoints
- `app/api/vaani/pre-call` — optional caller-lookup hook
- `app/api/vaani/webhook/call-ended` — the real Vaani webhook (signed, confirmed scheme — see DECISIONS.md)
- `app/api/notifications/action` — signed-link outcome actions from the designer email (Acknowledge/Held/No-show/Not a fit/Won)
- `app/api/cron/retry` — Vercel cron worker for the HubSpot retry queue
- `app/dashboard` — password-gated founder dashboard (not yet built)
- `lib/integrations/*` — one file per external service, each with a mock and a live implementation
- `lib/domain/*` — qualification, summary, note-building, price guard, cost math, action-link signing, retry backoff
- `lib/db/*` — Drizzle schema, client, queries
- `agent/*` — the Vaani context pack and Gemini prompts
- `knowledge/*` — rubric, services, transcripts

## Known limitations

- `vitest` is pinned to v2 instead of latest, to avoid a `@types/node` peer
  conflict with the Next.js 16 toolchain. See `DECISIONS.md`.
- The founder dashboard isn't built yet.
- Whether Vaani supports mid-call tool calls the way this build assumes is
  still not fully confirmed against real docs — the single biggest open
  risk (see `DECISIONS.md` item 1).
- Designer emails and Cal.com host IDs are still placeholders
  (`scripts/seed.ts`) — real designer info is needed before live use.
