import { getGeminiClient, type ClassifyAnswers, type ClassifyResult, type GeminiClient } from "@/lib/integrations/gemini";

export interface QualifyOptions {
  timeoutMs?: number;
  /** Override for tests; defaults to the configured mock/live Gemini client. */
  client?: GeminiClient;
}

// Real gemini-3.8-flash round-trips at ~2.4-4.5s even with thinking
// disabled (see lib/integrations/gemini.ts) — measured live, with
// variance under network contention. The agent says a filler line before
// calling classify (agent/context-pack.md's Latency section), so a few
// seconds here is expected, not dead air.
const DEFAULT_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("qualify timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function timeoutFallback(): ClassifyResult {
  return {
    verdict: "maybe",
    reason: "Classification didn't complete in time — a designer will call back to confirm.",
    reasonCode: "classify_timeout",
    missingFields: [],
    model: "fallback",
    latencyMs: 0,
  };
}

/**
 * Qualifies a call's structured answers against the rubric, per brief
 * section 7: classify runs with a 2.5s timeout and never produces dead air
 * — on timeout or error it returns a safe "maybe" + human-followup fallback
 * instead of propagating the failure to the live call.
 */
export async function qualify(
  answers: ClassifyAnswers,
  options: QualifyOptions = {}
): Promise<{ result: ClassifyResult; humanFollowup: boolean }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = options.client ?? getGeminiClient();

  try {
    const result = await withTimeout(client.classify(answers), timeoutMs);
    return { result, humanFollowup: false };
  } catch {
    return { result: timeoutFallback(), humanFollowup: true };
  }
}
