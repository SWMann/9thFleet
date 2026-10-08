import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Bars, Columns, Panel, Scroll, Stats, percent } from "@/components/admin/Charts";
import { gate, loadFleet, operations, type EventFigures } from "@/lib/admin";
import { formatDate } from "@/lib/application-form";
import { formatWhen, kindName, stateNames } from "@/lib/operations-form";

export const metadata: Metadata = {
  title: "Operations figures",
  robots: { index: false, follow: false },
};

const title = <strong>Operations</strong>;

export default function OperationsFiguresPage() {
  return (
    <Suspense fallback={<AdminHead current="operations" tier={null} title={title} lead="Reading the events." />}>
      <Figures />
    </Suspense>
  );
}

const reportNames: Record<NonNullable<EventFigures["report"]>, string> = {
  "on time": "On time",
  late: "Late",
  overdue: "Overdue",
  "not due": "Not due yet",
};

async function Figures() {
  const access = await gate("command");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="operations" title={title} />;
  const loaded = await loadFleet();
  if (loaded.state !== "ready") return <AdminShut access={loaded} current="operations" title={title} />;

  const { fleet } = loaded;
  const figures = operations(fleet);
  const reported = figures.reportsOnTime + figures.reportsLate;
  // Newest first.
  const events = [...figures.events].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const members = fleet.people
    .filter((person) => ["recruit", "auxiliary", "member", "reserve"].includes(person.status))
    .sort((a, b) => b.attended90 - a.attended90 || a.name.localeCompare(b.name));

  return (
    <>
      <AdminHead
        current="operations"
        tier={access.tier}
        title={title}
        lead={`${figures.held} ${figures.held === 1 ? "event" : "events"} held, ${figures.upcoming.length} coming up and ${figures.drafts} in draft.`}
      >
        <p className="actions">
          <Link className="button" href="/operations">
            The operations pages
          </Link>
        </p>
      </AdminHead>

      <section className="wrap band" aria-labelledby="figures">
        <h2 id="figures">
          The <strong>figures</strong>
        </h2>
        <Stats
          items={[
            { label: "Events held", value: figures.held, note: `${figures.last30} in the last 30 days` },
            { label: "Coming up", value: figures.upcoming.length, note: `${figures.drafts} more in draft` },
            { label: "Average turnout", value: percent(figures.averageTurnout), note: "Present, of those who said attending" },
            {
              label: "Reports on time",
              value: reported > 0 ? `${figures.reportsOnTime} of ${reported}` : "None yet",
              note: figures.reportsOverdue > 0 ? `${figures.reportsOverdue} overdue` : "Due within 48 hours of the start",
            },
            { label: "Cancelled", value: figures.cancelled },
          ]}
        />
        <div className="charts">
          <Panel title="Events held, week by week" note="The last eight weeks. A week starts on Monday, UTC.">
            <Columns
              caption="Events held in each of the last eight weeks"
              series={figures.perWeek}
              noun={["event", "events"]}
              empty="No event has been held in the last eight weeks."
            />
          </Panel>
          <Panel title="By type" note="Announced and held events. Drafts and cancelled events are left out.">
            <Bars
              caption="Events by type"
              head={["Type", "Events"]}
              rows={figures.byKind.map((entry) => ({ label: kindName(entry.kind), value: entry.value }))}
              empty="No event has been announced yet."
            />
          </Panel>
        </div>
      </section>

      {figures.outstanding.length > 0 ? (
        <section className="wrap band" aria-labelledby="replies">
          <h2 id="replies">
            Replies <strong>outstanding</strong>
          </h2>
          <p className="intro">Post holders who have not replied to an event that is coming up.</p>
          <ul className="attention">
            {figures.outstanding.map((event) => (
              <li key={event.id}>
                <Link href={`/operations/${event.id}`}>{event.title}</Link>
                <span>
                  {formatWhen(event.startsAt).day}.{" "}
                  {event.waitingOn.length === 0 ? "Every post holder has replied." : `Waiting on ${event.waitingOn.join(", ")}.`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="wrap band" aria-labelledby="events">
        <h2 id="events">
          Every <strong>event</strong>
        </h2>
        {events.length === 0 ? (
          <p>No event has been drafted yet.</p>
        ) : (
          <Scroll label="Every event">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">When</th>
                  <th scope="col">State</th>
                  <th scope="col" className="number">
                    Said attending
                  </th>
                  <th scope="col" className="number">
                    Stand-ins
                  </th>
                  <th scope="col" className="number">
                    Present
                  </th>
                  <th scope="col" className="number">
                    Absent, with notice
                  </th>
                  <th scope="col" className="number">
                    Absent, without
                  </th>
                  <th scope="col">Report</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <th scope="row">
                      <Link href={`/operations/${event.id}`}>{event.title}</Link>
                      <small>
                        {kindName(event.kind)} · {event.commander}
                      </small>
                    </th>
                    <td>
                      {formatWhen(event.startsAt).day}
                      <small>{formatWhen(event.startsAt).utc}</small>
                    </td>
                    <td>{stateNames[event.state]}</td>
                    <td className="number">{event.attending}</td>
                    <td className="number">{event.standIns}</td>
                    <td className="number">{event.state === "done" ? event.present : ""}</td>
                    <td className="number">{event.state === "done" ? event.absentWithNotice : ""}</td>
                    <td className="number">{event.state === "done" ? event.absentWithoutNotice : ""}</td>
                    <td>
                      {event.report === null ? (
                        ""
                      ) : event.report === "overdue" ? (
                        <span className="chip chip-amber">Overdue</span>
                      ) : (
                        reportNames[event.report]
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </section>

      <section className="wrap band band-last" aria-labelledby="attendance">
        <h2 id="attendance">
          Attendance, member by <strong>member</strong>
        </h2>
        <p className="intro">
          Events each serving member was returned present at. The attendance return is private: a member sees only their own line.
        </p>
        {members.length === 0 ? (
          <p>Nobody is serving yet.</p>
        ) : (
          <Scroll label="Attendance by member">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col" className="number">
                    Present, 30 days
                  </th>
                  <th scope="col" className="number">
                    90 days
                  </th>
                  <th scope="col" className="number">
                    All
                  </th>
                  <th scope="col" className="number">
                    Absent without notice, 90 days
                  </th>
                  <th scope="col" className="number">
                    Times stood in
                  </th>
                  <th scope="col">Last present</th>
                </tr>
              </thead>
              <tbody>
                {members.map((person) => (
                  <tr key={person.id}>
                    <th scope="row">
                      {person.rankName ? `${person.rankName} ` : ""}
                      {person.name}
                      <small>{person.postTitle ?? "No post"}</small>
                    </th>
                    <td className="number">{person.attended30}</td>
                    <td className="number">{person.attended90}</td>
                    <td className="number">{person.attendedAll}</td>
                    <td className="number">{person.absentWithoutNotice90}</td>
                    <td className="number">{person.standIns}</td>
                    <td>{person.lastAttended ? formatDate(person.lastAttended) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </section>
    </>
  );
}
