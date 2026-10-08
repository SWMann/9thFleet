import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { formatDate, serviceNames, stageNames } from "@/lib/application-form";
import { getApplyState, type MyApplication } from "@/lib/applications";
import { site } from "@/lib/site";
import { withdrawApplication } from "./actions";
import { ApplicationForm } from "./ApplicationForm";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = {
  title: "Apply",
  robots: { index: false, follow: false },
};

export default function ApplyPage() {
  return (
    <Suspense fallback={<Head lead="Reading your record." />}>
      <Apply />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: React.ReactNode }) {
  return (
    <PageHead
      picture="members"
      slim
      title={
        <>
          Apply to <strong>join</strong>
        </>
      }
      lead={lead}
    >
      {children}
    </PageHead>
  );
}

const YourRecord = () => (
  <p className="actions">
    <Link className="button button-quiet" href="/profile">
      Your record
    </Link>
  </p>
);

async function Apply() {
  const result = await getApplyState();

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;

  if (result.state === "not-an-applicant") {
    return (
      <Head
        lead={
          result.status === "discharged"
            ? "You have left the fleet. Speak to staff on Discord if you want to come back."
            : "You are already in the fleet, so there is nothing to apply for here."
        }
      >
        <YourRecord />
      </Head>
    );
  }

  if (result.state === "waiting") return <Waiting application={result.application} />;

  if (result.state === "closed") {
    return (
      <>
        <Head lead={`Recruitment opens on ${site.recruitmentOpens}. Until then there is nothing to apply for.`}>
          <YourRecord />
        </Head>
        <Last application={result.last} />
      </>
    );
  }

  if (result.state === "names") {
    return (
      <Head lead="Before you apply, the fleet needs to know what to call you. Set your character name and RSI handle on your record, then come back.">
        <p className="actions">
          <Link className="button" href="/profile#names">
            Set your names
          </Link>
        </p>
      </Head>
    );
  }

  if (result.state === "limit") {
    return (
      <>
        <Head lead={`You have applied three times in 30 days, which is the limit. You can apply again on ${formatDate(result.again)}.`}>
          <YourRecord />
        </Head>
        <Last application={result.last} />
      </>
    );
  }

  // Every other state has been dealt with above.
  if (result.state !== "ready") redirect("/profile");

  return (
    <>
      <Head lead="Recruitment is open. Answer plainly: staff read every application, and short honest answers do better than long ones." />

      <section className="wrap band" aria-labelledby="next">
        <h2 id="next">What happens next</h2>
        <div className="prose">
          <ul>
            <li>Staff read your application. Nobody else in the fleet can see it.</li>
            <li>If it reads well, a member of staff contacts you on Discord to arrange a 15-minute interview by voice.</li>
            <li>If you are accepted you become a recruit and start training.</li>
          </ul>
          <Last application={result.last} inline />
        </div>
      </section>

      <section className="wrap band band-last" aria-labelledby="form">
        <h2 id="form">Your application</h2>
        <ApplicationForm services={result.services} />
      </section>
    </>
  );
}

function Waiting({ application }: { application: MyApplication }) {
  return (
    <>
      <Head
        lead={
          application.stage === "interview"
            ? "Your application is at interview. A member of staff will contact you on Discord to arrange it, if they have not already."
            : "Your application is with staff. They will contact you on Discord once they have read it."
        }
      />
      <section className="wrap band" aria-labelledby="yours">
        <h2 id="yours">Your application</h2>
        <dl className="facts">
          <div>
            <dt>Sent</dt>
            <dd>{formatDate(application.submittedAt)}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>{serviceNames[application.service]}</dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>{stageNames[application.stage]}</dd>
          </div>
        </dl>
      </section>
      <section className="wrap band band-last" aria-labelledby="withdraw">
        <h2 id="withdraw">Changed your mind</h2>
        <div>
          <p>You can withdraw your application. You are free to apply again later.</p>
          <details className="confirm">
            <summary className="button button-quiet">Withdraw</summary>
            <form action={withdrawApplication} className="confirm-body">
              <input type="hidden" name="id" value={application.id} />
              <p>Withdraw your application? Staff will stop considering it.</p>
              <button className="button" type="submit">
                Yes, withdraw it
              </button>
            </form>
          </details>
        </div>
      </section>
    </>
  );
}

/** What became of the applicant's last application, if it is closed. */
function Last({ application, inline = false }: { application: MyApplication | null; inline?: boolean }) {
  if (!application) return null;
  const said =
    application.stage === "declined"
      ? `Your last application was declined on ${formatDate(application.decidedAt ?? application.submittedAt)}.`
      : application.stage === "withdrawn"
        ? `You withdrew your last application, sent on ${formatDate(application.submittedAt)}.`
        : null;
  if (!said) return null;
  if (inline) return <p className="aside-note">{said} You may apply again.</p>;
  return (
    <section className="wrap band band-last" aria-labelledby="last">
      <h2 id="last">Your last application</h2>
      <p>{said}</p>
    </section>
  );
}
