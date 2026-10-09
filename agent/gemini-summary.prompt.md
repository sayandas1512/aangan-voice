<!--
Documentation copy of the live post-call summary prompt. Assembled in
lib/integrations/gemini.ts (liveClient.summarize) and always passed
through lib/domain/price-guard.ts's enforcePriceGuard() before it reaches
Neon, the designer email, or HubSpot — this prompt asking the model not to state a
price is the first layer of defense, not the only one.
-->

# Gemini summary prompt structure

```
Summarize this call transcript in 3-4 lines. Never state or imply a price, range, or whether something is expensive/cheap.

Transcript:

<full call transcript>
```

## Call parameters

- Model: `env.GEMINI_MODEL`
- No `responseSchema` — free-text summary, 3-4 lines, used directly in the
  designer email note (`lib/domain/note.ts`) and the HubSpot note.

## Defense in depth

This prompt-level instruction is layer one. Layer two is
`lib/domain/summary.ts`'s `enforcePriceGuard()` call, which scans the
model's actual output for rupee symbols, "lakh"/"crore", per-sq-ft
language, and expensive/cheap framing (English and Hindi-transliterated)
and substitutes a safe fallback string if anything matches — logging a
`price_guard_violation` event either way. A summary that leaks a price
despite this instruction should never reach a caller or designer; it
should instead surface as a guard-violation event for someone to review.
