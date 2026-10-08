import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { formatDate, serviceNames, stageNames } from "@/lib/application-form";
import { listApplications, type ApplicationSummary } from "@/lib/applications";
import { setRecruitment } from "./actions";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = {
  title: "Applications",
  robots: { index: false, follow: false },
};

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<Head lead="Reading the applications." />}>
      <Applications />
    </Suspense>
  );
}

function Head({ lead }: { lead: string }) {
  return (
    <PageHead picture="staff" slim title={<strong>Applications</strong>} lead={lead} />
  );
}

async function Applications() {
  const result = await listApplications();

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "not-staff") return <Head lead="This page is for the fleet's staff." />;
  if (result.state !== "ready") redirect("/profile");

  const { applications, recruitmentOpen, admin } = result;
  const waiting = applications.filter((application) => application.stage === "submitted");
  const interview = applications.filter((application) => application.stage === "interview");
  const closed = applications.filter((application) => !["submitted", "interview"].includes(application.stage));

  return (
    <>
      <Head lead={summary(waiting.length, interview.length)} />

      <section className="wrap band" aria-labelledby="recruitment">
        <h2 id="recruitment">Recruitment</h2>
        <div>
          <p>
            {recruitmentOpen
              ? "Recruitment is open. Anyone who signs in and sets their names can apply."
              : "Recruitment is closed. Nobody outside the fleet can apply."}
          </p>
          {admin ? (
            <details className="confirm">
              <summary className="button button-quiet">{recruitmentOpen ? "Close recruitment" : "Open recruitment"}</summary>
              <form action={setRecruitment} className="confirm-body">
                <input type="hidden" name="open" value={recruitmentOpen ? "false" : "true"} />
                <p>
                  {recruitmentOpen
                    ? "Close recruitment? Applications already sent stay with staff."
                    : "Open recruitment? The application form becomes available to anyone who signs in."}
                </p>
                <button className="button" type="submit">
                  {recruitmentOpen ? "Yes, close it" : "Yes, open it"}
                </button>
              </form>
            </details>
          ) : (
            <p className="aside-note">An admin opens and closes recruitment.</p>
          )}
        </div>
      </section>

      <Group id="waiting" title="Waiting to be read" applications={waiting} empty="Nothing is waiting." />
      <Group id="interview" title="At interview" applications={interview} empty="Nobody is at interview." />

      <section className="wrap band band-last" aria-labelledby="closed">
        <h2 id="closed">Closed</h2>
        <div>
          {closed.length === 0 ? (
            <p>No application has been closed yet.</p>
          ) : (
            <details className="later">
              <summary>{closed.length === 1 ? "Show the 1 closed application" : `Show the ${closed.length} closed applications`}</summary>
              <Rows applications={closed} />
            </details>
          )}
        </div>
      </section>
    </>
  );
}

function summary(waiting: number, interview: number): string {
  if (waiting === 0 && interview === 0) return "No application needs anything from staff.";
  const parts = [
    waiting > 0 ? `${waiting} waiting to be read` : null,
    interview > 0 ? `${interview} at interview` : null,
  ].filter(Boolean);
  return `${parts.join(" and ")}.`;
}

function Group({
  id,
  title,
  applications,
  empty,
}: {
  id: string;
  title: string;
  applications: ApplicationSummary[];
  empty: string;
}) {
  return (
    <section className="wrap band" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div>{applications.length === 0 ? <p>{empty}</p> : <Rows applications={applications} />}</div>
    </section>
  );
}

function Rows({ applications }: { applications: ApplicationSummary[] }) {
  return (
    <ul className="posts">
      {applications.map((application) => (
        <li className="post" key={application.id}>
          <Link className="post-title" href={`/staff/applications/${application.id}`}>
            {application.name ?? "Name not set"}
          </Link>
          <div className="post-holder">
            {application.own ? <span className="tag tag-you tag-first">Yours</span> : null}
            {["submitted", "interview"].includes(application.stage) ? (
              <span className="post-state">Sent {formatDate(application.submittedAt)}</span>
            ) : (
              <span className="post-state">
                {stageNames[application.stage]}
                {application.decidedAt ? ` ${formatDate(application.decidedAt)}` : ""}
              </span>
            )}
          </div>
          <p className="post-details">
            {[application.handle ?? "No RSI handle", serviceNames[application.service], application.route === "cadet" ? "Cadet course" : null]
              .filter(Boolean)
              .join(". ")}
            .
          </p>
        </li>
      ))}
    </ul>
  );
}
