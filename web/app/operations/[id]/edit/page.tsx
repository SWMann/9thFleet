import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHead } from "@/components/PageHead";
import { getOperation } from "@/lib/operations";
import { toFields } from "@/lib/operations-form";
import { deleteDraft } from "../../actions";
import { EventForm, OrdersForm } from "../../OpsForms";

export const metadata: Metadata = {
  title: "Change an event",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/operations/[id]/edit">;

export default function EditEventPage({ params }: Props) {
  return (
    <Suspense fallback={<Head title="Event" lead="Reading the event." />}>
      <EditEvent params={params} />
    </Suspense>
  );
}

function Head({ id, title, lead }: { id?: string; title: string; lead: string }) {
  return (
    <PageHead
      picture="operations"
      slim
      before={
        <p className="back">
          <Link href={id ? `/operations/${id}` : "/operations"}>{id ? "Back to the event" : "Operations"}</Link>
        </p>
      }
      title={<strong>{title}</strong>}
      lead={lead}
    />
  );
}

async function EditEvent({ params }: { params: Props["params"] }) {
  const { id } = await params;
  const result = await getOperation(id);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head title="Event" lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") return <Head title="Event" lead="Operations are for the serving fleet." />;
  if (result.state === "not-found") notFound();

  const { event, orders, edits, people, mayCreate } = result;
  if (!edits) return <Head id={event.id} title={event.title} lead="This event is run by its commander and by command." />;
  if (event.state === "done" || event.state === "cancelled") {
    return <Head id={event.id} title={event.title} lead="This event is closed, so its details and orders are fixed." />;
  }

  const { date, time } = toFields(event.startsAt);
  return (
    <>
      <Head id={event.id} title={event.title} lead="Change the details, and write the orders." />

      <section className="wrap band" aria-labelledby="details">
        <h2 id="details">
          The <strong>details</strong>
        </h2>
        <EventForm
          event={{
            id: event.id,
            kind: event.kind,
            title: event.title,
            summary: event.summary,
            date,
            time,
            duration: event.durationMinutes,
            commander: event.commander?.id ?? "",
            second: event.second?.id ?? "",
            observer: event.observer?.id ?? "",
            weaponsState: event.weaponsState ?? "",
            pveFallback: event.pveFallback,
          }}
          mayCreate={mayCreate}
          people={people}
        />
      </section>

      <section className={event.state === "draft" ? "wrap band" : "wrap band band-last"} aria-labelledby="orders">
        <h2 id="orders">
          The <strong>orders</strong>
        </h2>
        <OrdersForm id={event.id} orders={orders} />
      </section>

      {event.state === "draft" ? (
        <section className="wrap band band-last" aria-labelledby="scrap">
          <h2 id="scrap">
            Scrap the <strong>draft</strong>
          </h2>
          <details className="confirm">
            <summary className="button button-quiet">Delete this draft</summary>
            <form action={deleteDraft} className="confirm-body">
              <input type="hidden" name="id" value={event.id} />
              <p>Delete {event.title}? Nobody else has seen it, and it cannot be brought back.</p>
              <button className="button" type="submit">
                Yes, delete it
              </button>
            </form>
          </details>
        </section>
      ) : null}
    </>
  );
}
