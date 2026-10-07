import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { formatDate, serviceNames, stageNames } from "@/lib/application-form";
import { getApplication, type ApplicationDetail } from "@/lib/applications";
import { deleteNote } from "../actions";
import { DecisionForms, NoteForm } from "../StaffForms";

export const metadata: Metadata = {
  title: "Application",
  robots: { index: false, follow: false },
};

export default function ApplicationPage({ params }: PageProps<"/staff/applications/[id]">) {
  return (
    <Suspense fallback={<Head title="Application" lead="Reading the application." />}>
      <Application params={params} />
    </Suspense>
  );
}

function Head({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="wrap page-head">
      <p className="back">
        <Link href="/staff/applications">All applications</Link>
      </p>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
    </div>
  );
}

const statusNames = {
  applicant: "Applicant",
  recruit: "Recruit",
  auxiliary: "Auxiliary",
  member: "Full member",
  reserve: "Reserve",
  discharged: "Discharged",
} as const;

async function Application({ params }: { params: PageProps<"/staff/applications/[id]">["params"] }) {
  const { id } = await params;
  const result = await getApplication(id);

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head title="Application" lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "not-staff") return <Head title="Application" lead="This page is for the fleet's staff." />;
  if (result.state === "not-found") notFound();
  if (result.state !== "ready") redirect("/profile");

  const { application } = result;
  const name = application.name ?? "Name not set";
  const open = application.stage === "submitted" || application.stage === "interview";

  return (
    <>
      <Head title={name} lead={lead(application)} />

      <section className="wrap band" aria-labelledby="applicant">
        <h2 id="applicant">The applicant</h2>
        <dl className="ledger ledger-tight">
          <Line label="Character name" value={name} />
          <div>
            <dt>RSI handle</dt>
            <dd>
              {application.handle ? (
                <a
                  href={`https://robertsspaceindustries.com/en/citizens/${encodeURIComponent(application.handle)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {application.handle}
                </a>
              ) : (
                "Not set"
              )}
            </dd>
          </div>
          <Line label="Discord" value={application.discordName ?? "Unknown"} />
          <Line label="Status now" value={application.applicantStatus ? statusNames[application.applicantStatus] : "Unknown"} />
          <Line label="Applying for" value={`${serviceNames[application.service]}${application.route === "cadet" ? ", cadet course" : ""}`} />
        </dl>
      </section>

      <section className="wrap band" aria-labelledby="answers">
        <h2 id="answers">Answers</h2>
        <div>
          {application.answers.answers.length === 0 ? (
            <p>This application holds no answers.</p>
          ) : (
            <dl className="answers">
              {application.answers.answers.map((entry) => (
                <div key={entry.question}>
                  <dt>{entry.question}</dt>
                  <dd>{entry.answer}</dd>
                </div>
              ))}
            </dl>
          )}
          {application.answers.confirmed.length > 0 ? (
            <>
              <h3 className="answers-confirmed">Confirmed</h3>
              <ul className="ticks">
                {application.answers.confirmed.map((statement) => (
                  <li key={statement}>{statement}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </section>

      {application.own ? (
        <section className="wrap band band-last" aria-labelledby="own">
          <h2 id="own">Your own application</h2>
          <p>This application is yours, so another member of staff reads the notes and decides it.</p>
        </section>
      ) : (
        <>
          <section className="wrap band" aria-labelledby="notes">
            <h2 id="notes">Interview notes</h2>
            <div>
              {application.notes.length === 0 ? (
                <p>No notes yet.</p>
              ) : (
                <ul className="notes">
                  {application.notes.map((note) => (
                    <li key={note.id}>
                      <p className="note-body">{note.body}</p>
                      <p className="note-by">
                        {note.author ?? "A former member"}, {formatDate(note.writtenAt)}
                      </p>
                      {note.own ? (
                        <form action={deleteNote}>
                          <input type="hidden" name="id" value={note.id} />
                          <button className="link-button" type="submit">
                            Remove this note
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <NoteForm id={application.id} />
            </div>
          </section>

          <section className="wrap band band-last" aria-labelledby="decision">
            <h2 id="decision">Decision</h2>
            <div>
              {open ? (
                <DecisionForms
                  id={application.id}
                  stage={application.stage as "submitted" | "interview"}
                  name={name}
                  service={serviceNames[application.service]}
                />
              ) : (
                <p>{outcome(application)}</p>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function lead(application: ApplicationDetail): string {
  const sent = `Sent on ${formatDate(application.submittedAt)}.`;
  return `${stageNames[application.stage]}. ${sent}`;
}

function outcome(application: ApplicationDetail): string {
  const when = application.decidedAt ? ` on ${formatDate(application.decidedAt)}` : "";
  if (application.stage === "withdrawn") return "The applicant withdrew this application.";
  const by = application.decidedBy ? ` by ${application.decidedBy}` : "";
  return `${stageNames[application.stage]}${when}${by}. A closed application stays closed.`;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
