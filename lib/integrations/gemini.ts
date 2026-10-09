import { integrationMode, env } from "@/lib/env";
import type { Verdict } from "@/lib/db/schema";
import { loadQualifiedRubric, loadServicesScope } from "@/lib/domain/knowledge";

export interface ClassifyAnswers {
  propertyType?: string; // home | office
  area?: string; // locality in Pune/PCMC
  sizeSqFt?: string;
  workType?: string; // full interiors | a few rooms | renovation | advice only
  budget?: string; // caller-stated, may be "declined"
  timeline?: string;
  decisionMaker?: string; // yes | delegated | unclear
}

export interface ClassifyResult {
  verdict: Verdict;
  reason: string;
  reasonCode?: string;
  missingFields: string[];
  model: string;
  latencyMs: number;
}

export interface GeminiClient {
  classify(answers: ClassifyAnswers): Promise<ClassifyResult>;
  summarize(transcript: string): Promise<string>;
}

// In-area localities from knowledge/services.md (Pune city + PCMC).
const SERVICE_AREA = [
  "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar",
  "viman nagar", "hadapsar", "magarpatta", "nibm", "kondhwa", "undri",
  "shivane", "warje", "erandwane", "deccan", "pimpri", "chinchwad",
  "pimple saudagar", "pimple nilakh", "ravet", "hinjewadi", "kharadi",
  "pune",
];

const ADVICE_ONLY_PATTERNS = ["advice", "ideas", "suggestion", "just looking", "consultation only", "colours"];

function daysUntil(timeline: string | undefined): number | undefined {
  if (!timeline) return undefined;
  const weeksMatch = timeline.match(/(\d+)\s*week/i);
  if (weeksMatch) return Number(weeksMatch[1]) * 7;
  const monthsMatch = timeline.match(/(\d+)\s*month/i);
  if (monthsMatch) return Number(monthsMatch[1]) * 30;
  if (/\bno rush\b|\bflexible\b/i.test(timeline)) return 180;
  return undefined;
}

/**
 * Deterministic stand-in for the Gemini classify prompt, approximating
 * knowledge/qualified.md's five criteria so the mock pipeline produces
 * plausible, testable verdicts without an API key. The real rubric lives
 * in agent/gemini-classify.prompt.md and is only authoritative in live mode.
 */
function mockClassify(answers: ClassifyAnswers): ClassifyResult {
  const missingFields: string[] = [];
  const workType = (answers.workType ?? "").toLowerCase();
  const area = (answers.area ?? "").toLowerCase();
  const timeline = answers.timeline;

  if (!answers.workType) missingFields.push("workType");
  if (!answers.area) missingFields.push("area");
  if (!answers.timeline) missingFields.push("timeline");

  if (ADVICE_ONLY_PATTERNS.some((p) => workType.includes(p))) {
    return {
      verdict: "no",
      reason: "Caller wants advisory/styling only, not design with execution.",
      reasonCode: "advisory_only",
      missingFields,
      model: "mock-gemini",
      latencyMs: 1,
    };
  }

  if (area && !SERVICE_AREA.some((loc) => area.includes(loc))) {
    return {
      verdict: "no",
      reason: `Area "${answers.area}" is outside the Pune/PCMC service area.`,
      reasonCode: "out_of_area",
      missingFields,
      model: "mock-gemini",
      latencyMs: 1,
    };
  }

  const days = daysUntil(timeline);
  if (days !== undefined && days < 42) {
    return {
      verdict: "no",
      reason: "Timeline is under the 6-week minimum lead time for execution.",
      reasonCode: "unrealistic_timeline",
      missingFields,
      model: "mock-gemini",
      latencyMs: 1,
    };
  }

  const budgetMatch = (answers.budget ?? "").match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*lakh/i);
  if (budgetMatch) {
    const low = Number(budgetMatch[1]);
    if (low <= 1.5) {
      return {
        verdict: "no",
        reason: "Caller volunteered a budget clearly below what this scope would cost.",
        reasonCode: "budget_mismatch",
        missingFields,
        model: "mock-gemini",
        latencyMs: 1,
      };
    }
  }

  if (missingFields.length > 0) {
    return {
      verdict: "maybe",
      reason: `Qualified but missing: ${missingFields.join(", ")}.`,
      reasonCode: "incomplete_answers",
      missingFields,
      model: "mock-gemini",
      latencyMs: 1,
    };
  }

  return {
    verdict: "yes",
    reason: "Real project, in service area, realistic timeline, no budget red flag.",
    missingFields: [],
    model: "mock-gemini",
    latencyMs: 1,
  };
}

function mockSummarize(transcript: string): string {
  const firstLines = transcript
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, 4)
    .join(" ")
    .slice(0, 400);
  return `[mock summary] ${firstLines}`;
}

const mockClient: GeminiClient = {
  async classify(answers) {
    return mockClassify(answers);
  },
  async summarize(transcript) {
    return mockSummarize(transcript);
  },
};

const liveClient: GeminiClient = {
  async classify(answers) {
    const start = Date.now();
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required in live mode for Gemini classify.");
    }
    const prompt = await buildClassifyPrompt(answers);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                verdict: { type: "string", enum: ["yes", "maybe", "no"] },
                reason: { type: "string" },
                reasonCode: { type: "string" },
                missingFields: { type: "array", items: { type: "string" } },
              },
              required: ["verdict", "reason", "missingFields"],
            },
          },
        }),
      }
    );
    if (!res.ok) {
      throw new Error(`Gemini classify failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(text);
    return {
      verdict: parsed.verdict,
      reason: parsed.reason,
      reasonCode: parsed.reasonCode,
      missingFields: parsed.missingFields ?? [],
      model: env.GEMINI_MODEL,
      latencyMs: Date.now() - start,
    };
  },
  async summarize(transcript) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required in live mode for Gemini summarize.");
    }
    const prompt = `Summarize this call transcript in 3-4 lines. Never state or imply a price, range, or whether something is expensive/cheap. Transcript:\n\n${transcript}`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!res.ok) {
      throw new Error(`Gemini summarize failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  },
};

async function buildClassifyPrompt(answers: ClassifyAnswers): Promise<string> {
  const [rubric, scope] = await Promise.all([loadQualifiedRubric(), loadServicesScope()]);
  return [
    "You are classifying a phone enquiry for Aangan Studio (interior design, Pune) as yes, maybe, or no.",
    "Follow this qualification rubric exactly — it is the studio owner's own criteria:",
    "--- knowledge/qualified.md ---",
    rubric,
    "--- end qualified.md ---",
    "Scope / service area for the \"in our service area\" and \"real project\" criteria:",
    "--- knowledge/services.md ---",
    scope,
    "--- end services.md ---",
    "Hard rule: never state, estimate, or imply any price, cost, or rate in your reason — you have not been given pricing information and must not invent one.",
    `Answers collected so far: ${JSON.stringify(answers)}`,
    "Return JSON: {verdict: \"yes\"|\"maybe\"|\"no\", reason: string, reasonCode?: string, missingFields: string[]}.",
  ].join("\n\n");
}

export function getGeminiClient(): GeminiClient {
  return integrationMode("GEMINI") === "live" ? liveClient : mockClient;
}
