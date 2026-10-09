import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { isDashboardAuthed } from "@/lib/api/dashboard-auth";
import { getCallDetail } from "@/lib/domain/dashboard-metrics";
import LogoutButton from "../../LogoutButton";
import "../../dashboard.css";

// See app/dashboard/page.tsx — same reasoning, opts this route out of
// Cache Components' static-shell validation.
export const instant = false;


export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isDashboardAuthed())) {
    redirect("/dashboard/login");
  }

  const { id } = await params;
  const detail = await getCallDetail(id);
  if (!detail) {
    notFound();
  }

  const { call, answers, classification, booking, notifications, hubspotSync, outcomes } = detail;

  return (
    <div className="dashShell">
      <header className="dashHeader">
        <h1>Call detail</h1>
        <LogoutButton />
      </header>

      <main className="dashMain">
        <p style={{ marginBottom: 16 }}>
          <Link href="/dashboard">← Back to dashboard</Link>
        </p>

        <div className="detailGrid">
          <div className="detailBlock">
            <h3>Call</h3>
            <div>Phone: {call.callerPhone}</div>
            <div>Started: {call.startedAt.toLocaleString("en-IN")}</div>
            <div>Status: {call.status}</div>
            <div>After hours: {call.afterHours ? "yes" : "no"}</div>
            <div>Human follow-up: {call.humanFollowup ? "yes" : "no"}</div>
          </div>

          <div className="detailBlock">
            <h3>Classification</h3>
            {classification ? (
              <>
                <div>Verdict: {classification.verdict}</div>
                <div>Reason: {classification.reason}</div>
                {classification.reasonCode && <div>Reason code: {classification.reasonCode}</div>}
              </>
            ) : (
              <div>Not classified (call ended before mid-call classify ran).</div>
            )}
          </div>

          <div className="detailBlock">
            <h3>Booking</h3>
            {booking ? (
              <>
                <div>Status: {booking.status}</div>
                {booking.startAt && <div>When: {booking.startAt.toLocaleString("en-IN")}</div>}
                {booking.meetUrl && (
                  <div>
                    Meet:{" "}
                    <a href={booking.meetUrl} target="_blank" rel="noreferrer">
                      link
                    </a>
                  </div>
                )}
              </>
            ) : (
              <div>No booking for this call.</div>
            )}
          </div>

          <div className="detailBlock">
            <h3>Designer email</h3>
            {notifications.length > 0 ? (
              notifications.map((n) => (
                <div key={n.id}>
                  {n.channel}: {n.status}
                  {n.sentAt && ` · sent ${n.sentAt.toLocaleTimeString("en-IN")}`}
                  {n.acknowledgedAt && ` · acknowledged`}
                </div>
              ))
            ) : (
              <div>No notification sent.</div>
            )}
          </div>

          <div className="detailBlock">
            <h3>HubSpot sync</h3>
            {hubspotSync ? (
              <>
                <div>Status: {hubspotSync.status}</div>
                {hubspotSync.dealId && <div>Deal: {hubspotSync.dealId}</div>}
                {hubspotSync.lastError && <div>Last error: {hubspotSync.lastError}</div>}
              </>
            ) : (
              <div>Not synced (verdict was &ldquo;no&rdquo;, or not yet attempted).</div>
            )}
          </div>

          <div className="detailBlock">
            <h3>Outcomes</h3>
            {outcomes.length > 0 ? (
              outcomes.map((o) => (
                <div key={o.id}>
                  {o.outcome}
                  {o.amountInr && ` — ₹${Number(o.amountInr).toLocaleString("en-IN")}`}
                </div>
              ))
            ) : (
              <div>No outcome recorded yet.</div>
            )}
          </div>
        </div>

        <div className="detailBlock" style={{ marginBottom: 20 }}>
          <h3>Answers collected</h3>
          <table className="dashTable">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {answers.map((a) => (
                <tr key={a.id}>
                  <td>{a.field}</td>
                  <td>
                    {a.value}
                    {a.unclear && (
                      <span className="badge badgeWarn" style={{ marginLeft: 6 }}>
                        unclear
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {answers.length === 0 && (
                <tr>
                  <td colSpan={2}>No structured answers captured.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dash-muted)" }}>
          Transcript
        </h2>
        <div className="transcript">{call.transcript || "No transcript recorded."}</div>
      </main>
    </div>
  );
}
