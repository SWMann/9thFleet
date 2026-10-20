import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { TaskTable } from "@/components/doctrine/TaskTable";
import { PageHead } from "@/components/PageHead";
import { getTypePage } from "@/lib/doctrine";
import { liveAt, stageName } from "@/lib/matrix";

export const metadata: Metadata = {
  title: "Operation type",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ key: string }> };

export default function TypePage({ params }: Props) {
  return (
    <Suspense fallback={<Head title={<strong>A type</strong>} lead="Reading the type." />}>
      <Type params={params} />
    </Suspense>
  );
}

function Head({ title, lead, children }: { title: ReactNode; lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="operations" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

/** One kind of night: what it is for, what it needs, and every task of it by phase, with who does what at the fleet's stage. */
async function Type({ params }: Props) {
  const { key } = await params;
  if (!/^[a-z0-9_-]{1,40}$/.test(key)) notFound();
  const result = await getTypePage(key);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "not-found") notFound();
  if (result.state === "no-database") return <Head title={<strong>A type</strong>} lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head title={<strong>A type</strong>} lead="The operation types are for the serving fleet. You will see them once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { type, tasks, matrix } = result;
  const opens = (k: string) => matrix.types.find((entry) => entry.key === k)?.opensAt ?? 1;
  const counted = liveAt(tasks, matrix.stage, opens);
  const own = tasks.filter((task) => task.typeKey === type.key).length;
  const lead = `${(type.aim || "An operation type").replace(/\.?$/, ".")}${type.family ? ` ${type.family}.` : ""} ${type.opensAt <= matrix.stage ? `Open since ${stageName(type.opensAt)}.` : `Opens at ${stageName(type.opensAt)}.`}`;

  return (
    <>
      <Head title={<strong>{type.name}</strong>} lead={lead}>
        <p className="actions">
          <Link className="button button-quiet" href="/operations/types">
            Every type
          </Link>
        </p>
      </Head>

      <section className="wrap band" aria-labelledby="facts">
        <h2 id="facts">
          What it <strong>needs</strong>
        </h2>
        <dl className="facts">
          <div>
            <dt>At least</dt>
            <dd>{type.minimumForce || <span className="muted">Not set</span>}</dd>
          </div>
          <div>
            <dt>Usually</dt>
            <dd>{type.typicalForce || <span className="muted">Not set</span>}</dd>
          </div>
          <div>
            <dt>Needs</dt>
            <dd>{type.needs || <span className="muted">Nothing</span>}</dd>
          </div>
          <div>
            <dt>Planned or reactive</dt>
            <dd>{type.plannedOrReactive || <span className="muted">Not set</span>}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>{type.contactExpected || <span className="muted">Not set</span>}</dd>
          </div>
          {type.notes ? (
            <div>
              <dt>Notes</dt>
              <dd>{type.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="wrap band band-last" aria-labelledby="tasks">
        <h2 id="tasks">
          Who does <strong>what</strong>
        </h2>
        <p className="intro">
          {counted.live} of {tasks.length} tasks are live at {stageName(matrix.stage)}; the rest wait for the stage they are needed from.{" "}
          {own === 0 ? "This type has no tasks of its own yet, so these are the spine every operation shares." : `${own} of them are this type's own; the rest are the spine every operation shares.`} Where a
          post does not exist yet, the role that holds its tasks until then is named, with the post it stands for.
        </p>
        <TaskTable tasks={tasks} matrix={matrix} label={type.name} />
      </section>
    </>
  );
}
