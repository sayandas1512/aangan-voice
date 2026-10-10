import { formatDate, formatPct } from "@/lib/domain/dashboard-format";
import type { DailyPoint, Metrics } from "@/lib/domain/dashboard-metrics";

/** Enquiries per day, split into in-hours vs after-hours — the visual proof of the product's main promise. */
export function DailyBars({ points }: { points: DailyPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.inHours + p.afterHours));
  const total = points.reduce((sum, p) => sum + p.inHours + p.afterHours, 0);

  if (total === 0) {
    return <p className="chatEmpty">No enquiries in this period yet.</p>;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const mid = points[Math.floor(points.length / 2)];
  const label = (p: DailyPoint) => formatDate(new Date(`${p.day}T12:00:00+05:30`)).replace(/^\w+,\s*/, "");

  return (
    <>
      <div className="bars" role="img" aria-label={`Enquiries per day, ${total} in total`}>
        {points.map((p) => {
          const n = p.inHours + p.afterHours;
          return (
            <div
              key={p.day}
              className="barCol"
              title={`${formatDate(new Date(`${p.day}T12:00:00+05:30`))} — ${n} enquir${n === 1 ? "y" : "ies"}${
                p.afterHours ? ` (${p.afterHours} after hours)` : ""
              }`}
            >
              {p.afterHours > 0 && <div className="barSeg barAfter" style={{ height: `${(p.afterHours / max) * 100}%` }} />}
              {p.inHours > 0 && <div className="barSeg barIn" style={{ height: `${(p.inHours / max) * 100}%` }} />}
            </div>
          );
        })}
      </div>
      <div className="axis">
        <span>{label(first)}</span>
        {points.length > 6 && <span>{label(mid)}</span>}
        <span>{label(last)}</span>
      </div>
    </>
  );
}

export function DailyLegend() {
  return (
    <div className="legend">
      <span>
        <span className="legendDot" style={{ background: "var(--brand)" }} />
        Office hours
      </span>
      <span>
        <span className="legendDot" style={{ background: "#d9a441" }} />
        After hours
      </span>
    </div>
  );
}

/** Horizontal funnel: each step's bar is relative to calls received, with the step-to-step conversion underneath. */
export function Funnel({ funnel }: { funnel: Metrics["funnel"] }) {
  const steps = [
    { key: "received", label: "Calls received", value: funnel.received },
    { key: "qualified", label: "Qualified", value: funnel.qualified },
    { key: "booked", label: "Consultation booked", value: funnel.booked },
    { key: "held", label: "Consultation held", value: funnel.held },
    { key: "won", label: "Won", value: funnel.won },
  ];
  const top = Math.max(1, steps[0].value);

  return (
    <div className="funnel">
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <div key={step.key} className="funnelRow">
            <span className="funnelLabel">{step.label}</span>
            <div className="funnelTrack">
              <div
                className={`funnelBar${step.key === "won" ? " funnelBar-won" : ""}`}
                style={{ width: `${step.value === 0 ? 0 : Math.max(3, (step.value / top) * 100)}%` }}
              />
            </div>
            <span className="funnelValue">{step.value}</span>
            {prev !== null && prev > 0 && (
              <span className="funnelConv">{formatPct(step.value / prev)} of the step before</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ReasonBars({ reasons }: { reasons: Metrics["funnel"]["noReasons"] }) {
  if (reasons.length === 0) return <p className="chatEmpty">No declined enquiries in this period.</p>;
  const max = Math.max(...reasons.map((r) => r.count));
  return (
    <div className="reasonList">
      {reasons.map((r) => (
        <div key={r.label} className="reasonRow">
          <span className="reasonLabel">{r.label}</span>
          <span className="reasonCount">{r.count}</span>
          <div className="reasonTrack">
            <div className="reasonBar" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
