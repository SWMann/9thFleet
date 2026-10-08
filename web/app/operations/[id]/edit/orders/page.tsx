import type { Metadata } from "next";
import { Suspense } from "react";
import { toFields } from "@/lib/operations-form";
import type { Plan } from "@/lib/operations";
import { OrdersForm } from "../../../OpsForms";
import { PlanEditor, ReadingForm, type PlanRow } from "../../../PlanForms";
import { EditHead, EditNav, openForEdit } from "../frame";

export const metadata: Metadata = {
  title: "Orders and plan",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/operations/[id]/edit/orders">;

export default function OrdersPage({ params }: Props) {
  return (
    <Suspense fallback={<EditHead title="Event" lead="Reading the event." />}>
      <Orders params={params} />
    </Suspense>
  );
}

/** Each of the plan's lists as its editor takes it: every value as the text a form holds. */
function rowsOf(plan: Plan): Record<keyof Plan, PlanRow[]> {
  return {
    objectives: plan.objectives.map((entry) => ({ id: entry.id, values: { title: entry.title } })),
    elements: plan.elements.map((entry) => ({ id: entry.id, values: { name: entry.name, callsign: entry.callsign, task: entry.task } })),
    // A timing is entered as its time of day in UTC.
    timings: plan.timings.map((entry) => ({ id: entry.id, values: { time: toFields(entry.at).time, label: entry.label } })),
    ships: plan.ships.map((entry) => ({ id: entry.id, values: { ship: entry.ship, note: entry.note } })),
    nets: plan.nets.map((entry) => ({ id: entry.id, values: { name: entry.name, purpose: entry.purpose, controller: entry.controller } })),
  };
}

async function Orders({ params }: { params: Props["params"] }) {
  const opened = await openForEdit((await params).id);
  if ("shut" in opened) return opened.shut;
  const { event, orders, sections, plan } = opened.result;
  const rows = rowsOf(plan);

  return (
    <>
      <EditHead id={event.id} title={event.title} lead="The warning order, the operation order, and the plan behind it." />

      <section className="wrap band" aria-labelledby="orders">
        <EditNav id={event.id} current="orders" />
        <h2 id="orders">
          The <strong>orders</strong>
        </h2>
        {event.state === "announced" ? (
          <p className="intro">
            This event is announced. If you change its orders or its plan, issue an amendment from the event&apos;s
            page, so that everyone attending is told what changed and can acknowledge it.
          </p>
        ) : null}
        <OrdersForm id={event.id} orders={orders} sections={sections} />
      </section>

      <section className="wrap band band-last" aria-labelledby="plan">
        <h2 id="plan">
          The <strong>plan</strong>
        </h2>
        <p className="intro">
          Each of these is shown with the orders on the event&apos;s page. All are optional: leave out what the event
          does not need.
        </p>
        <PlanEditor id={event.id} part="objectives" rows={rows.objectives} />
        <PlanEditor id={event.id} part="elements" rows={rows.elements} />
        <PlanEditor id={event.id} part="timings" rows={rows.timings} />
        <PlanEditor id={event.id} part="ships" rows={rows.ships} />
        <PlanEditor id={event.id} part="nets" rows={rows.nets} />
        <div className="plan-part">
          <ReadingForm id={event.id} reading={event.reading} />
        </div>
      </section>
    </>
  );
}
