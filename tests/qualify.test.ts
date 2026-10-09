import { describe, expect, it } from "vitest";
import { qualify } from "@/lib/domain/qualify";
import type { GeminiClient } from "@/lib/integrations/gemini";
import { CALL_FIXTURES } from "./fixtures/calls";

function slowClient(delayMs: number): GeminiClient {
  return {
    async classify() {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { verdict: "yes", reason: "slow", missingFields: [], model: "slow-stub", latencyMs: delayMs };
    },
    async summarize() {
      return "";
    },
  };
}

describe("qualify", () => {
  it("returns the classifier's verdict under normal conditions", async () => {
    const fixture = CALL_FIXTURES.find((f) => f.id === "T01")!;
    const { result, humanFollowup } = await qualify(fixture.answers);
    expect(result.verdict).toBe(fixture.expectedVerdict);
    expect(humanFollowup).toBe(false);
  });

  it("falls back to maybe + humanFollowup instead of dead air when classify exceeds the timeout", async () => {
    const fixture = CALL_FIXTURES.find((f) => f.id === "T01")!;
    const { result, humanFollowup } = await qualify(fixture.answers, {
      timeoutMs: 10,
      client: slowClient(200),
    });
    expect(result.verdict).toBe("maybe");
    expect(result.reasonCode).toBe("classify_timeout");
    expect(humanFollowup).toBe(true);
  });

  it("does not fall back when classify resolves comfortably inside the timeout", async () => {
    const fixture = CALL_FIXTURES.find((f) => f.id === "T01")!;
    const { result, humanFollowup } = await qualify(fixture.answers, {
      timeoutMs: 200,
      client: slowClient(5),
    });
    expect(result.reasonCode).not.toBe("classify_timeout");
    expect(humanFollowup).toBe(false);
  });
});
