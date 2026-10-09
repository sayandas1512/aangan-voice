import { redirect } from "next/navigation";
import Link from "next/link";
import { isDashboardAuthed } from "@/lib/api/dashboard-auth";
import { getDashboardMetrics, getRecentNoCalls, listCallsForDashboard } from "@/lib/domain/dashboard-metrics";
import LogoutButton from "./LogoutButton";
import "./dashboard.css";

// Password-gated internal dashboard — reads cookies()/DB on every request,
// so it can't produce a static shell. Cache Components (Next.js 16)
// requires explicitly opting a route out of static-shell validation
// rather than inferring it from dynamic API usage like the old
// `dynamic = "force-dynamic"` did.
export const instant = false;


function formatSec(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.round(sec / 60)}m`;
}

function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function formatPct(n: number | null): string {
  if (n === null) return "—";
  return `${Math.round(n * 100)}%`;
}

export default async function DashboardPage() {
  if (!(await isDashboardAuthed())) {
    redirect("/dashboard/login");
  }

  const [metrics, noCalls, recentCalls] = await Promise.all([
    getDashboardMetrics(),
    getRecentNoCalls(8),
    listCallsForDashboard(20),
  ]);

  return (
    <div className="dashShell">
      <header className="dashHeader">
        <h1>Aangan Dashboard</h1>
        <LogoutButton />
      </header>

      <main className="dashMain">
        <section className="section">
          <h2>Speed &amp; coverage</h2>
          <div className="tileGrid">
            <div className="tile">
              <div className="label">Calls answered by AI</div>
              <div className="value">{metrics.speed.totalCalls}</div>
              <div className="sub">every call that reaches Vaani is logged here</div>
            </div>
            <div className="tile">
              <div className="label">After-hours share</div>
              <div className="value">{formatPct(metrics.speed.afterHoursShare)}</div>
              <div className="sub">{metrics.speed.afterHoursCalls} of {metrics.speed.totalCalls} calls</div>
            </div>
            <div className="tile">
              <div className="label">Call end → email sent</div>
              <div className="value">{formatSec(metrics.speed.notificationLatencySecP50)}</div>
              <div className="sub">p50 · p95 {formatSec(metrics.speed.notificationLatencySecP95)}</div>
            </div>
            <div className="tile">
              <div className="label">Call start → booked</div>
              <div className="value">{formatSec(metrics.speed.callToBookingSecP50)}</div>
              <div className="sub">p50 · p95 {formatSec(metrics.speed.callToBookingSecP95)}</div>
            </div>
          </div>
          <p className="note">
            Context: the studio was missing roughly 48% of enquiries before this system (brief
            section 1). Every call that reaches Vaani — day or night — is now answered and logged
            here; calls the front desk itself answers during business hours never reach this
            system and aren&apos;t counted.
          </p>
        </section>

        <section className="section">
          <h2>Funnel</h2>
          <div className="tileGrid">
            <div className="tile">
              <div className="label">Yes</div>
              <div className="value">{metrics.funnel.verdictCounts.yes}</div>
            </div>
            <div className="tile">
              <div className="label">Maybe</div>
              <div className="value">{metrics.funnel.verdictCounts.maybe}</div>
            </div>
            <div className="tile">
              <div className="label">No</div>
              <div className="value">{metrics.funnel.verdictCounts.no}</div>
            </div>
            <div className="tile">
              <div className="label">Booked</div>
              <div className="value">{metrics.funnel.bookedCount}</div>
            </div>
            <div className="tile">
              <div className="label">Held</div>
              <div className="value">{metrics.funnel.outcomeCounts.held}</div>
            </div>
            <div className="tile">
              <div className="label">Won</div>
              <div className="value">{metrics.funnel.outcomeCounts.won}</div>
            </div>
          </div>

          <h2 style={{ marginTop: 20 }}>&ldquo;No&rdquo; reasons</h2>
          <table className="dashTable">
            <thead>
              <tr>
                <th>Reason code</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics.funnel.noReasonCounts).map(([code, count]) => (
                <tr key={code}>
                  <td>{code}</td>
                  <td>{count}</td>
                </tr>
              ))}
              {Object.keys(metrics.funnel.noReasonCounts).length === 0 && (
                <tr>
                  <td colSpan={2}>No &ldquo;no&rdquo; calls yet.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2 style={{ marginTop: 20 }}>Weekly sample — &ldquo;no&rdquo; calls for human review</h2>
          <table className="dashTable">
            <thead>
              <tr>
                <th>When</th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {noCalls.map((c) => (
                <tr key={c.id}>
                  <td>{c.startedAt.toLocaleString("en-IN")}</td>
                  <td>{c.reasonCode ?? "—"}</td>
                  <td>
                    <Link href={`/dashboard/calls/${c.id}`}>View transcript</Link>
                  </td>
                </tr>
              ))}
              {noCalls.length === 0 && (
                <tr>
                  <td colSpan={3}>Nothing to review yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="section">
          <h2>Cost</h2>
          <div className="tileGrid">
            <div className="tile">
              <div className="label">Total cost</div>
              <div className="value">{formatInr(metrics.cost.totalCostInr)}</div>
            </div>
            <div className="tile">
              <div className="label">Per call</div>
              <div className="value">{formatInr(metrics.cost.costPerCallInr)}</div>
            </div>
            <div className="tile">
              <div className="label">Per qualified lead</div>
              <div className="value">{formatInr(metrics.cost.costPerQualifiedLeadInr)}</div>
            </div>
            <div className="tile">
              <div className="label">Per booking</div>
              <div className="value">{formatInr(metrics.cost.costPerBookingInr)}</div>
            </div>
          </div>
          <p className="note">
            Voice cost is computed from real call duration × <code>VOICE_COST_INR_PER_MIN</code>.
            Gemini token cost is <strong>not tracked</strong> yet — classification calls don&apos;t
            record token usage — so it is not included above rather than estimated. See
            DECISIONS.md.
          </p>
        </section>

        <section className="section">
          <h2>Value</h2>
          <div className="tileGrid">
            <div className="tile">
              <div className="label">Won (actual)</div>
              <div className="value">{formatInr(metrics.value.actualWonInr)}</div>
            </div>
            <div className="tile">
              <div className="label">Pipeline (estimate)</div>
              <div className="value">
                {formatInr(metrics.value.pipelineEstimate.low)}–{formatInr(metrics.value.pipelineEstimate.high)}
              </div>
              <div className="sub">{metrics.value.pipelineEstimate.openDealsCount} open bookings, avg project range</div>
            </div>
          </div>
          <p className="note">Actual and estimate are kept as separate figures on purpose — never combined into one number.</p>
        </section>

        <section className="section">
          <h2>Operational health</h2>
          <div className="tileGrid">
            <div className="tile">
              <div className="label">HubSpot failed</div>
              <div className="value">
                {metrics.operational.hubspotFailedCount}
                {metrics.operational.hubspotFailedCount > 0 && <span className="badge badgeBad" style={{ marginLeft: 8 }}>check</span>}
              </div>
            </div>
            <div className="tile">
              <div className="label">HubSpot retrying</div>
              <div className="value">{metrics.operational.hubspotRetryingCount}</div>
            </div>
            <div className="tile">
              <div className="label">Email failed</div>
              <div className="value">{metrics.operational.notificationFailedCount}</div>
            </div>
            <div className="tile">
              <div className="label">Price guard hits</div>
              <div className="value">{metrics.operational.priceGuardViolationCount}</div>
            </div>
            <div className="tile">
              <div className="label">Flagged for human</div>
              <div className="value">{metrics.operational.humanFollowupCount}</div>
            </div>
            <div className="tile">
              <div className="label">Partial / unclear answers</div>
              <div className="value">{metrics.operational.unclearAnswerCallsCount}</div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2>Recent calls</h2>
          <table className="dashTable">
            <thead>
              <tr>
                <th>When</th>
                <th>Phone</th>
                <th>Status</th>
                <th>After hours</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentCalls.map((c) => (
                <tr key={c.id}>
                  <td>{c.startedAt.toLocaleString("en-IN")}</td>
                  <td>{c.callerPhone}</td>
                  <td>
                    {c.status}
                    {c.humanFollowup && (
                      <span className="badge badgeWarn" style={{ marginLeft: 6 }}>
                        follow-up
                      </span>
                    )}
                  </td>
                  <td>{c.afterHours ? "yes" : "no"}</td>
                  <td>
                    <Link href={`/dashboard/calls/${c.id}`}>Details</Link>
                  </td>
                </tr>
              ))}
              {recentCalls.length === 0 && (
                <tr>
                  <td colSpan={5}>No calls logged yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
