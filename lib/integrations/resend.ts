import { integrationMode, env } from "@/lib/env";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  /** Optional rich version; `text` stays as the plain-text fallback. */
  html?: string;
}

export interface SendEmailResult {
  id: string;
}

export interface ResendClient {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

let mockCounter = 0;

const mockClient: ResendClient = {
  async sendEmail(input) {
    mockCounter += 1;
    console.log(`[mock resend] -> ${input.to}: ${input.subject}\n${input.text}`);
    return { id: `mock-email-${mockCounter}` };
  },
};

const liveClient: ResendClient = {
  async sendEmail(input) {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
      throw new Error("RESEND_API_KEY and RESEND_FROM are required in live mode.");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend sendEmail failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return { id: data.id };
  },
};

export function getResendClient(): ResendClient {
  return integrationMode("RESEND") === "live" ? liveClient : mockClient;
}
