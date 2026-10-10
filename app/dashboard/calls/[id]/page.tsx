import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { isDashboardAuthed } from "@/lib/api/dashboard-auth";
import { getCallDetail } from "@/lib/domain/dashboard-metrics";
import {
  OUTCOME_LABELS,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  parseTranscript,
  reasonLabel,
  strongestOutcome,
} from "@/lib/domain/dashboard-format";
import DashShell from "../../_components/DashShell";
import { Avatar, FlashMessage, Icon, OutcomePill, Pill } from "../../_components/ui";
import { logOutcomeAction, resolveFollowupAction } from "../../actions";

export const metadata: Metadata = { title: "Enquiry · Aangan Studio" };
export const instant = false;

const FACT_LABELS: Array<[string, string]> = [
  ["propertyType", "Property"],
  ["area", "Location"],
  ["sizeSqFt", "Size (sq ft)"],
  ["workType", "Scope of work"],
  ["timeline", "Timeline"],
  ["budget", "Budget"],
  ["decisionMaker", "Decision-maker"],
  ["email", "Email"],
];

type StepState = "done" | "pending" | "bad" | "warn";

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className={`step step-${state}`}>
      <span className="stepMark">
        {state === "done" && <Icon name="check" size={13} />}
        {state === "bad" && <Icon name="alert" size={13} />}
        {state === "warn" && <Icon name="alert" size={13} />}
      </span>
      <div>
        <div className="stepTitle">{title}</div>
        {children && <div className="stepSub">{children}</div>}
      </div>
    </li>
  );
}

function speakerLabel(kind: "agent" | "caller", speaker: string, callerName: string | null): string {
  if (kind === "caller") return callerName ?? (/^(caller|user|customer|client)/i.test(speaker) ? "Caller" : speaker);
  return /^(agent|ai|assistant|bot)/i.test(speaker) ? "Assistant" : speaker;
}

