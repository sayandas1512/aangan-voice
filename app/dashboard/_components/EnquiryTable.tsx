import Link from "next/link";
import { formatDate, formatDateTime, formatTime } from "@/lib/domain/dashboard-format";
import type { EnquiryRow } from "@/lib/domain/dashboard-metrics";
import { Avatar, Icon, OutcomePill, Pill, ResultCell } from "./ui";

export default function EnquiryTable({ rows, emptyMessage }: { rows: EnquiryRow[]; emptyMessage: string }) {
  return (
    <div className="tableWrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Enquiry</th>
            <th className="hideSm">Project</th>
            <th>Result</th>
            <th className="hideSm">Consultation</th>
            <th className="hideSm">Outcome</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="emptyRow">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const display = row.name ?? (row.phone !== "unknown" ? row.phone : "Unknown caller");
            return (
              <tr key={row.id}>
                <td>
                  <div className="person">
                    <Avatar name={row.name} />
                    <div>
                      <Link href={`/dashboard/calls/${row.id}`} className="personName rowLink">
                        {display}
                      </Link>
                      <div className="personSub">{row.name && row.phone !== "unknown" ? row.phone : " "}</div>
                      {row.needsFollowup && (
                        <div className="rowTags">
                          <Pill tone="warn" plain>
                            Follow up
                          </Pill>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="hideSm cellMuted">{row.project}</td>
                <td>
                  <ResultCell row={row} />
                </td>
                <td className="hideSm">
                  {row.booking?.startAt ? (
                    <>
                      <div>{formatDate(row.booking.startAt)}</div>
                      <div className="cellSub">
                        {formatTime(row.booking.startAt)}
                        {row.booking.designerName ? ` · ${row.booking.designerName}` : ""}
                      </div>
                    </>
                  ) : (
                    <span className="cellMuted">—</span>
                  )}
                </td>
                <td className="hideSm">
                  {row.outcome ? (
                    <>
                      <OutcomePill outcome={row.outcome} />
                      {row.wonAmountInr ? <div className="cellSub">₹{row.wonAmountInr.toLocaleString("en-IN")}</div> : null}
                    </>
                  ) : row.booking ? (
                    <span className="cellMuted">Awaiting</span>
                  ) : (
                    <span className="cellMuted">—</span>
                  )}
                </td>
                <td>
                  <div>{formatDateTime(row.startedAt)}</div>
                  {row.afterHours && (
                    <div className="cellSub" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon name="moon" size={12} /> After hours
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
