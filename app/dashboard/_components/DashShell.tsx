import Link from "next/link";
import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { RANGE_LABELS, type RangeKey } from "@/lib/domain/dashboard-format";
import LogoutButton from "../LogoutButton";
import "../dashboard.css";

// One shared login (see DASHBOARD_REQUIRE_PASSWORD) with one owner, so this is
// a fixed label rather than a per-user lookup.
const FOUNDER = { name: "Nikhil Deshpande", role: "Founder" };

const RANGE_ORDER: RangeKey[] = ["7d", "30d", "all"];

interface DashShellProps {
  active: "overview" | "enquiries" | null;
  /** When provided, shows the date-range switcher; each value is the full href to link to. */
  range?: { current: RangeKey; hrefs: Record<RangeKey, string> };
  children: ReactNode;
}

export default function DashShell({ active, range, children }: DashShellProps) {
  return (
    <div className="dashShell">
      <header className="topbar">
        <div className="topbarInner">
          <Link href="/dashboard" className="brand">
            <span className="brandMark">A</span>
            <span>
              Aangan Studio <span className="brandSub">· Enquiry Responder</span>
            </span>
          </Link>

          <nav className="nav" aria-label="Dashboard sections">
            <Link href="/dashboard" className={`navLink${active === "overview" ? " navLinkActive" : ""}`}>
              Overview
            </Link>
            <Link href="/dashboard/enquiries" className={`navLink${active === "enquiries" ? " navLinkActive" : ""}`}>
              Enquiries
            </Link>
          </nav>

          <span className="topbarSpacer" />

          <div className="topbarActions">
            {range && (
              <div className="seg" role="group" aria-label="Date range">
                {RANGE_ORDER.map((key) => (
                  <Link
                    key={key}
                    href={range.hrefs[key]}
                    className={`segItem${range.current === key ? " segItemActive" : ""}`}
                    aria-current={range.current === key ? "true" : undefined}
                  >
                    {RANGE_LABELS[key]}
                  </Link>
                ))}
              </div>
            )}
            <div className="whoami" title={`Signed in as ${FOUNDER.name}`}>
              <span className="whoamiAvatar" aria-hidden="true">
                {FOUNDER.name.charAt(0)}
              </span>
              <span className="whoamiText">
                <span className="whoamiName">{FOUNDER.name}</span>
                <span className="whoamiRole">{FOUNDER.role}</span>
              </span>
            </div>
            {env.DASHBOARD_REQUIRE_PASSWORD && <LogoutButton />}
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
