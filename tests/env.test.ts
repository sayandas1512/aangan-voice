import { describe, expect, it } from "vitest";
import { env, integrationMode } from "@/lib/env";

describe("env", () => {
  it("defaults INTEGRATIONS_MODE to mock", () => {
    expect(env.INTEGRATIONS_MODE).toBe("mock");
  });

  it("falls back to the global mode when no per-service override is set", () => {
    expect(integrationMode("VAANI")).toBe(env.INTEGRATIONS_MODE);
  });

  it("defaults ENABLE_RESEND_FALLBACK to false", () => {
    expect(env.ENABLE_RESEND_FALLBACK).toBe(false);
  });
});
