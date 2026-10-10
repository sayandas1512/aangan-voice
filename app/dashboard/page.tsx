import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isDashboardAuthed } from "@/lib/api/dashboard-auth";
import {
  buildEnquiryRows,
  computeDailySeries,
  computeMetrics,
  deriveAttention,
  loadSnapshot,
} from "@/lib/domain/dashboard-metrics";
import {
  RANGE_LABELS,
  formatInr,
  formatInrCompact,
  formatLatency,
  formatPct,
  parseRange,
  rangeSince,
  type RangeKey,
} from "@/lib/domain/dashboard-format";
import AttentionList from "./_components/AttentionList";
import { DailyBars, DailyLegend, Funnel, ReasonBars } from "./_components/Charts";
import DashShell from "./_components/DashShell";
import EnquiryTable from "./_components/EnquiryTable";
import { Icon, type IconName } from "./_components/ui";

export const metadata: Metadata = { title: "Overview · Aangan Studio" };

// Password-optional dashboard that reads cookies()/DB on every request, so it
// can't produce a static shell. Cache Components (Next.js 16) requires
// explicitly opting a route out of static-shell validation rather than
// inferring it from dynamic API usage like the old `dynamic =
// "force-dynamic"` did.
export const instant = false;

function Kpi({ icon, label, value, foot }: { icon: IconName; label: string; value: string; foot: string }) {
  return (
    <div className="kpi">
      <div className="kpiTop">
        <span>{label}</span>
        <span className="kpiIcon">
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="kpiValue">{value}</div>
      <div className="kpiFoot">{foot}</div>
    </div>
  );
}

