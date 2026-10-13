import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Icon } from "@/components/Icon";
import { gate } from "@/lib/admin";
import { kindNames, linkLabel } from "@/lib/hostile-form";
import { getPiracyReports, type PiracyReport } from "@/lib/piracy";
import { KEEP_MONTHS, stateNames } from "@/lib/piracy-form";
import { CloseForms, DeleteForm, ReopenForm } from "./ReportTools";

export const metadata: Metadata = {
  title: "Piracy reports",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Piracy <strong>reports</strong>
  </>
);

export default function PiracyReportsPage() {
  return (
    <Suspense fallback={<AdminHead current="piracy" tier={null} title={title} lead="Reading the reports." />}>
      <Reports />
    </Suspense>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const day = (date: string) => dayFormat.format(new Date(date.length === 10 ? `${date}T00:00:00Z` : date));
const dayAndTime = (date: string) => `${day(date)}, ${timeFormat.format(new Date(date))} UTC`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function Reports() {
  const access = await gate("command", "/admin/piracy");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="piracy" title={title} />;
  const loaded = await getPiracyReports();
  if (loaded.state !== "ready") return <AdminShut access={loaded} current="piracy" title={title} />;

  const { waiting, closed, names } = loaded;
  const who = (id: string | null) => (id ? (names[id] ?? "someone who has left") : "nobody on record");
  const now = waiting.filter((report) => report.urgent).length;

  const card = (report: PiracyReport) => {
    const open = report.state === "new";
    return (
      <li className={`hostile ${open ? (report.urgent ? "hostile-hostile" : "hostile-watch") : "hostile-off"}`} key={report.id} id={`report-${report.id}`}>
        <div className="hostile-head">
          <h3>
            <span className="hostile-handle">{report.reporterHandle}</span>
            <span className="hostile-name">{report.location}</span>
          </h3>
          <p className="hostile-chips">
            {report.urgent ? (
              <span className={`chip chip-icon ${open ? "chip-red" : ""}`}>
                <Icon name="warning" size={14} />
                {open ? "Marked as happening now" : "Was marked as happening now"}
              </span>
            ) : null}
            {open ? null : <span className="chip">{stateNames[report.state]}</span>}
          </p>
        </div>

        {/* A stranger's words, shown as the plain text they are. Nothing in them is a link or formatting. */}
        <p className="report-words">{report.details}</p>

        {report.evidence.length > 0 ? (
          <ul className="hostile-evidence" aria-label={`Links sent by ${report.reporterHandle}`}>
            {report.evidence.map((address, index) => (
              <li key={`${index}-${address}`}>
                <Icon name="link" size={14} />
                <a href={address} rel="noopener noreferrer nofollow" target="_blank">
                  {linkLabel(address)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="hostile-facts">
          <div>
            <dt>Received</dt>
            <dd>{dayAndTime(report.receivedAt)}</dd>
          </div>
          <div>
            <dt>Happened</dt>
            <dd>{day(report.happenedOn)}</dd>
          </div>
          <div>
            <dt>Names</dt>
            <dd>
              {report.suspectKind ? (
                <>
                  {kindNames[report.suspectKind]} <span className="hostile-handle">{report.suspectHandle}</span>
                  {report.known ? (
                    <span className="aside">
                      {" "}
                      <Link href={report.known.href}>{report.known.words} on the hostile list</Link>
                    </span>
                  ) : null}
                </>
              ) : (
                "Nobody"
              )}
            </dd>
          </div>
          {report.entries.length > 0 ? (
            <div>
              <dt>Entries started</dt>
              <dd>
                {report.entries.map((entry, index) => (
                  <span key={entry.id}>
                    {index > 0 ? ", " : null}
                    <Link href={entry.href}>{entry.handle}</Link> <span className="aside">{entry.words}</span>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {report.event ? (
            <div>
              <dt>Response</dt>
              <dd>
                <Link href={`/operations/${report.event.id}`}>{report.event.title}</Link>
              </dd>
            </div>
          ) : null}
          {report.handledAt ? (
            <div>
              <dt>{report.state === "dismissed" ? "Dismissed" : "Handled"}</dt>
              <dd>
                {day(report.handledAt)}, by {who(report.handledBy)}
              </dd>
            </div>
          ) : null}
          {report.outcomeNote ? (
            <div>
              <dt>Command said</dt>
              <dd>{report.outcomeNote}</dd>
            </div>
          ) : null}
        </dl>

        <div className="decisions">
          {open ? (
            <>
              <Link className="button button-quiet" href={`/hostiles?tab=forward&report=${report.id}`}>
                Start a hostile-list entry
              </Link>
              {report.event ? null : (
                <Link className="button button-quiet" href={`/operations/new?report=${report.id}`}>
                  Draft a Response event
                </Link>
              )}
              <CloseForms id={report.id} from={report.reporterHandle} />
            </>
          ) : (
            <ReopenForm id={report.id} />
          )}
          <DeleteForm id={report.id} from={report.reporterHandle} />
        </div>
      </li>
    );
  };

  return (
    <>
      <AdminHead
        current="piracy"
        tier={access.tier}
        title={title}
        lead={
          waiting.length > 0
            ? `${count(waiting.length, "report waits", "reports wait")} for command${now > 0 ? `, ${now} marked as happening now` : ""}.`
            : "No report is waiting."
        }
      >
        <p className="actions">
          <Link className="button button-quiet" href="/piracy">
            The public form
          </Link>
        </p>
      </AdminHead>

      <section className="wrap band" aria-labelledby="waiting">
        <h2 id="waiting">
          Waiting for <strong>command</strong>
        </h2>
        <p className="intro">
          Anyone may send a report, and nothing in one has been checked. Treat it as one side of a story. Only command reads these, and
          a report leaves this page {KEEP_MONTHS} months after it arrives.
        </p>
        {waiting.length > 0 ? <ul className="hostiles">{waiting.map(card)}</ul> : <p className="empty">Nothing is waiting.</p>}
      </section>

      <section className="wrap band band-last" aria-labelledby="closed">
        <h2 id="closed">
          Handled and <strong>dismissed</strong>
        </h2>
        {closed.length > 0 ? <ul className="hostiles">{closed.map(card)}</ul> : <p className="empty">No report has been closed yet.</p>}
      </section>
    </>
  );
}
