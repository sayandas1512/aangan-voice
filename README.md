# Aangan Enquiry Responder

AI voice-agent system for Aangan Studio (Pune interior design) that answers
missed/after-hours calls, qualifies the lead, books a consultation with a
designer inside the same call, hands the designer full context on Telegram,
and pushes qualified leads into HubSpot — all with a hard rule that **no
price is ever stated by the AI**.

See the component map and full build brief this repo was built from in
`DECISIONS.md` for every default chosen along the way, and the open
`[ASK]` items still outstanding.

## Status

Phase 1 (scaffold) complete. See `DECISIONS.md` for what's been decided
and what's still open. This is a work in progress, built phase by phase per
the brief's build order (section 13).

## Stack

Next.js (App Router) + TypeScript on Vercel, Vaani Labs (voice), Gemini
Flash (classification + summary), Cal.com API v2 (booking + Meet), Neon
Postgres + Drizzle ORM, Telegram Bot API (designer handoff), Resend
(optional email fallback), HubSpot CRM (free tier).

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
| `npm run typecheck` | `tsc --noEmit` |
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
   (agent strings, summaries, Telegram notes) for currency symbols, "lakh",
   "crore", per-sq-ft language, and cheap/expensive framing, and blocks the
   output if it finds any (see `tests/` for the guard's own test cases).

Designer-entered "won" amounts are the one exception — they're a human
closing a deal, not generated text.

## Knowledge files

`knowledge/qualified.md` (qualification rubric) and `knowledge/services.md`
(scope/service area) are currently **placeholders**, clearly marked as such
in the files themselves. Replace them with the studio's real rubric and
scope before trusting any classification output. `knowledge/transcripts/`
is where the 40 real call transcripts go once supplied — see
`scripts/simulate-call.ts` for how they get turned into test cases.

## Repository layout

See `DECISIONS.md` and the brief for the full layout rationale. Short version:

- `app/api/vaani/*` — mid-call tool endpoints (classify, slots, book) and the call-ended webhook
- `app/api/telegram/webhook` — designer registration + outcome buttons
- `app/api/cron/retry` — Vercel cron worker for the HubSpot/notification retry queue
- `app/dashboard` — password-gated founder dashboard
- `lib/integrations/*` — one file per external service, each with a mock and a live implementation
- `lib/domain/*` — qualification, summary, note-building, price guard, cost math
- `lib/db/*` — Drizzle schema, client, queries
- `agent/*` — the Vaani context pack and Gemini prompts
- `knowledge/*` — rubric, services, transcripts (placeholders until supplied)

## Known limitations (Phase 1)

- `vitest` is pinned to v2 instead of latest, to avoid a `@types/node` peer
  conflict with the Next.js 16 toolchain. See `DECISIONS.md`.
- Database schema/migrations, integration mocks, domain logic, and the
  dashboard are not yet built — that's phases 2 onward.
- Whether Vaani supports mid-call tool calls has not been confirmed against
  real docs yet (the single biggest open risk — see `DECISIONS.md` item 1).
