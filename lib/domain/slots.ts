import { getCalcomClient, type Slot, type CalcomClient } from "@/lib/integrations/calcom";

export interface GetSlotsOptions {
  timeoutMs?: number;
  client?: CalcomClient;
}

const DEFAULT_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("get_slots timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Slot fetch with the same 2.5s-timeout-never-dead-air contract as
 * qualify.ts (brief section 7: classify and get_slots both have a 2.5s
 * timeout). On timeout or error, returns an empty slot list with
 * humanFollowup true instead of propagating the failure into the live
 * call — the agent should say a designer will call back rather than hang.
 */
export async function getSlots(
  options: GetSlotsOptions = {}
): Promise<{ slots: Slot[]; humanFollowup: boolean }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = options.client ?? getCalcomClient();

  try {
    const slots = await withTimeout(client.getSlots(), timeoutMs);
    return { slots, humanFollowup: false };
  } catch {
    return { slots: [], humanFollowup: true };
  }
}
