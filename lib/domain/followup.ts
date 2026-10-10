/**
 * Plain-English "why does this call need a person?" — one source of truth
 * shared by the dashboard's follow-up list and the callback alert email, so
 * the two can never describe the same call differently.
 */

export type FollowupOwner = "front_desk" | "designer" | "system";

export function firstSentence(text: string, max = 150): string {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export function followupReason(input: {
  status: string;
  classificationReason?: string | null;
}): string {
  if (input.status === "missed") return "Missed call — nobody left a message. Worth calling back.";
  if (input.status === "dropped") return "Call dropped mid-conversation.";
  if (!input.classificationReason) return "Needs a person — the assistant couldn't qualify this call.";
  return firstSentence(input.classificationReason);
}

export const OWNER_LABELS: Record<FollowupOwner, string> = {
  front_desk: "Front desk",
  designer: "Designer",
  system: "System",
};
