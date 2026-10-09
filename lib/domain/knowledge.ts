import { readFile } from "node:fs/promises";
import path from "node:path";

const KNOWLEDGE_DIR = path.resolve(process.cwd(), "knowledge");

/**
 * Loads the real qualification rubric and services/scope docs for use in
 * live Gemini prompts. pricing.md is deliberately not readable through
 * this module — there is no loadPricing() function, and there must never
 * be one (brief: "pricing.md is indicative only and must never be loaded
 * into the agent's context or used in any output").
 */
export async function loadQualifiedRubric(): Promise<string> {
  return readFile(path.join(KNOWLEDGE_DIR, "qualified.md"), "utf8");
}

export async function loadServicesScope(): Promise<string> {
  return readFile(path.join(KNOWLEDGE_DIR, "services.md"), "utf8");
}
