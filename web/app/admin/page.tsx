import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Bars, Meter, Panel, Ratios, Scroll, Stats, percent } from "@/components/admin/Charts";
import { attention, byStatus, gate, loadFleet, operations, posts, reaches, recruiting, stages, strength } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Fleet admin",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Fleet <strong>admin</strong>
  </>
);

export default function AdminPage() {
  return (
    <Suspense fallback={<AdminHead current="overview" tier={null} title={title} lead="Reading the fleet's figures." />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const access = await gate("staff", "/admin");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="overview" title={title} />;
  const loaded = await loadFleet();
  if (loaded.state !== "ready") return <AdminShut access={loaded} current="overview" title={title} />;

  const { fleet } = loaded;
  const { tier } = access;
  const command = reaches(tier, "command");
  const force = strength(fleet);
  const filled = posts(fleet);
  const applications = recruiting(fleet);
  const events = command ? operations(fleet) : null;
  const needs = attention(fleet, tier);

  return (
    <>
      <AdminHead
        current="overview"
        tier={tier}
        title={title}
        lead={`Stage ${force.band.stage}: ${force.band.name}. ${force.active} active, ${filled.filled} of ${filled.open} open posts filled.`}
      />

      <section className="wrap band" aria-labelledby="glance">
        <h2 id="glance">
          At a <strong>glance</strong>
        </h2>
        <Stats
          items={[
            { label: "Active strength", value: force.active, note: "Recruits, auxiliaries and full members" },
            {
              label: "Posts filled",
              value: `${filled.filled} of ${filled.open}`,
              note: filled.vacant === 0 ? "No open post is vacant" : `${filled.vacant} vacant, ${filled.entryVacant} of them entry posts`,
            },
            {
              label: "Applications open",
              value: applications.waiting + applications.atInterview,
              note: `${applications.waiting} to read, ${applications.atInterview} at interview`,
            },
            { label: "Recruitment", value: fleet.recruitmentOpen ? "Open" : "Closed", note: "An admin opens and closes it" },
            ...(events
              ? [
                  { label: "Events in 30 days", value: events.last30, note: `${events.upcoming.length} coming up` },
                  { label: "Average turnout", value: percent(events.averageTurnout), note: "Present, of those who said attending" },
                ]
              : []),
          ]}
        />
      </section>

      <section className="wrap band" aria-labelledby="attention">
        <h2 id="attention">
          Needs <strong>attention</strong>
        </h2>
        {needs.length === 0 ? (
          <p>Nothing needs attention.</p>
        ) : (
          <ul className="attention">
            {needs.map((item) => (
              <li key={item.what}>
                {item.href ? <Link href={item.href}>{item.what}</Link> : <strong>{item.what}</strong>}
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wrap band" aria-labelledby="strength">
        <h2 id="strength">
          Strength and the <strong>stage</strong>
        </h2>
        <div className="charts">
          <Panel
            title={force.next ? `Towards stage ${force.next.stage}: ${force.next.name}` : "The last stage"}
            note={
              force.supports && force.supports.stage > fleet.stage
                ? `This strength already supports stage ${force.supports.stage}. A stage opens two months after its strength is reached, and the Fleet Commander opens it.`
                : "A stage opens two months after its strength is reached."
            }
          >
            {force.next ? (
              <>
                <p className="chart-figure">
                  {force.active} <small>of the {force.next.from} active that stage {force.next.stage} needs</small>
                </p>
                <Meter
                  label={`Active strength towards stage ${force.next.stage}`}
                  value={force.active}
                  max={force.next.from}
                  ends={["0", `${force.next.from}`]}
                />
              </>
            ) : (
              <p className="chart-figure">
                {force.active} <small>active</small>
              </p>
            )}
          </Panel>
          <Panel title="Everyone on the books" note={`${force.serving} serving, counting the reserve.`}>
            <Bars caption="People by status" head={["Status", "People"]} rows={byStatus(fleet)} empty="Nobody is on the books yet." />
          </Panel>
          <Panel title="The nine stages" wide>
            <Scroll label="The nine stages">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Name</th>
                    <th scope="col" className="number">
                      Active strength
                    </th>
                    <th scope="col">Where the fleet is</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((entry) => (
                    <tr key={entry.stage} className={entry.stage === fleet.stage ? "data-current" : undefined}>
                      <td>{entry.stage}</td>
                      <th scope="row">{entry.name}</th>
                      <td className="number">
                        {entry.from} to {entry.to.toLocaleString("en-GB")}
                      </td>
                      <td>
                        {entry.stage === fleet.stage ? (
                          <span className="chip chip-gold">The fleet is here</span>
                        ) : entry.stage < fleet.stage ? (
                          "Open"
                        ) : force.active >= entry.from ? (
                          "Strength reached"
                        ) : (
                          `${entry.from - force.active} more active`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </Panel>
        </div>
      </section>

      <section className="wrap band band-last" aria-labelledby="posts">
        <h2 id="posts">
          Posts <strong>filled</strong>
        </h2>
        <p className="intro">
          The posts open at stage {fleet.stage}, unit by unit. {filled.later} more {filled.later === 1 ? "post opens" : "posts open"} at later
          stages. {filled.dutiesHeld} of {filled.dutiesOpen} open duties are held.
        </p>
        <div className="charts">
          <Panel title="By unit" wide>
            <Ratios
              caption="Posts filled, by unit"
              head={["Unit", "Posts filled"]}
              rows={filled.units.map((unit) => ({ label: unit.name, value: unit.filled, of: unit.open }))}
              empty="No post is open yet."
            />
          </Panel>
        </div>
        <p className="actions">
          <Link className="button button-quiet" href="/order-of-battle">
            Order of battle
          </Link>
          <Link className="button button-quiet" href="/admin/people">
            People
          </Link>
        </p>
      </section>
    </>
  );
}