function rangeHrefs(): Record<RangeKey, string> {
  return { "7d": "/dashboard?range=7d", "30d": "/dashboard?range=30d", all: "/dashboard" };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  // Reads the clock and the DB on every request — tell Next.js 16 (Cache Components)
  // this is request-time rendering, or `new Date()` below fails prerender validation.
  await connection();

  if (!(await isDashboardAuthed())) {
    redirect("/dashboard/login");
  }

  const range = parseRange((await searchParams).range);
  const since = rangeSince(range);
  const snap = await loadSnapshot();

  const metrics = computeMetrics(snap, since);
  const attention = deriveAttention(snap); // deliberately not range-filtered: an old follow-up is still owed
  const daily = computeDailySeries(snap, since);
  const recent = buildEnquiryRows(snap)
    .filter((r) => !since || r.startedAt >= since)
    .slice(0, 6);

  const { calls, funnel, value, cost, speed, health } = metrics;
  const conversion = funnel.qualified > 0 ? funnel.booked / funnel.qualified : null;
  const didntConnect = calls.missedOrDropped;

  const emailTone = health.emailFailed > 0 ? "bad" : "good";
  const hubspotTone = health.hubspotFailed > 0 ? "bad" : health.hubspotRetrying > 0 ? "warn" : "good";

  return (
    <DashShell active="overview" range={{ current: range, hrefs: rangeHrefs() }}>
      <main className="page">
        <div className="pageHead">
          <div>
            <h1 className="pageTitle">Overview</h1>
            <p className="pageSub">
              What the assistant handled for the studio · {RANGE_LABELS[range].toLowerCase()}
            </p>
          </div>
        </div>

        <section className="kpis" aria-label="Key numbers">
          <Kpi
            icon="phone"
            label="Enquiries handled"
            value={String(calls.total)}
            foot={
              calls.total === 0
                ? "No calls in this period"
                : `${formatPct(calls.afterHoursShare)} came after hours${didntConnect > 0 ? ` · ${didntConnect} didn’t connect` : ""}`
            }
          />
          <Kpi
            icon="calendar"
            label="Consultations booked"
            value={String(funnel.booked)}
            foot={conversion === null ? "No qualified enquiries yet" : `${formatPct(conversion)} of qualified enquiries`}
          />
          <Kpi
            icon="rupee"
            label="Won revenue"
            value={formatInrCompact(value.wonInr)}
            foot={
              value.openDeals > 0
                ? `${funnel.won} won · ${value.openDeals} open, est. ${formatInrCompact(value.pipelineLowInr)}–${formatInrCompact(value.pipelineHighInr)}`
                : `${funnel.won} won · no open consultations`
            }
          />
          <Kpi
            icon="clock"
            label="Designer notified in"
            value={formatLatency(speed.emailP50)}
            foot={speed.emailP95 !== null ? `median, call end → email · slowest ${formatLatency(speed.emailP95)}` : "median, call end → email"}
          />
        </section>

        <section className="grid">
          <div className="card col7">
            <div className="cardHead">
              <div>
                <h2 className="cardTitle">Needs your attention</h2>
                <p className="cardSub">
                  {attention.length === 0
                    ? "Nothing waiting on you"
                    : `${attention.length} item${attention.length === 1 ? "" : "s"} — callbacks, consultations to log, anything broken`}
                </p>
              </div>
            </div>
            <AttentionList items={attention} />
          </div>

          <div className="card col5">
            <div className="cardHead">
              <div>
                <h2 className="cardTitle">From call to client</h2>
                <p className="cardSub">Where enquiries go, step by step</p>
              </div>
            </div>
            <Funnel funnel={funnel} />
            <p className="costLine">
              AI cost <strong>{formatInr(cost.totalInr)}</strong> in total
              {funnel.booked > 0 && (
                <>
                  {" "}
                  · <strong>{formatInr(cost.perBookingInr)}</strong> per booked consultation
                </>
              )}
              {" "}
              · {Math.round(cost.voiceMinutes)} min of calls. Voice minutes only; model usage isn&apos;t tracked.
            </p>
          </div>
        </section>

        <section className="grid">
          <div className="card col7">
            <div className="cardHead">
              <div>
                <h2 className="cardTitle">Enquiries over time</h2>
                <p className="cardSub">Every call the assistant picked up, day by day</p>
              </div>
              <DailyLegend />
            </div>
            <DailyBars points={daily} />
          </div>

          <div className="card col5">
            <div className="cardHead">
              <div>
                <h2 className="cardTitle">Why we said no</h2>
                <p className="cardSub">{funnel.verdicts.no} declined enquir{funnel.verdicts.no === 1 ? "y" : "ies"}</p>
              </div>
            </div>
            <ReasonBars reasons={funnel.noReasons} />
          </div>
        </section>

        <section className="card" style={{ marginBottom: 16 }}>
          <div className="cardHead">
            <div>
              <h2 className="cardTitle">Latest enquiries</h2>
            </div>
            <Link href="/dashboard/enquiries" className="cardLink">
              View all →
            </Link>
          </div>
          <EnquiryTable rows={recent} emptyMessage="No enquiries in this period yet." />
        </section>

        <section className="card">
          <div className="health" aria-label="System health">
            <span className="healthItem">
              <span className={`dot dot-${emailTone}`} />
              <span>
                Designer emails{" "}
                <strong>{health.emailTotal === 0 ? "none sent yet" : `${health.emailSent}/${health.emailTotal} delivered`}</strong>
              </span>
            </span>
            <span className="healthItem">
              <span className={`dot dot-${hubspotTone}`} />
              <span>
                HubSpot{" "}
                <strong>
                  {health.hubspotTotal === 0
                    ? "nothing to sync yet"
                    : `${health.hubspotSynced}/${health.hubspotTotal} synced${health.hubspotRetrying > 0 ? `, ${health.hubspotRetrying} retrying` : ""}`}
                </strong>
              </span>
            </span>
            <span className="healthItem">
              <span className={`dot dot-${health.priceGuardHits > 0 ? "warn" : "good"}`} />
              <span>
                Price guard{" "}
                <strong>
                  {health.priceGuardHits === 0 ? "no prices leaked" : `${health.priceGuardHits} price${health.priceGuardHits === 1 ? "" : "s"} blocked`}
                </strong>
              </span>
            </span>
          </div>
        </section>
      </main>
    </DashShell>
  );
}
