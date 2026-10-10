import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isDashboardAuthed } from "@/lib/api/dashboard-auth";
import { buildEnquiryRows, loadSnapshot, type EnquiryRow } from "@/lib/domain/dashboard-metrics";
import { RANGE_LABELS, parseRange, rangeSince, reasonLabel, type RangeKey } from "@/lib/domain/dashboard-format";
import DashShell from "../_components/DashShell";
import EnquiryTable from "../_components/EnquiryTable";
import { Icon } from "../_components/ui";

export const metadata: Metadata = { title: "Enquiries · Aangan Studio" };
export const instant = false;

const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "qualified", label: "Qualified", test: (r: EnquiryRow) => r.verdict === "yes" || r.verdict === "maybe" },
  { key: "booked", label: "Booked", test: (r: EnquiryRow) => r.booking !== null },
  { key: "declined", label: "Declined", test: (r: EnquiryRow) => r.verdict === "no" },
  { key: "followup", label: "Needs follow-up", test: (r: EnquiryRow) => r.needsFollowup },
  { key: "missed", label: "Missed / dropped", test: (r: EnquiryRow) => r.status === "missed" || r.status === "dropped" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function hrefFor(params: { f?: FilterKey; q?: string; range?: RangeKey }): string {
  const qs = new URLSearchParams();
  if (params.f && params.f !== "all") qs.set("f", params.f);
  if (params.q) qs.set("q", params.q);
  if (params.range && params.range !== "all") qs.set("range", params.range);
  const s = qs.toString();
  return `/dashboard/enquiries${s ? `?${s}` : ""}`;
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; range?: string }>;
}) {
  // Reads the clock and the DB on every request — tell Next.js 16 (Cache Components)
  // this is request-time rendering, or `new Date()` below fails prerender validation.
  await connection();

  if (!(await isDashboardAuthed())) {
    redirect("/dashboard/login");
  }

  const sp = await searchParams;
  const range = parseRange(sp.range);
  const since = rangeSince(range);
  const activeFilter = (FILTERS.find((f) => f.key === sp.f)?.key ?? "all") as FilterKey;
  const q = (sp.q ?? "").trim().slice(0, 80);

  const snap = await loadSnapshot();
  const inRange = buildEnquiryRows(snap).filter((r) => !since || r.startedAt >= since);

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, inRange.filter(f.test).length])) as Record<FilterKey, number>;

  const needle = q.toLowerCase();
  const rows = inRange
    .filter(FILTERS.find((f) => f.key === activeFilter)!.test)
    .filter(
      (r) =>
        !needle ||
        [r.name ?? "", r.phone, r.project, r.verdict === "no" ? reasonLabel(r.reasonCode) : ""]
          .join(" ")
          .toLowerCase()
          .includes(needle)
    );

  return (
    <DashShell
      active="enquiries"
      range={{
        current: range,
        hrefs: {
          "7d": hrefFor({ f: activeFilter, q, range: "7d" }),
          "30d": hrefFor({ f: activeFilter, q, range: "30d" }),
          all: hrefFor({ f: activeFilter, q, range: "all" }),
        },
      }}
    >
      <main className="page">
        <div className="pageHead">
          <div>
            <h1 className="pageTitle">Enquiries</h1>
            <p className="pageSub">
              {rows.length} of {inRange.length} · {RANGE_LABELS[range].toLowerCase()}
            </p>
          </div>
        </div>

        <div className="toolbar">
          <nav className="chips" aria-label="Filter enquiries">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={hrefFor({ f: f.key, q, range })}
                className={`chip${activeFilter === f.key ? " chipActive" : ""}`}
                aria-current={activeFilter === f.key ? "true" : undefined}
              >
                {f.label} <span className="chipCount">{counts[f.key]}</span>
              </Link>
            ))}
          </nav>

          <form className="search" action="/dashboard/enquiries" method="get" role="search">
            <Icon name="search" size={15} />
            {activeFilter !== "all" && <input type="hidden" name="f" value={activeFilter} />}
            {range !== "all" && <input type="hidden" name="range" value={range} />}
            <input type="search" name="q" defaultValue={q} placeholder="Search name, phone, area…" aria-label="Search enquiries" />
          </form>
        </div>

        <section className="card">
          <EnquiryTable
            rows={rows}
            emptyMessage={q || activeFilter !== "all" ? "Nothing matches these filters." : "No enquiries in this period yet."}
          />
        </section>
      </main>
    </DashShell>
  );
}
