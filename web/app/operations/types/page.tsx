import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Who } from "@/components/doctrine/TaskTable";
import { PageHead } from "@/components/PageHead";
import { getDoctrine } from "@/lib/doctrine";
import { liveAt, stageName, tasksOfSituation, tasksOfType } from "@/lib/matrix";

export const metadata: Metadata = {
  title: "Operation types and situations",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Types and <strong>situations</strong>
  </>
);

export default function TypesPage() {
  return (
    <Suspense fallback={<Head lead="Reading the matrix." />}>
      <Types />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="operations" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

/**
 * Every kind of night the fleet runs, by family, with what each is for and
 * what it needs; and every situation that can land on any of them. Each
 * leads to its tasks.
 */
async function Types() {
  const result = await getDoctrine();
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="The operation types and situations are for the serving fleet. You will see them once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { matrix } = result;
  const families = [...new Set(matrix.types.map((type) => type.family || "Other"))];
  const opens = (key: string) => matrix.types.find((type) => type.key === key)?.opensAt ?? 1;
  const openNow = matrix.types.filter((type) => type.opensAt <= matrix.stage).length;
  const spine = matrix.tasks.filter((task) => task.typeKey === null && task.situationSlug === null).length;

  return (
    <>
      <Head lead={`${matrix.types.length} kinds of night, ${openNow} of them open at ${stageName(matrix.stage)}, and ${matrix.situations.length} situations that can land on any of them. Every operation shares a spine of ${spine} tasks; each type adds its own, and each situation has a drill.`}>
        <p className="actions">
          <Link className="button button-quiet" href="/operations">
            Operations
          </Link>
        </p>
      </Head>

      <section className="wrap band" aria-labelledby="types">
        <h2 id="types">
          Operation <strong>types</strong>
        </h2>
        <p className="intro">
          An initiative is a sequence of these: a sweep, then patrols, then a strike. A type that opens at a later stage is listed, with its tasks, for the reading.
        </p>
        {families.map((family) => (
          <div className="type-family" key={family}>
            <h3>{family}</h3>
            <ul className="type-list">
              {matrix.types
                .filter((type) => (type.family || "Other") === family)
                .map((type) => {
                  const counted = liveAt(tasksOfType(matrix.tasks, type.key), matrix.stage, opens);
                  const own = matrix.tasks.filter((task) => task.typeKey === type.key).length;
                  return (
                    <li key={type.key} className={type.opensAt <= matrix.stage ? "type-card" : "type-card type-later"}>
                      <h4>
                        <Link href={`/operations/types/${type.key}`}>{type.name}</Link>
                        {type.opensAt <= matrix.stage ? <span className="chip chip-on">Open</span> : <span className="chip">Opens at {stageName(type.opensAt)}</span>}
                        {type.plannedOrReactive ? <span className="chip">{type.plannedOrReactive}</span> : null}
                      </h4>
                      {type.aim ? <p className="type-aim">{type.aim}</p> : null}
                      <dl className="type-facts">
                        {type.minimumForce ? (
                          <div>
                            <dt>At least</dt>
                            <dd>{type.minimumForce}</dd>
                          </div>
                        ) : null}
                        {type.typicalForce ? (
                          <div>
                            <dt>Usually</dt>
                            <dd>{type.typicalForce}</dd>
                          </div>
                        ) : null}
                        {type.needs ? (
                          <div>
                            <dt>Needs</dt>
                            <dd>{type.needs}</dd>
                          </div>
                        ) : null}
                        {type.contactExpected ? (
                          <div>
                            <dt>Contact</dt>
                            <dd>{type.contactExpected}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>Tasks</dt>
                          <dd>
                            {counted.live} live{counted.later > 0 ? `, ${counted.later} later` : ""}
                            {own === 0 ? " · no tasks of its own yet" : ""}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </section>

      <section className="wrap band band-last" aria-labelledby="situations">
        <h2 id="situations">
          <strong>Situations</strong>
        </h2>
        <p className="intro">What can happen on any night: what you see, who calls it on the net, and who owns it. Each has a drill, which is also what the training records teach as a lesson.</p>
        <ul className="situation-list">
          {matrix.situations.map((situation) => (
            <li key={situation.slug} className="situation-line">
              <Link className="situation-name" href={`/operations/situations/${situation.slug}`}>
                {situation.name}
              </Link>
              <span className="situation-see">{situation.whatYouSee}</span>
              <span className="situation-who">
                Called by <Who roleId={situation.callsId} matrix={matrix} />; owned by <Who roleId={situation.ownsId} matrix={matrix} />
                <span className="muted"> · {tasksOfSituation(matrix.tasks, situation.slug).length} in the drill</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
