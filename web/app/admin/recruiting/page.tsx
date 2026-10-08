import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Bars, Columns, Panel, Scroll, Stats, percent } from "@/components/admin/Charts";
import { gate, loadFleet, recruiting } from "@/lib/admin";
import { formatDate } from "@/lib/application-form";

export const metadata: Metadata = {
  title: "Recruiting",
  robots: { index: false, follow: false },
};

const title = <strong>Recruiting</strong>;

export default function RecruitingPage() {
  return (
    <Suspense fallback={<AdminHead current="recruiting" tier={null} title={title} lead="Reading the applications." />}>
      <Recruiting />
    </Suspense>
  );
}

const days = (value: number | null) => {
  if (value === null) return "None yet";
  if (value < 1) return "Under a day";
  const rounded = Math.round(value * 10) / 10;
  return rounded === 1 ? "1 day" : `${rounded} days`;
};

async function Recruiting() {
  const access = await gate("staff");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="recruiting" title={title} />;
  const loaded = await loadFleet();
  if (loaded.state !== "ready") return <AdminShut access={loaded} current="recruiting" title={title} />;

  const { fleet } = loaded;
  const figures = recruiting(fleet);

  return (
    <>
      <AdminHead
        current="recruiting"
        tier={access.tier}
        title={title}
        lead={`Recruitment is ${fleet.recruitmentOpen ? "open" : "closed"}. ${figures.waiting} ${figures.waiting === 1 ? "application is" : "applications are"} waiting to be read and ${figures.atInterview} ${figures.atInterview === 1 ? "is" : "are"} at interview.`}
      >
        <p className="actions">
          <Link className="button" href="/staff/applications">
            Handle applications
          </Link>
        </p>
      </AdminHead>

      <section className="wrap band" aria-labelledby="figures">
        <h2 id="figures">
          The <strong>figures</strong>
        </h2>
        <Stats
          items={[
            {
              label: "Applications",
              value: figures.total,
              note: `From ${figures.applicants} ${figures.applicants === 1 ? "person" : "people"}, ${figures.repeat} of them more than once`,
            },
            { label: "In the last 30 days", value: figures.last30 },
            { label: "Waiting to be read", value: figures.waiting },
            { label: "At interview", value: figures.atInterview },
            { label: "Acceptance rate", value: percent(figures.acceptanceRate), note: "Accepted, of those accepted or declined" },
            { label: "Time to decide", value: days(figures.medianDaysToDecide), note: "The middle one, from sent to decided" },
          ]}
        />
        <div className="charts">
          <Panel title="How far applications get" note="Each step counts every application that got at least that far. Withdrawn ones stop at the first step.">
            <Bars caption="How far applications get" head={["Step", "Applications"]} rows={figures.funnel} ordered empty="Nobody has applied yet." />
          </Panel>
          <Panel title="Where they stand now">
            <Bars caption="Applications by where they stand now" head={["State", "Applications"]} rows={figures.outcomes} empty="Nobody has applied yet." />
          </Panel>
          <Panel title="Applications sent, week by week" note="The last eight weeks. A week starts on Monday, UTC.">
            <Columns
              caption="Applications sent in each of the last eight weeks"
              series={figures.perWeek}
              noun={["application", "applications"]}
              empty="No application has been sent in the last eight weeks."
            />
          </Panel>
          <Panel title="Service asked for">
            <Bars caption="Applications by the service asked for" head={["Service", "Applications"]} rows={figures.byService} empty="Nobody has applied yet." />
          </Panel>
          <Panel title="Route" note="A cadet applies for the officer course. Everyone else joins as a recruit.">
            <Bars caption="Applications by route" head={["Route", "Applications"]} rows={figures.byRoute} empty="Nobody has applied yet." />
          </Panel>
        </div>
      </section>

      <section className="wrap band band-last" aria-labelledby="open">
        <h2 id="open">
          Still <strong>open</strong>
        </h2>
        {figures.open.length === 0 ? (
          <p>No application is waiting on staff.</p>
        ) : (
          <Scroll label="Applications still open">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Applicant</th>
                  <th scope="col">Stands at</th>
                  <th scope="col">Sent</th>
                  <th scope="col" className="number">
                    Days waiting
                  </th>
                </tr>
              </thead>
              <tbody>
                {figures.open.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      <Link href={`/staff/applications/${entry.id}`}>{entry.name}</Link>
                    </th>
                    <td>{entry.stage === "interview" ? "At interview" : "Waiting to be read"}</td>
                    <td>{formatDate(entry.submittedAt)}</td>
                    <td className="number">
                      {entry.daysWaiting}
                      {entry.daysWaiting >= 7 ? <span className="chip chip-amber">A week or more</span> : null}
                    </td>
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
