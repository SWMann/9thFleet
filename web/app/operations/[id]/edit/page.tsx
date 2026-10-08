import type { Metadata } from "next";
import { Suspense } from "react";
import { toFields } from "@/lib/operations-form";
import { deleteDraft } from "../../actions";
import { EventForm } from "../../OpsForms";
import { EditHead, EditNav, openForEdit } from "./frame";

export const metadata: Metadata = {
  title: "Change an event",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/operations/[id]/edit">;

export default function EditEventPage({ params }: Props) {
  return (
    <Suspense fallback={<EditHead title="Event" lead="Reading the event." />}>
      <EditEvent params={params} />
    </Suspense>
  );
}

async function EditEvent({ params }: { params: Props["params"] }) {
  const opened = await openForEdit((await params).id);
  if ("shut" in opened) return opened.shut;
  const { event, people, mayCreate, types, choices } = opened.result;

  const { date, time } = toFields(event.startsAt);
  return (
    <>
      <EditHead id={event.id} title={event.title} lead="What it is, when and where, who commands it, and who it is open to." />

      <section className={event.state === "draft" ? "wrap band" : "wrap band band-last"} aria-labelledby="details">
        <EditNav id={event.id} current="details" />
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
            repeatsWeekly: event.repeatsWeekly,
            openToRecruits: event.openToRecruits,
            openToService: event.openToService ?? "",
            requiresQualification: event.requires?.id ?? "",
            places: event.places === null ? "" : String(event.places),
            minimumAttending: event.minimumAttending === null ? "" : String(event.minimumAttending),
            musterAt: event.musterAt,
            area: event.area,
          }}
          // Someone changing an event they could not have drafted keeps its type on the list.
          types={types.filter((type) => type.key === event.kind || mayCreate.some((own) => own.key === type.key))}
          people={people}
          qualifications={choices.qualifications}
        />
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
