import { describe, expect, it } from "vitest";
import { env, envSchema, integrationMode } from "@/lib/env";

describe("env", () => {
  it("defaults INTEGRATIONS_MODE to mock", () => {
    expect(env.INTEGRATIONS_MODE).toBe("mock");
  });

  it("falls back to the global mode when no per-service override is set", () => {
    expect(integrationMode("VAANI")).toBe(env.INTEGRATIONS_MODE);
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
