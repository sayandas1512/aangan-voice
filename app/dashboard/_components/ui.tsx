import type { ReactNode } from "react";
import { OUTCOME_LABELS, outcomeTone, reasonLabel, verdictTone, type PillTone } from "@/lib/domain/dashboard-format";
import type { EnquiryRow } from "@/lib/domain/dashboard-metrics";

// Minimal line icons (Lucide-style paths, inlined so there's no icon dependency).
const ICONS = {
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="m9 16 2 2 4-4" />
    </>
  ),
  rupee: (
    <>
      <path d="M6 3h12M6 8h12" />
      <path d="m6 13 8.5 8" />
      <path d="M6 13h3" />
      <path d="M9 13c6.667 0 6.667-10 0-10" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  arrow: <path d="M5 12h14M12 5l7 7-7 7" />,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  external: <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  mic: (
    <>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </>
  ),
  video: (
    <>
      <path d="m22 8-6 4 6 4V8Z" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

export function Pill({ tone = "neutral", plain, children }: { tone?: PillTone; plain?: boolean; children: ReactNode }) {
  return <span className={`pill pill-${tone}${plain ? " pillPlain" : ""}`}>{children}</span>;
}

const AVATAR_COLORS = ["#f1ddd2", "#e3e8d6", "#dde6ee", "#efe2c8", "#e9dcea", "#d9e8e1"];

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, className }: { name: string | null; className?: string }) {
  const label = name ?? "";
  let hash = 0;
  for (const ch of label || "?") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`avatar ${className ?? ""}`} style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }} aria-hidden="true">
      {name ? initials(name) : <Icon name="phone" size={15} />}
    </span>
  );
}

/** What the assistant concluded about a call, as a single pill (+ the plain-English reason when declined). */
export function ResultCell({ row }: { row: Pick<EnquiryRow, "verdict" | "status" | "reasonCode"> }) {
  if (row.verdict === "yes") return <Pill tone="good">Qualified</Pill>;
  if (row.verdict === "maybe") return <Pill tone="warn">Maybe</Pill>;
  if (row.verdict === "no") {
    return (
      <>
        <Pill tone={verdictTone("no")}>Declined</Pill>
        <div className="cellSub">{reasonLabel(row.reasonCode)}</div>
      </>
    );
  }
  if (row.status === "missed") return <Pill tone="warn">Missed call</Pill>;
  if (row.status === "dropped") return <Pill tone="warn">Dropped</Pill>;
  if (row.status === "in_progress") return <Pill tone="info">In progress</Pill>;
  return <Pill tone="warn">Needs a person</Pill>;
}

export function OutcomePill({ outcome }: { outcome: string }) {
  return <Pill tone={outcomeTone(outcome)}>{OUTCOME_LABELS[outcome] ?? outcome}</Pill>;
}

export function FlashMessage({ tone, children }: { tone: "good" | "bad"; children: ReactNode }) {
  return <div className={`flash flash-${tone}`}>{children}</div>;
}
