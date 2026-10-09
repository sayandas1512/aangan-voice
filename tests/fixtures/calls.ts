import type { ClassifyAnswers } from "@/lib/integrations/gemini";

/**
 * Structured answers hand-extracted from knowledge/transcripts/*.md, used by
 * scripts/simulate-call.ts and integration tests. The real Gemini classify
 * prompt (Phase 4, agent/gemini-classify.prompt.md) works from raw
 * transcript text; these structured fixtures exist because the mid-call
 * `classify` tool contract (brief section 6) takes the 7 structured answers,
 * not a transcript, and because deriving them is itself part of what the
 * agent does — this is what Vaani would have collected by the time it calls
 * our classify tool.
 */
export interface CallFixture {
  id: string;
  transcriptFile: string;
  callerName: string;
  callerPhone: string;
  callerEmail?: string;
  answers: ClassifyAnswers;
  expectedVerdict: "yes" | "maybe" | "no";
  expectedReasonCode?: string;
  note: string;
}

export const CALL_FIXTURES: CallFixture[] = [
  {
    id: "T01",
    transcriptFile: "T01.md",
    callerName: "Priya",
    callerPhone: "+91-90000-00001",
    callerEmail: "priya.example@example.com",
    answers: {
      propertyType: "home",
      area: "Kothrud, Dahanukar Colony",
      sizeSqFt: "1400",
      workType: "full interiors",
      budget: "not given",
      timeline: "6 months, no rush",
      decisionMaker: "yes, with spouse",
    },
    expectedVerdict: "yes",
    note: "Clean yes: full redesign, in-area, relaxed timeline, owner on the call.",
  },
  {
    id: "T03",
    transcriptFile: "T03.md",
    callerName: "Suresh Patil",
    callerPhone: "+91-90000-00003",
    answers: {
      propertyType: "home office and study",
      area: "Nashik",
      sizeSqFt: undefined,
      workType: "full interiors",
      budget: "not given",
      timeline: undefined,
      decisionMaker: "yes",
    },
    expectedVerdict: "no",
    expectedReasonCode: "out_of_area",
    note: "Nashik is outside the Pune/PCMC service area.",
  },
  {
    id: "T04",
    transcriptFile: "T04.md",
    callerName: "Unnamed caller",
    callerPhone: "+91-90000-00004",
    answers: {
      propertyType: "home",
      area: undefined,
      sizeSqFt: undefined,
      workType: "advice only, colours and furniture arrangement",
      budget: "not given",
      timeline: undefined,
      decisionMaker: undefined,
    },
    expectedVerdict: "no",
    expectedReasonCode: "advisory_only",
    note: "Advisory-only request, no execution — studio's stated minimum engagement isn't met.",
  },
  {
    id: "T07",
    transcriptFile: "T07.md",
    callerName: "Unnamed caller",
    callerPhone: "+91-90000-00007",
    answers: {
      propertyType: "home",
      area: "Pune",
      sizeSqFt: undefined,
      workType: "full interiors",
      budget: "not given",
      timeline: "3 weeks (before Diwali)",
      decisionMaker: "yes",
    },
    expectedVerdict: "no",
    expectedReasonCode: "unrealistic_timeline",
    note: "3-week timeline is under the 6-week minimum lead time.",
  },
  {
    id: "T10",
    transcriptFile: "T10.md",
    callerName: "Unnamed caller",
    callerPhone: "+91-90000-00010",
    answers: {
      propertyType: "home",
      area: "Kharadi",
      sizeSqFt: "550",
      workType: "kitchen and one bedroom",
      budget: "1 to 1.5 lakh",
      timeline: "not given",
      decisionMaker: "yes",
    },
    expectedVerdict: "no",
    expectedReasonCode: "budget_mismatch",
    note: "Caller volunteered a budget clearly below what this scope would cost.",
  },
];
