import { verifyActionToken } from "@/lib/domain/action-link";
import { recordAcknowledge, recordSimpleOutcome, recordWonOutcome } from "@/lib/domain/outcome-action";

/**
 * Replaces Telegram's inline outcome buttons (brief section 8, steps
 * 17-19) with plain signed links a designer clicks from the handoff
 * email — no login, no app install. GET handles the four direct outcomes
 * and renders a tiny amount-entry form for "Won" (which can't be a GET,
 * since it needs free-text input); that form POSTs back here.
 */

function page(title: string, bodyHtml: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 420px; margin: 48px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  form { margin-top: 1rem; }
  input[type="number"] { font-size: 1rem; padding: 0.5rem; width: 100%; box-sizing: border-box; }
  button { margin-top: 0.75rem; font-size: 1rem; padding: 0.6rem 1.2rem; cursor: pointer; }
  .error { color: #b00020; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function invalidLinkPage(): Response {
  return page("Link expired", "<h1>This link has expired or is invalid.</h1><p>Check the dashboard for this call's current status.</p>", 400);
}

function wonAmountForm(token: string, error?: string): Response {
  return page(
    "Enter the deal amount",
    `<h1>What was the deal amount?</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="POST">
  <input type="hidden" name="token" value="${escapeHtml(token)}" />
  <label for="amount">Amount in rupees</label>
  <input type="number" id="amount" name="amount" min="1" step="1" required autofocus />
  <button type="submit">Save</button>
</form>`
  );
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return invalidLinkPage();

  const payload = verifyActionToken(token);
  if (!payload) return invalidLinkPage();

  if (payload.action === "won") {
    return wonAmountForm(token);
  }

  const result =
    payload.action === "acknowledge"
      ? await recordAcknowledge(payload.callId)
      : await recordSimpleOutcome(payload.bookingId, payload.action);

  return page("Done", `<h1>${escapeHtml(result.message)}</h1>`);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token !== "string") return invalidLinkPage();

  const payload = verifyActionToken(token);
  if (!payload || payload.action !== "won") return invalidLinkPage();

  const amountRaw = form?.get("amount");
  const amount = typeof amountRaw === "string" ? Number(amountRaw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return wonAmountForm(token, "Enter a valid amount greater than zero.");
  }

  const result = await recordWonOutcome(payload.bookingId, amount);
  return page("Done", `<h1>${escapeHtml(result.message)}</h1>`);
}
