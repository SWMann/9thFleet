import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { TaskTable, Who } from "@/components/doctrine/TaskTable";
import { PageHead } from "@/components/PageHead";
import { getSituationPage } from "@/lib/doctrine";

export const metadata: Metadata = {
  title: "Situation",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ slug: string }> };

export default function SituationPage({ params }: Props) {
  return (
    <Suspense fallback={<Head title={<strong>A situation</strong>} lead="Reading the situation." />}>
      <Situation params={params} />
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

/** One situation: what you see, who calls it and who owns it, and its drill. */
async function Situation({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) notFound();
  const result = await getSituationPage(slug);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "not-found") notFound();
  if (result.state === "no-database") return <Head title={<strong>A situation</strong>} lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head title={<strong>A situation</strong>} lead="The situations are for the serving fleet. You will see them once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { situation, tasks, matrix } = result;

  return (
    <>
      <Head title={<strong>{situation.name}</strong>} lead={situation.whatYouSee || "A situation that can land on any night."}>
        <p className="actions">
          <Link className="button button-quiet" href="/operations/types">
            Every situation
          </Link>
        </p>
      </Head>

      <section className="wrap band" aria-labelledby="facts">
        <h2 id="facts">
          Who <strong>calls it</strong>
        </h2>
        <dl className="facts">
          <div>
            <dt>Called on the net by</dt>
            <dd>
              <Who roleId={situation.callsId} matrix={matrix} />
            </dd>
          </div>
          <div>
            <dt>Owned by</dt>
            <dd>
              <Who roleId={situation.ownsId} matrix={matrix} />
            </dd>
          </div>
          {situation.notes ? (
            <div>
              <dt>Notes</dt>
              <dd>{situation.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="wrap band band-last" aria-labelledby="drill">
        <h2 id="drill">
          The <strong>drill</strong>
        </h2>
        <p className="intro">What is done when it happens, in order, and by whom at the fleet&apos;s stage.</p>
        <TaskTable tasks={tasks} matrix={matrix} label={situation.name} phases={false} />
      </section>
    </>
  );
}
