import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { StationTasks } from "@/components/doctrine/StationTasks";
import { CrewTemplateView } from "@/components/ships/CrewTemplateView";
import { getModel } from "@/lib/ships";
import { sinceWords } from "@/lib/ships-form";
import { shipKindOf } from "@/lib/structure";

export const metadata: Metadata = {
  title: "Ship model",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ slug: string }> };

export default function ModelPage({ params }: Props) {
  return (
    <Suspense fallback={<Head title={<strong>A model</strong>} lead="Reading the model." />}>
      <Model params={params} />
    </Suspense>
  );
}

function Head({ title, lead, children }: { title: ReactNode; lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="fleet" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

/** One model: what it is, what it does, how it is crewed, and the fleet's hulls of it. */
async function Model({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) notFound();
  const result = await getModel(slug);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "not-found") notFound();
  if (result.state === "no-database") return <Head title={<strong>A model</strong>} lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head title={<strong>A model</strong>} lead="The models are for the serving fleet. You will see them once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { model, templates, fit, hulls, command, readAt: now } = result;
  const kind = shipKindOf(model.kind);
  const crew = model.crewMin === model.crewMax ? `crew of ${model.crewMin}` : `crew of ${model.crewMin} to ${model.crewMax}`;
  const roleWords = model.roles.length === 0 ? "No role yet." : `${model.roles.map((role, index) => (index === 0 ? `${role.name}` : role.name.toLowerCase())).join(", ")}.`;
  const lead = `${kind.name}${model.maker ? ` by ${model.maker}` : ""}, ${crew}. ${roleWords}${model.flyable ? "" : " Not flyable in the game yet."}`;
  const ready = hulls.filter((hull) => hull.ready).length;
  const crewed = templates.filter((template) => template.stations.length > 0);

  return (
    <>
      <Head title={<strong>{model.name}</strong>} lead={lead}>
        <p className="actions">
          <Link className="button button-quiet" href="/ships">
            The fleet board
          </Link>
          <Link className="button button-quiet" href="/ships/models">
            Every model
          </Link>
        </p>
      </Head>

      <section className="wrap band" aria-labelledby="crew">
        <h2 id="crew">
          How it is <strong>crewed</strong>
        </h2>
        {crewed.length === 0 ? (
          <p className="intro">No stations have been set for it yet.{command ? " Command sets them under Fleet admin, Ships." : ""}</p>
        ) : (
          <>
            <p className="intro">
              The stations aboard, by department, with how many of each are needed to sail. Every station is a role of the order of battle, so the last column says
              whether you could fill it: you hold a post of the role, you hold the qualifications a post of it asks for, what you would still need, or the role is
              filled by appointment alone.
              {command ? " Command keeps the templates under Fleet admin, Ships." : ""}
            </p>
            {crewed.map((template) => (
              <CrewTemplateView key={template.id} template={template} fit={fit} />
            ))}
          </>
        )}
      </section>

      {crewed.length > 0 ? <StationTasks templates={crewed} /> : null}

      <section className="wrap band band-last" aria-labelledby="hulls">
        <h2 id="hulls">
          On the <strong>register</strong>
        </h2>
        {hulls.length === 0 ? (
          <p className="intro">
            Nobody has registered one. <Link href="/profile?tab=ships">Register yours</Link> if you own one.
          </p>
        ) : (
          <>
            <p className="intro">
              {hulls.length === 1 ? "One hull" : `${hulls.length} hulls`}, {ready} ready.
            </p>
            <ul className="hulls">
              {hulls.map((hull) => (
                <li key={hull.id} className={hull.ready ? "hull hull-ready" : "hull hull-down"}>
                  <div className="hull-head">
                    <h3>
                      <span className="hull-name">{hull.name || hull.owner}</span>
                    </h3>
                    <span className={hull.ready ? "chip chip-on" : "chip chip-amber"}>{hull.ready ? "Ready" : hull.inClaim ? "In claim" : "Not ready"}</span>
                  </div>
                  <p className="hull-facts">
                    {hull.name ? (
                      <span className="with-icon">
                        <Icon name="person" size={14} />
                        {hull.owner}
                      </span>
                    ) : null}
                    <span className="with-icon">
                      <Icon name="clock" size={14} />
                      Marked {sinceWords(hull.readyAsOf, now)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
