import { defineConfig } from "vitest/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Minimal .env.local loader (no extra dependency) so tests that touch the
// DB (e.g. tests/calcom.test.ts) see DATABASE_URL, same as `npm run dev`/
// `npm run seed` do. Deliberately simple: KEY=VALUE per line, optional
// surrounding quotes, '#' comments, blank lines skipped.
function loadDotEnvLocal() {
  const file = path.resolve(__dirname, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value !== "" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export default defineConfig(() => {
  loadDotEnvLocal();

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      // Several integration tests (call-ended.test.ts, api-*.test.ts) make
      // many sequential real round trips to Neon through the route
      // handlers they exercise. Vitest's 5s default was fine against local
      // network latency but timed out in CI — not a code bug, just a
      // tighter default than this suite's slowest real DB paths need.
      testTimeout: 20000,
    },
  };
});
