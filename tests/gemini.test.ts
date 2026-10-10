import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import type { GeminiClient } from "@/lib/integrations/gemini";
import { CALL_FIXTURES } from "./fixtures/calls";

// This project's .env.local sets GEMINI_MODE=live (DECISIONS.md) — this
// suite tests the deterministic mock classify logic specifically, so it
// isolates GEMINI_MODE regardless of the ambient environment.
describe("gemini mock classify", () => {
  const originalMode = process.env.GEMINI_MODE;
  let client: GeminiClient;

  beforeAll(async () => {
    delete process.env.GEMINI_MODE;
    vi.resetModules();
    const { getGeminiClient } = await import("@/lib/integrations/gemini");
    client = getGeminiClient();
  });

  afterAll(() => {
    process.env.GEMINI_MODE = originalMode;
    vi.resetModules();
  });

  for (const fixture of CALL_FIXTURES) {
    it(`${fixture.id}: ${fixture.note}`, async () => {
      const result = await client.classify(fixture.answers);
      expect(result.verdict).toBe(fixture.expectedVerdict);
      if (fixture.expectedReasonCode) {
        expect(result.reasonCode).toBe(fixture.expectedReasonCode);
      }
    });
  }
});
