/**
 * Puts an environment variable back to what it was before a test changed it.
 * `process.env.X = undefined` stores the string "undefined", not "unset", which
 * is how a variable that CI never sets (e.g. GEMINI_MODE) ended up failing the
 * enum check in lib/env.ts for every test file that ran after it.
 */
export function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}
