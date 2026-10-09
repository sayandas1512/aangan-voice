export interface StudioHoursConfig {
  timezone: string;
  hoursStart: string; // "HH:MM", 24h, local to timezone
  hoursEnd: string;
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h, m };
}

/** Minutes since local midnight, in the given IANA timezone, for a UTC instant. */
function localMinutesOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * True when a call instant falls outside studio hours (brief: "answer the
 * call if no pickup in 15 sec, or after 7pm" / "10am to 7pm, day or
 * night"). Studio hours are half-open [start, end) local time; the
 * boundary minute itself counts as after-hours (a call landing exactly at
 * closing time still needs the AI, since the front desk has gone home).
 */
export function isAfterHours(instant: Date, config: StudioHoursConfig): boolean {
  const { h: startH, m: startM } = parseHm(config.hoursStart);
  const { h: endH, m: endM } = parseHm(config.hoursEnd);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const nowMinutes = localMinutesOfDay(instant, config.timezone);
  return nowMinutes < startMinutes || nowMinutes >= endMinutes;
}
