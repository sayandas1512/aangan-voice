# Decisions log

Running record of defaults chosen without a blocking question, and anything
that differs from the brief once real docs/APIs are consulted. Newest first.

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
