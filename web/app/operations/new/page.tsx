import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHead } from "@/components/PageHead";
import { getDraftingState } from "@/lib/operations";
import { EventForm } from "../OpsForms";

export const metadata: Metadata = {
  title: "Draft an event",
  robots: { index: false, follow: false },
};

export default function NewEventPage() {
  return (
    <Suspense fallback={<Head lead="Reading the fleet." />}>
      <NewEvent />
    </Suspense>
  );
}

function Head({ lead }: { lead: string }) {
  return (
    <PageHead
      picture="operations"
      slim
      before={
        <p className="back">
          <Link href="/operations">Operations</Link>
        </p>
      }
      title={
        <>
          Draft an <strong>event</strong>
        </>
      }
      lead={lead}
    />
  );
}

async function NewEvent() {
  const result = await getDraftingState();
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") return <Head lead="Operations are for the serving fleet." />;
  if (result.mayCreate.length === 0) {
    return <Head lead="Command drafts events, and instructors draft the types open to them. Ask one of them to set this up." />;
  }

  // The form opens on the first type this member may draft, with that type's usual length and weapons state.
  const first = result.mayCreate[0];
  return (
    <>
      <Head lead="A draft is seen only by you, its commander and command until it is announced." />
      <section className="wrap band band-last" aria-labelledby="details">
        <h2 id="details">
          The <strong>details</strong>
        </h2>
        <EventForm
          event={{
            kind: first.key,
            title: "",
            summary: "",
            date: result.suggested.date,
            time: result.suggested.time,
            duration: first.defaultDuration,
            commander: result.member.id,
            second: "",
            observer: "",
            weaponsState: first.defaultWeaponsState ?? "",
            pveFallback: "",
            repeatsWeekly: false,
            openToRecruits: true,
            openToService: "",
            requiresQualification: "",
            places: "",
            minimumAttending: "",
            musterAt: "",
            area: "",
            teachesQualification: "",
          }}
          types={result.mayCreate}
          people={result.people}
          qualifications={result.qualifications}
        />
      </section>
    </>
  );
}
