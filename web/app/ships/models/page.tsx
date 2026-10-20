import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageHead } from "@/components/PageHead";
import { getRegister } from "@/lib/ships";
import { boardAddress, narrowingFrom } from "@/lib/ships-board";
import { shipKinds } from "@/lib/structure";

export const metadata: Metadata = {
  title: "Ship models",
  robots: { index: false, follow: false },
};

const title = (
  <>
    The <strong>models</strong>
  </>
);

type Props = { searchParams: Promise<{ role?: string | string[] }> };

export default function ModelsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Head lead="Reading the models." />}>
      <Models searchParams={searchParams} />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="fleet" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

/** Every model the fleet flies, by kind, with what it does and how many the fleet holds. */
async function Models({ searchParams }: Props) {
  const [result, params] = await Promise.all([getRegister(), searchParams]);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="The models are for the serving fleet. You will see them once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { models, templates, roles, ships, command } = result;
  const asked = narrowingFrom(params);
  const seatsOf = new Map(templates.filter((template) => template.isDefault).map((template) => [template.modelId, template.seats]));
  const hullsOf = new Map<string, number>();
  for (const ship of ships) hullsOf.set(ship.model.id, (hullsOf.get(ship.model.id) ?? 0) + 1);
  const shown = models.filter((model) => !asked.role || model.roles.some((role) => role.slug === asked.role));
  const byKind = shipKinds.map((kind) => ({ kind, models: shown.filter((model) => model.kind === kind.key) })).filter((group) => group.models.length > 0);
  const lead = `${models.length} models the fleet flies, by kind, each with the roles it fills and, where set, the stations aboard it.${command ? " Command keeps both under Fleet admin." : ""}`;

  return (
    <>
      <Head lead={lead}>
        <p className="actions">
          <Link className="button button-quiet" href="/ships">
            The fleet board
          </Link>
        </p>
      </Head>
      <section className="wrap band band-last" aria-labelledby="models">
        <h2 id="models">
          By <strong>kind</strong>
        </h2>
        <p className="chips chips-left" aria-label="Narrow the models by role">
          <Link className={asked.role ? "chip chip-link" : "chip chip-link chip-on"} href="/ships/models" aria-current={asked.role ? undefined : "true"}>
            Every role
          </Link>
          {roles.map((role) => (
            <Link
              key={role.slug}
              className={asked.role === role.slug ? "chip chip-link chip-on" : "chip chip-link"}
              href={boardAddress("/ships/models", { kind: null, ready: false, role: asked.role === role.slug ? null : role.slug })}
              aria-current={asked.role === role.slug ? "true" : undefined}
              title={role.description || undefined}
            >
              {role.name}
            </Link>
          ))}
        </p>
        {byKind.length === 0 ? (
          <p className="intro">
            No model fills that role. <Link href="/ships/models">Show every model.</Link>
          </p>
        ) : (
          byKind.map((group) => (
            <div className="hull-group" key={group.kind.key}>
              <h3>{group.kind.many}</h3>
              <ul className="model-list">
                {group.models.map((model) => {
                  const seats = seatsOf.get(model.id) ?? 0;
                  const hulls = hullsOf.get(model.id) ?? 0;
                  return (
                    <li key={model.id} className="model-line">
                      <Link className="model-name" href={`/ships/models/${model.slug}`}>
                        {model.name}
                      </Link>
                      <span className="model-facts">
                        {model.maker ? `${model.maker}. ` : ""}
                        {model.crewMin === model.crewMax ? `Crew ${model.crewMin}` : `Crew ${model.crewMin} to ${model.crewMax}`}
                        {seats > 0 ? `, ${seats} ${seats === 1 ? "seat" : "seats"}` : ""}. {model.roles.map((role) => role.name).join(", ") || "No role yet"}.
                        {model.flyable ? "" : " Not flyable yet."}
                      </span>
                      <span className={hulls > 0 ? "chip chip-on" : "chip"}>{hulls === 0 ? "None registered" : `${hulls} on the register`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
