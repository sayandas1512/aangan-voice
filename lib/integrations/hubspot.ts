import { integrationMode, env } from "@/lib/env";
import type { Verdict, Outcome } from "@/lib/db/schema";

export interface UpsertContactDealInput {
  name: string;
  phone: string;
  email?: string;
  verdict: Verdict; // yes | maybe only — callers must not pass "no"
  summary: string;
  bookingStartIso?: string;
  designerName?: string;
}

export interface UpsertContactDealResult {
  contactId: string;
  dealId: string;
}

export interface UpdateDealOutcomeInput {
  dealId: string;
  outcome: Outcome;
  amountInr?: number;
}

export interface HubspotClient {
  upsertContactAndDeal(input: UpsertContactDealInput): Promise<UpsertContactDealResult>;
  updateDealOutcome(input: UpdateDealOutcomeInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// mock
// ---------------------------------------------------------------------------
let mockCounter = 0;

const mockClient: HubspotClient = {
  async upsertContactAndDeal(input) {
    mockCounter += 1;
    console.log(`[mock hubspot] upsert contact+deal for ${input.name} (${input.phone}), verdict=${input.verdict}`);
    return { contactId: `mock-contact-${mockCounter}`, dealId: `mock-deal-${mockCounter}` };
  },
  async updateDealOutcome(input) {
    console.log(`[mock hubspot] deal ${input.dealId} -> ${input.outcome}${input.amountInr ? ` (₹${input.amountInr})` : ""}`);
  },
};

// ---------------------------------------------------------------------------
// live — HubSpot CRM API v3 (https://developers.hubspot.com/docs/api/crm)
// ---------------------------------------------------------------------------
const HUBSPOT_API_BASE = "https://api.hubapi.com";

function authHeaders() {
  if (!env.HUBSPOT_ACCESS_TOKEN) {
    throw new Error("HUBSPOT_ACCESS_TOKEN is required in live mode.");
  }
  return {
    Authorization: `Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function findContactByPhone(phone: string): Promise<string | undefined> {
  const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: phone }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return undefined;
  const data = await res.json();
  return data.results?.[0]?.id;
}

const liveClient: HubspotClient = {
  async upsertContactAndDeal(input) {
    const existingId = await findContactByPhone(input.phone);
    const contactPayload = {
      properties: {
        firstname: input.name,
        phone: input.phone,
        email: input.email,
      },
    };

    let contactId: string;
    if (existingId) {
      const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${existingId}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(contactPayload),
      });
      if (!res.ok) throw new Error(`HubSpot contact update failed: ${res.status} ${await res.text()}`);
      contactId = existingId;
    } else {
      const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(contactPayload),
      });
      if (!res.ok) throw new Error(`HubSpot contact create failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      contactId = data.id;
    }

    const dealRes = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        properties: {
          dealname: `${input.name} — ${input.verdict} enquiry`,
          pipeline: env.HUBSPOT_PIPELINE_ID,
          dealstage: env.HUBSPOT_STAGE_BOOKED,
          closedate: input.bookingStartIso,
        },
        associations: [
          {
            to: { id: contactId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
          },
        ],
      }),
    });
    if (!dealRes.ok) throw new Error(`HubSpot deal create failed: ${dealRes.status} ${await dealRes.text()}`);
    const dealData = await dealRes.json();

    await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/notes`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        properties: { hs_note_body: input.summary, hs_timestamp: Date.now() },
        associations: [
          {
            to: { id: contactId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
          },
        ],
      }),
    });

    return { contactId, dealId: dealData.id };
  },

  async updateDealOutcome(input) {
    const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals/${input.dealId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({
        properties: {
          dealstage: input.outcome,
          amount: input.amountInr,
        },
      }),
    });
    if (!res.ok) throw new Error(`HubSpot deal outcome update failed: ${res.status} ${await res.text()}`);
  },
};

export function getHubspotClient(): HubspotClient {
  return integrationMode("HUBSPOT") === "live" ? liveClient : mockClient;
}
