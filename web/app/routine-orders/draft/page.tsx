import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageHead } from "@/components/PageHead";
import { RichSourcesProvider } from "@/components/rich/RichSources";
import { dayOf } from "@/lib/orders-form";
import { getRoutineOrder } from "@/lib/routine-orders";
import { DraftDecisions, OrdersEditor } from "../OrderForms";

export const metadata: Metadata = {
  title: "Draft routine orders",
  robots: { index: false, follow: false },
};

const title = (
  <>
    The next <strong>issue</strong>
  </>
);

export default function DraftPage() {
  return (
    <Suspense fallback={<Head lead="Reading the draft." />}>
      <Draft />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead
      picture="operations"
      slim
      before={
        <p className="back">
          <Link href="/routine-orders">Routine orders</Link>
        </p>
      }
      title={title}
      lead={lead}
    >
      {children}
    </PageHead>
  );
}

async function Draft() {
  const result = await getRoutineOrder("draft");
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "outside") redirect("/routine-orders");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  // Nobody but command is sent a draft, so for anyone else there is none.
  if (result.state === "not-found" || !result.command) redirect("/routine-orders");

  const { issue, names, sources } = result;
  const who = (id: string | null) => (id ? (names[id] ?? "someone who has left") : "nobody on record");
  return (
    <RichSourcesProvider value={sources}>
      <Head lead={`A draft opened ${dayOf(issue.draftedAt)} by ${who(issue.draftedBy)}. It records ${dayOf(issue.coversFrom)} to ${dayOf(issue.coversTo)}. Nobody else is sent it until it is issued.`} />
      <section className="wrap band" aria-labelledby="the-draft">
        <h2 id="the-draft">
          The <strong>draft</strong>
        </h2>
        <OrdersEditor id={issue.id} title={issue.title} body={issue.body} issued={false} />
      </section>
      <section className="wrap band band-last" aria-labelledby="issue-it">
        <h2 id="issue-it">
          Issue it, or <strong>discard it</strong>
        </h2>
        <p className="intro">Issuing numbers the orders, dates them and sends them to every serving member. Save the draft first if you have changed it.</p>
        <DraftDecisions id={issue.id} />
      </section>
    </RichSourcesProvider>
  );
}
