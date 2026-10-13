import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { Rich } from "@/components/rich/Rich";
import { RichSourcesProvider } from "@/components/rich/RichSources";
import { dayOf, orderName } from "@/lib/orders-form";
import { getRoutineOrder } from "@/lib/routine-orders";
import { MarkReadForm, OrdersEditor } from "../OrderForms";

export const metadata: Metadata = {
  title: "Routine orders",
  robots: { index: false, follow: false },
};

type Params = Promise<{ number: string }>;

export default function IssuePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Head title="Routine orders" lead="Reading the orders." />}>
      <Issue params={params} />
    </Suspense>
  );
}

function Head({ title, lead, children }: { title: ReactNode; lead: string; children?: ReactNode }) {
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

const dayAndTime = (date: string) =>
  `${dayOf(date)}, ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(date))} UTC`;

async function Issue({ params }: { params: Params }) {
  const { number } = await params;
  if (!/^\d{1,6}$/.test(number)) notFound();
  const result = await getRoutineOrder(number);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "outside") redirect("/routine-orders");
  if (result.state === "no-database") return <Head title="Routine orders" lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "not-found") notFound();

  const { member, command, issue, readers, names, sources } = result;
  const who = (id: string | null) => (id ? (names[id] ?? "someone who has left") : "nobody on record");
  const name = orderName(issue.number ?? 0);
  const corrected = issue.issuedAt && Date.parse(issue.updatedAt) - Date.parse(issue.issuedAt) > 60_000;

  return (
    <RichSourcesProvider value={sources}>
      <Head
        title={
          <>
            Routine Orders <strong>{issue.number}</strong>
          </>
        }
        lead={`${issue.title ? `${issue.title}. ` : ""}Issued ${dayOf(issue.issuedAt ?? issue.draftedAt)} by ${who(issue.issuedBy)}. Records ${dayOf(issue.coversFrom)} to ${dayOf(issue.coversTo)}.`}
      />

      <section className="wrap band" aria-labelledby="orders-body">
        <h2 id="orders-body" className="visually-hidden">
          {name}
        </h2>
        {corrected ? (
          <p className="notice">
            <Icon name="pen" size={16} />
            <span>Corrected on {dayAndTime(issue.updatedAt)}, after it was issued.</span>
          </p>
        ) : null}
        <Rich text={issue.body} you={member.id} members={names} mentions className="orders-body" />
        {issue.read ? (
          <p className="read-mark">
            <Icon name="check" size={16} />
            You have read this issue.
          </p>
        ) : (
          <MarkReadForm id={issue.id} />
        )}
      </section>

      {command && readers ? (
        <section className="wrap band" aria-labelledby="who-read">
          <h2 id="who-read">
            Who has <strong>read it</strong>
          </h2>
          <p className="intro">
            {readers.read.length} of {readers.read.length + readers.unread.length} serving have marked {name} as read.
          </p>
          {readers.unread.length > 0 ? (
            <p>
              <strong>Not yet:</strong> {readers.unread.map((person) => person.name).join(", ")}.
            </p>
          ) : null}
          {readers.read.length > 0 ? (
            <p className="small">
              <strong>Read:</strong> {readers.read.map((person) => person.name).join(", ")}.
            </p>
          ) : null}
        </section>
      ) : null}

      {command ? (
        <section className="wrap band band-last" aria-labelledby="correct">
          <h2 id="correct">
            <strong>Correct</strong> the words
          </h2>
          <details className="confirm">
            <summary className="button button-quiet">Open the editor</summary>
            <div className="confirm-body">
              <OrdersEditor id={issue.id} title={issue.title} body={issue.body} issued />
            </div>
          </details>
        </section>
      ) : null}
    </RichSourcesProvider>
  );
}
