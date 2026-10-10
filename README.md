# Aangan Enquiry Responder

An AI voice assistant for Aangan Studio (interior design, Pune). It answers
every incoming call, day or night, asks the studio's qualifying questions,
books a consultation with a designer during the same call, and hands the
designer the whole story by email before the meeting. A founder dashboard
shows what the system handled, what it cost, and what it earned, so nobody
has to pull numbers by hand.

One hard rule runs through all of it: **the assistant never states a price.**

- Live app: <https://aangan-voice-pied.vercel.app> (dashboard at `/dashboard`)
- Scope: incoming phone calls only. WhatsApp and web forms are out of scope.
- Every build decision, and the reason for it, is in [`DECISIONS.md`](DECISIONS.md).

## How it works

```
Caller ── Vaani voice agent (prompt: agent/vaani-system-prompt.md)
            │
            ├─ classify   → POST /api/vaani/tools/classify → Gemini → verdict saved
            ├─ get_slots  → POST /api/vaani/tools/slots    → Cal.com availability
            └─ book       → POST /api/vaani/tools/book     → Cal.com booking saved
            │
            └─ call ends  → POST /api/vaani/webhook/call-ended   (signed call_postprocessing)
                              └─ processCallEnded
                                   ├─ transcript, duration, status → Postgres (Neon)
                                   ├─ yes / maybe → designer email (Resend) + HubSpot deal
                                   └─ needs a person → callback alert email

Designer clicks Acknowledge / Held / No-show / Not a fit / Won in the email
            └─ GET /api/notifications/action → outcome saved → HubSpot deal stage updated

Founder dashboard (/dashboard) reads Postgres: funnel, revenue, cost,
follow-ups, transcripts, outcomes.
```

What each piece decides:

| Question | Answer |
| --- | --- |
| Does the caller qualify? | `knowledge/qualified.md` rubric, judged by Gemini; verdict `yes`, `maybe` or `no`. |
| Which designer gets the booking? | Cal.com, by availability on the consultation event type. The booking's host is matched to the `designers` table through `calcom_host_id`. There is no routing by area or specialty. |
| How is the designer told? | Email through Resend, with a details table and outcome buttons. Telegram was replaced by email (see `DECISIONS.md`). |
| How does the founder learn the outcome? | The designer clicks Held, No-show, Not a fit or Won (Won takes an amount). The founder can also log it on the call page. A consultation with no outcome after its time shows under "Needs follow-up". |
| What if a call can't be handled? | Missed, dropped or unqualifiable calls are flagged for a person and emailed to `FOLLOWUP_ALERT_EMAIL`. |

## Stack

Next.js 16 (App Router, Cache Components) and TypeScript on Vercel · Vaani
(voice) · Gemini (classification and summary) · Cal.com API v2 (booking) ·
Neon Postgres with Drizzle ORM · Resend (email) · HubSpot CRM.

Every integration in `lib/integrations/` has a live and a mock
implementation. Each one switches with its own `*_MODE` variable
(`VAANI_MODE`, `GEMINI_MODE`, `CALCOM_MODE`, `HUBSPOT_MODE`, `RESEND_MODE`),
falling back to `INTEGRATIONS_MODE`. With nothing set, the whole app and the
test suite run on mocks with no credentials.

## Run it locally

```bash
npm install
cp .env.example .env.local     # mock mode needs no keys, only DATABASE_URL for DB-backed tests
npm run dev                    # http://localhost:3000
npm test                       # 149 tests
npm run build
```

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm test` / `test:watch` | vitest suite |
| `npm run lint`, `lint:no-pricing`, `typecheck` | ESLint, "pricing.md is never committed" check, `tsc` |
| `npm run db:generate` / `db:migrate` / `db:push` | Drizzle migrations |
| `npm run simulate-call` | Replay a transcript through the mock call pipeline |
| `npm run seed` | Seed placeholder designers |
| `npx tsx --env-file=.env.local scripts/seed-sept-enquiries.ts` | Seed the 20 phone enquiries from the case brief |
| `npx tsx --env-file=.env.local scripts/resync-hubspot-sept.ts` | Replace seed deal ids with real HubSpot deals (idempotent) |

## Going live

1. **Environment.** Set the variables in `.env.example` on Vercel. The live
   switches are the `*_MODE` variables. Also set `APP_BASE_URL`,
   `ACTION_LINK_SECRET` and `CRON_SECRET`: without the first two the email
   links are wrong or unsigned.
2. **Vaani webhook.** Register `https://<your-domain>/api/vaani/webhook/call-ended`
   for the `call_postprocessing` and `call_failed` events. Put the secret
   Vaani shows once into `VAANI_WEBHOOK_SECRET`.
