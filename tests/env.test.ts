import { describe, expect, it, vi } from "vitest";
import { env, envSchema, integrationMode } from "@/lib/env";

describe("env", () => {
  it("defaults INTEGRATIONS_MODE to mock", () => {
    expect(env.INTEGRATIONS_MODE).toBe("mock");
  });

  it("falls back to the global mode when no per-service override is set", async () => {
    // This project's .env.local gives all five services (VAANI, GEMINI,
    // RESEND, CALCOM, HUBSPOT) a permanent live-mode override
    // (DECISIONS.md), so no service is ever naturally unset to
    // demonstrate the fallback against — isolated instead by clearing
    // one var's override within the test and re-importing fresh.
    const original = process.env.VAANI_MODE;
    delete process.env.VAANI_MODE;
    vi.resetModules();
    const fresh = await import("@/lib/env");
    expect(fresh.integrationMode("VAANI")).toBe(fresh.env.INTEGRATIONS_MODE);
    process.env.VAANI_MODE = original;
    vi.resetModules();
  });

  it("defaults ACTION_LINK_SECRET and APP_BASE_URL so mock mode needs no config", () => {
    expect(env.ACTION_LINK_SECRET).toBeTruthy();
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
  });

  it("rejects a blank-but-present *_MODE var directly against the schema", () => {
    // Documents why lib/env.ts strips empty strings before parsing: a bare
    // enum().optional() field treats "" as an invalid enum value, not as
    // unset — .env.local ships unset overrides as e.g. "VAANI_MODE=".
    const result = envSchema.safeParse({ ...process.env, VAANI_MODE: "" });
    expect(result.success).toBe(false);
  });
});
