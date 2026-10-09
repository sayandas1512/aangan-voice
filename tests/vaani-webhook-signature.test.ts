import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmacSignature } from "@/lib/integrations/vaani";

describe("verifyHmacSignature", () => {
  const secret = "vv_whk_test_secret";
  const body = JSON.stringify({ id: "evt_123", type: "call.completed", data: {} });

  it("accepts a correctly formatted sha256= signature", () => {
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmacSignature(body, signature, secret)).toBe(true);
  });

  it("rejects the bare hex digest without the sha256= prefix (the bug this once had)", () => {
    const bareHex = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmacSignature(body, bareHex, secret)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const signature = "sha256=" + createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(verifyHmacSignature(body, signature, secret)).toBe(false);
  });

  it("rejects a signature computed over different body bytes", () => {
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    const tamperedBody = body.replace("call.completed", "call.failed  ");
    expect(verifyHmacSignature(tamperedBody, signature, secret)).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(verifyHmacSignature(body, null, secret)).toBe(false);
  });
});
