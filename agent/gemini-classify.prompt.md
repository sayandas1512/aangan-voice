<!--
Documentation copy of the live classify prompt. The actual prompt sent to
Gemini is assembled at call time in lib/integrations/gemini.ts
(buildClassifyPrompt), which embeds the real contents of
knowledge/qualified.md and knowledge/services.md directly — this file
exists so the prompt structure is reviewable without reading TypeScript,
and so it stays in the repo layout the brief specifies (section 5).
Keep this in sync with buildClassifyPrompt() if either changes.
-->

# Gemini classify prompt structure

```
You are classifying a phone enquiry for Aangan Studio (interior design, Pune) as yes, maybe, or no.

Follow this qualification rubric exactly — it is the studio owner's own criteria:

--- knowledge/qualified.md ---
<full real contents of knowledge/qualified.md, loaded fresh each call>
--- end qualified.md ---

Scope / service area for the "in our service area" and "real project" criteria:

--- knowledge/services.md ---
<full real contents of knowledge/services.md, loaded fresh each call>
--- end services.md ---

Hard rule: never state, estimate, or imply any price, cost, or rate in your reason — you have not been given pricing information and must not invent one.

Answers collected so far: <JSON of the 7 structured answers>

Return JSON: {verdict: "yes"|"maybe"|"no", reason: string, reasonCode?: string, missingFields: string[]}.
```

## Call parameters

- Model: `env.GEMINI_MODEL` (default `gemini-2.0-flash`, see DECISIONS.md)
- `temperature: 0` — deterministic classification, not creative writing
- `responseMimeType: "application/json"` with a `responseSchema` enforcing
  the exact shape above (see `lib/integrations/gemini.ts`)

## Why the rubric is embedded, not referenced

The brief (section 7) requires classification to use "the rubric from
qualified.md" — an early draft of this prompt just named the file and
trusted the model to know its contents, which it cannot: Gemini has no
access to this repository's filesystem. `buildClassifyPrompt()` reads both
files with `lib/domain/knowledge.ts` and inlines their real text on every
call, so a rubric edit takes effect immediately with no redeploy.

## What must never appear here

`knowledge/pricing.md` is never read by anything in this prompt's assembly
path. `lib/domain/knowledge.ts` deliberately has no `loadPricing()`
export — there is no code path that could accidentally embed it.

## Reason codes used by the mock classifier (lib/integrations/gemini.ts)

The live prompt is free-form on `reasonCode`, but the mock heuristic (used
when `GEMINI_MODE=mock`, the default) emits a fixed small set so tests stay
deterministic: `advisory_only`, `out_of_area`, `unrealistic_timeline`,
`budget_mismatch`, `incomplete_answers`. A real Gemini call may emit
different codes — don't assume these five are exhaustive in live mode.