export default async function CallDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  // The detail view renders times relative to now and reads the DB per request.
  await connection();

  if (!(await isDashboardAuthed())) {
    redirect("/dashboard/login");
  }

  const { id } = await params;
  const sp = await searchParams;
  const detail = await getCallDetail(id);
  if (!detail) {
    notFound();
  }

  const { call, name, answers, answerMap, classification, booking, designerName, notifications, hubspotSync, hubspotUrl, outcomes, followupOpen } = detail;

  const hasPhone = call.callerPhone && call.callerPhone !== "unknown";
  const display = name ?? (hasPhone ? call.callerPhone : "Unknown caller");
  const confirmed = booking && booking.status === "confirmed" ? booking : undefined;
  const verdict = classification?.verdict;
  const unclearFields = new Set(answers.filter((a) => a.unclear).map((a) => a.field));
  const transcript = parseTranscript(call.transcript);
  const bestOutcome = strongestOutcome(outcomes);
  const emailNote = notifications.find((n) => n.channel === "email");

  // --- the assessment, in plain words
  let assessment: { icon: "checkCircle" | "alert" | "phone"; tone: "good" | "warn" | "neutral"; label: string; body: string };
  if (classification) {
    const label =
      verdict === "yes"
        ? "Qualified for a consultation"
        : verdict === "maybe"
          ? "Maybe — worth a closer look"
          : `Declined — ${reasonLabel(classification.reasonCode).toLowerCase()}`;
    const missing = (classification.missingFields ?? []).filter(Boolean);
    assessment = {
      icon: verdict === "yes" ? "checkCircle" : "alert",
      tone: verdict === "yes" ? "good" : verdict === "maybe" ? "warn" : "neutral",
      label,
      body: classification.reason + (missing.length ? ` Still unknown: ${missing.join(", ")}.` : ""),
    };
  } else if (call.status === "missed") {
    assessment = { icon: "phone", tone: "warn", label: "Missed call", body: "Nobody left a message, so there was no conversation to assess." };
  } else if (call.status === "dropped") {
    assessment = { icon: "phone", tone: "warn", label: "Call dropped", body: "The line was lost before the assistant could qualify this caller." };
  } else {
    assessment = { icon: "alert", tone: "warn", label: "Not assessed", body: "The call ended before the assistant could qualify it — a person should take a look." };
  }

  const facts = FACT_LABELS.filter(([field]) => answerMap[field]);

  return (
    <DashShell active="enquiries">
      <main className="page">
        <Link href="/dashboard/enquiries" className="back">
          <Icon name="back" size={15} /> All enquiries
        </Link>

        <div className="detailHead">
          <div>
            <div className="detailTitleRow">
              <Avatar name={name} />
              <div>
                <h1 className="pageTitle">{display}</h1>
                <div className="pageSub">
                  {hasPhone && name && (
                    <>
                      <a href={`tel:${call.callerPhone.replace(/[^\d+]/g, "")}`}>{call.callerPhone}</a> ·{" "}
                    </>
                  )}
                  {formatDateTime(call.startedAt)}
                  {call.durationSec ? ` · ${formatDuration(call.durationSec)} call` : ""}
                </div>
              </div>
            </div>
            <div className="detailMeta">
              {verdict === "yes" && <Pill tone="good">Qualified</Pill>}
              {verdict === "maybe" && <Pill tone="warn">Maybe</Pill>}
              {verdict === "no" && <Pill>Declined</Pill>}
              {bestOutcome && <OutcomePill outcome={bestOutcome.outcome} />}
              {call.afterHours && (
                <Pill tone="brand" plain>
                  After hours
                </Pill>
              )}
              {followupOpen && <Pill tone="warn">Needs follow-up</Pill>}
            </div>
          </div>

          <div className="detailActions">
            {followupOpen && (
              <form action={resolveFollowupAction}>
                <input type="hidden" name="callId" value={call.id} />
                <input type="hidden" name="returnTo" value={`/dashboard/calls/${call.id}`} />
                <button type="submit" className="btn">
                  <Icon name="check" size={15} /> Mark handled
                </button>
              </form>
            )}
            {confirmed?.meetUrl && (
              <a className="btn" href={confirmed.meetUrl} target="_blank" rel="noreferrer">
                <Icon name="video" size={15} /> Meeting link
              </a>
            )}
            {hubspotUrl && (
              <a className="btn btnPrimary" href={hubspotUrl} target="_blank" rel="noreferrer">
                Open in HubSpot <Icon name="external" size={14} />
              </a>
            )}
          </div>
        </div>

        <div className="detailGrid">
          <div className="stack">
            <section className="card">
              <div className="assessment">
                <span className={`attnIcon attnIcon-${assessment.tone}`}>
                  <Icon name={assessment.icon} size={17} />
                </span>
                <div className="assessmentBody">
                  <div className="assessmentLabel">{assessment.label}</div>
                  <p className="assessmentReason">{assessment.body}</p>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="cardHead">
                <h2 className="cardTitle">Project brief</h2>
                <span className="cardSub">As captured on the call</span>
              </div>
              {facts.length === 0 ? (
                <p className="chatEmpty">No details were captured on this call.</p>
              ) : (
                <dl className="facts">
                  {facts.map(([field, label]) => (
                    <div key={field} className={`fact${field === "workType" || field === "decisionMaker" ? " factWide" : ""}`}>
                      <dt>{label}</dt>
                      <dd>
                        {answerMap[field]}
                        {unclearFields.has(field) && (
                          <>
                            {" "}
                            <Pill tone="warn" plain>
                              unclear
                            </Pill>
                          </>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section className="card">
              <div className="cardHead">
                <h2 className="cardTitle">Conversation</h2>
                {transcript.title && <span className="cardSub">{transcript.title}</span>}
              </div>
              {transcript.turns.length === 0 ? (
                <p className="chatEmpty">No transcript was recorded for this call.</p>
              ) : (
                <div className="chat">
                  {transcript.turns.map((turn, i) =>
                    turn.kind === "caption" ? (
                      <div key={i} className="chatCaption">
                        {turn.text}
                      </div>
                    ) : turn.kind === "note" ? (
                      <div key={i} className="chatNote">
                        {turn.text}
                      </div>
                    ) : (
                      <div key={i} className={`turn ${turn.kind === "agent" ? "turnAgent" : "turnCaller"}`}>
                        <span className="turnWho">{speakerLabel(turn.kind, turn.speaker, name)}</span>
                        <span className="bubble">{turn.text}</span>
                      </div>
                    )
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="stack">
            <section className="card">
              <div className="cardHead">
                <h2 className="cardTitle">Progress</h2>
              </div>
              <ol className="steps">
                <Step state="done" title="Call received">
                  {formatDateTime(call.startedAt)}
                  {call.afterHours ? " · after hours" : ""}
                </Step>

                {classification ? (
                  <Step state="done" title={verdict === "no" ? "Declined" : verdict === "maybe" ? "Qualified (maybe)" : "Qualified"}>
                    {verdict === "no" ? reasonLabel(classification.reasonCode) : "Assistant assessed the enquiry"}
                  </Step>
                ) : (
                  <Step state="warn" title={call.status === "missed" ? "Missed — no conversation" : call.status === "dropped" ? "Dropped before qualifying" : "Not qualified"}>
                    Needs a person
                  </Step>
                )}

                {classification && verdict !== "no" &&
                  (confirmed ? (
                    <Step state="done" title="Consultation booked">
                      {confirmed.startAt ? `${formatDate(confirmed.startAt)} · ${formatTime(confirmed.startAt)}` : "Time to be confirmed"}
                      {designerName ? ` with ${designerName}` : ""}
                    </Step>
                  ) : (
                    <Step state="warn" title="No consultation booked">
                      Qualified, but no slot was confirmed
                    </Step>
                  ))}

                {confirmed && (
                  <>
                    <Step
                      state={emailNote?.status === "failed" ? "bad" : emailNote && emailNote.status !== "pending" ? "done" : "pending"}
                      title="Designer emailed"
                    >
                      {!emailNote
                        ? "Not sent"
                        : emailNote.status === "failed"
                          ? "Failed to send"
                          : emailNote.sentAt
                            ? `Sent ${formatTime(emailNote.sentAt)}${emailNote.acknowledgedAt ? " · acknowledged" : ""}`
                            : "Queued"}
                    </Step>

                    <Step
                      state={hubspotSync?.status === "synced" ? "done" : hubspotSync?.status === "failed" ? "bad" : hubspotSync ? "warn" : "pending"}
                      title="Synced to HubSpot"
                    >
                      {!hubspotSync ? (
                        "Not yet"
                      ) : hubspotSync.status === "synced" ? (
                        hubspotUrl ? (
                          <a href={hubspotUrl} target="_blank" rel="noreferrer">
                            View deal
                          </a>
                        ) : (
                          "Synced"
                        )
                      ) : hubspotSync.status === "failed" ? (
                        "Sync failed"
                      ) : (
                        "Retrying"
                      )}
                    </Step>

                    <Step state={bestOutcome ? "done" : "pending"} title={bestOutcome ? (OUTCOME_LABELS[bestOutcome.outcome] ?? bestOutcome.outcome) : "Awaiting outcome"}>
                      {bestOutcome?.outcome === "won" && bestOutcome.amountInr
                        ? `₹${Number(bestOutcome.amountInr).toLocaleString("en-IN")}`
                        : bestOutcome
                          ? "Recorded"
                          : "Log how the consultation went"}
                    </Step>
                  </>
                )}
              </ol>
            </section>

            {confirmed && (
              <section className="card" id="outcome">
                <div className="cardHead">
                  <h2 className="cardTitle">How did the consultation go?</h2>
                </div>
                <p className="helper">Updates the dashboard and the deal stage in HubSpot.</p>
                {sp.saved === "outcome" && <FlashMessage tone="good">Saved.</FlashMessage>}
                {sp.error === "amount" && <FlashMessage tone="bad">Enter a valid deal amount greater than zero.</FlashMessage>}

                {outcomes.length > 0 && (
                  <div className="detailMeta" style={{ marginBottom: 12 }}>
                    {outcomes.map((o) => (
                      <span key={o.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <OutcomePill outcome={o.outcome} />
                        {o.amountInr ? <span className="cellMuted">₹{Number(o.amountInr).toLocaleString("en-IN")}</span> : null}
                      </span>
                    ))}
                  </div>
                )}

                <div className="outcomeBtns">
                  {(["held", "no_show", "not_fit"] as const).map((outcome) => (
                    <form key={outcome} action={logOutcomeAction}>
                      <input type="hidden" name="callId" value={call.id} />
                      <input type="hidden" name="bookingId" value={confirmed.id} />
                      <input type="hidden" name="outcome" value={outcome} />
                      <button type="submit" className="btn">
                        {OUTCOME_LABELS[outcome]}
                      </button>
                    </form>
                  ))}
                  <details className="wonBox" open={sp.error === "amount"}>
                    <summary className="btn btnGood">Won…</summary>
                    <form className="wonForm" action={logOutcomeAction}>
                      <input type="hidden" name="callId" value={call.id} />
                      <input type="hidden" name="bookingId" value={confirmed.id} />
                      <input type="hidden" name="outcome" value="won" />
                      <input type="text" name="amount" inputMode="numeric" placeholder="Deal amount in ₹" aria-label="Deal amount in rupees" required />
                      <button type="submit" className="btn btnPrimary">
                        Save
                      </button>
                    </form>
                  </details>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </DashShell>
  );
}