3. **Vaani tools.** Add three custom tools, `classify`, `get_slots` and
   `book`, pointing at the endpoints above. Send the header
   `x-vaani-shared-secret: <VAANI_TOOL_SHARED_SECRET>`. Fill in a description
   for every parameter and mark the key ones Required. The agent fills them
   from the conversation and guesses when a description is empty.
4. **Vaani prompt.** Paste [`agent/vaani-system-prompt.md`](agent/vaani-system-prompt.md).
   Use a fast, non-reasoning model: a reasoning model left long silences
   mid-call, and Vaani's pulse check then said "Hello?".
5. **Designers.** Add each designer to the `designers` table (name, email,
   `calcom_host_id`) and as a host on the Cal.com event type.
6. **Dashboard access.** The login gate is built but off
   (`DASHBOARD_REQUIRE_PASSWORD=false`). Turn it on, with a real
   `DASHBOARD_PASSWORD`, before handing the link to anyone outside the review.

## The founder dashboard

`/dashboard` (Overview) and `/dashboard/enquiries` (every call, with filters
and search). Each call has a page with the assessment, the project brief, the
conversation, a progress timeline and the outcome panel.

- **Overview:** enquiries handled, consultations booked, won revenue, how fast
  the designer was told; "Needs follow-up" with an owner on each item; the
  call-to-client funnel; running cost and a monthly projection; why enquiries
  were declined; health of the email, HubSpot and price rule.
- **Times** are shown in IST (the server runs in UTC).
- **Price rule on the dashboard:** it counts how often callers asked what it
  costs, how many booked anyway, and how many times the assistant's own words
  contained price language, by scanning stored transcripts.

## The price rule

`pricing.md` is internal and indicative. It is never loaded into an agent
context, a Gemini prompt, or any generated output.

1. It is in `.gitignore`, so it can't be committed.
2. `npm run lint:no-pricing` fails if it is ever tracked.
3. `lib/domain/price-guard.ts` scans everything the system generates (summaries,
   designer emails) for currency symbols, "lakh", "crore", per-sq-ft language
   and cheap or expensive framing, and replaces the text if it finds any.

The guard covers text our code writes. What the voice agent says is governed
by its Vaani prompt, which deflects every price question, and the dashboard
checks the stored transcripts afterwards. A designer's own "Won" amount is the
only figure that is allowed, because it is a human closing a deal.

## Repository layout

- `app/api/vaani/tools/{classify,slots,book}`: the mid-call tools
- `app/api/vaani/webhook/call-ended`: Vaani's signed post-call webhook
- `app/api/vaani/pre-call`: optional caller lookup
- `app/api/notifications/action`: signed outcome links from the designer email
- `app/api/cron/retry`: nightly worker that retries failed HubSpot syncs
- `app/dashboard`: the founder dashboard; `app/page.tsx` is the landing page
- `lib/integrations`: one file per external service, live and mock
- `lib/domain`: qualification, summary, designer note, price guard, follow-up
  rules, dashboard metrics, call-ended pipeline, action-link signing
- `lib/db`: Drizzle schema, client, queries, migrations
- `agent`: the Vaani prompt, the context pack, and the Gemini prompts
- `knowledge`: qualification rubric, services, and the 20 transcripts
  (`T01`–`T20`) used as fixtures
- `scripts`: seeding and simulation

## Known limits

- The `/talk` browser embed was removed. Vaani serves its script with
  `Cross-Origin-Resource-Policy: same-site`, so browsers block it on our domain.
  Test calls are made from Vaani's own dashboard.
- Web calls carry no caller ID, so the phone number is only known if the caller
  says it. A real phone line would supply it.
- The agent supplies the tools' `call_id` itself and sometimes uses a generic
  value. The webhook therefore matches a finished call by its time window, and
  leaves it unmatched if two calls fit.
- Only one Cal.com host is wired to a designer so far. Designers share one
  email inbox in this build.
- Voice cost covers call minutes only. Model usage isn't tracked.
- The dashboard has one shared login and no per-user accounts. The header shows
  a fixed "Nikhil Deshpande, Founder" label.
- `vitest` is pinned to v2 to avoid a `@types/node` conflict with the Next.js 16
  toolchain.
