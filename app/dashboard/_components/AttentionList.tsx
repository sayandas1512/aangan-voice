import Link from "next/link";
import { timeAgo } from "@/lib/domain/dashboard-format";
import { OWNER_LABELS } from "@/lib/domain/followup";
import type { AttentionItem } from "@/lib/domain/dashboard-metrics";
import { resolveFollowupAction } from "../actions";
import { Icon } from "./ui";

const KIND_ICON = { system: "alert", followup: "phone", outcome: "calendar" } as const;

export default function AttentionList({ items, limit = 6 }: { items: AttentionItem[]; limit?: number }) {
  if (items.length === 0) {
    return (
      <div className="allClear">
        <Icon name="checkCircle" size={22} />
        <span>All clear — nothing is waiting on anyone.</span>
      </div>
    );
  }

  const shown = items.slice(0, limit);
  const hidden = items.length - shown.length;
  const now = new Date();

  return (
    <div className="attnList">
      {shown.map((item) => (
        <div key={item.key} className="attnItem">
          <span className={`attnIcon attnIcon-${item.tone === "bad" ? "bad" : item.tone === "info" ? "info" : "warn"}`}>
            <Icon name={KIND_ICON[item.kind]} size={16} />
          </span>

          <div className="attnBody">
            <div>
              <span className="attnTitle">{item.title}</span>
              <span className="attnWhen">{item.kind === "outcome" ? "" : timeAgo(item.when, now)}</span>
            </div>
            <div className="attnOwner">
              Owner: <strong>{OWNER_LABELS[item.owner]}{item.ownerName ? ` · ${item.ownerName}` : ""}</strong>
            </div>
            <div className="attnDetail">{item.detail}</div>
            {item.preview && <div className="attnQuote">&ldquo;{item.preview}&rdquo;</div>}
          </div>

          <div className="attnActions">
            {item.resolvable && (
              <form action={resolveFollowupAction}>
                <input type="hidden" name="callId" value={item.callId} />
                <input type="hidden" name="returnTo" value="/dashboard" />
                <button type="submit" className="btn btnSm">
                  Mark handled
                </button>
              </form>
            )}
            <Link
              href={`/dashboard/calls/${item.callId}${item.kind === "outcome" ? "#outcome" : ""}`}
              className="btn btnSm btnPrimary"
            >
              {item.actionLabel}
            </Link>
          </div>
        </div>
      ))}
      {hidden > 0 && <div className="moreNote">+ {hidden} more — they&apos;ll appear here as the ones above are dealt with.</div>}
    </div>
  );
}
