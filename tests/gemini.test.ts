import { describe, expect, it } from "vitest";
import { getGeminiClient } from "@/lib/integrations/gemini";
import { CALL_FIXTURES } from "./fixtures/calls";

describe("gemini mock classify", () => {
  const client = getGeminiClient();

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
