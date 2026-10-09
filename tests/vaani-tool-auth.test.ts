import { describe, expect, it, afterEach, vi } from "vitest";

describe("verifyToolRequest", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("allows all requests when VAANI_MODE is mock (the default)", async () => {
    vi.resetModules();
    const { verifyToolRequest } = await import("@/lib/api/vaani-tool-auth");
    const req = new Request("https://example.com", { method: "POST" });
    expect(verifyToolRequest(req)).toBe(true);
  });

  it("requires a matching shared-secret header when VAANI_MODE is live", async () => {
    process.env.VAANI_MODE = "live";
    process.env.VAANI_WEBHOOK_SECRET = "test-secret";
    vi.resetModules();
    const { verifyToolRequest } = await import("@/lib/api/vaani-tool-auth");

    const good = new Request("https://example.com", {
      method: "POST",
      headers: { "x-vaani-shared-secret": "test-secret" },
    });
    const bad = new Request("https://example.com", {
      method: "POST",
      headers: { "x-vaani-shared-secret": "wrong" },
    });
    const missing = new Request("https://example.com", { method: "POST" });

    expect(verifyToolRequest(good)).toBe(true);
    expect(verifyToolRequest(bad)).toBe(false);
    expect(verifyToolRequest(missing)).toBe(false);
  });

  it("denies every request when live mode has no secret configured, rather than defaulting open", async () => {
    process.env.VAANI_MODE = "live";
    delete process.env.VAANI_WEBHOOK_SECRET;
    vi.resetModules();
    const { verifyToolRequest } = await import("@/lib/api/vaani-tool-auth");

    const req = new Request("https://example.com", {
      method: "POST",
      headers: { "x-vaani-shared-secret": "anything" },
    });
    expect(verifyToolRequest(req)).toBe(false);
  });
});
