import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHead } from "@/components/PageHead";
import { getDraftingState } from "@/lib/operations";
import { getPiracyReport } from "@/lib/piracy";
import { responseStart } from "@/lib/piracy-form";
import { EventForm } from "../OpsForms";

export const metadata: Metadata = {
  title: "Draft an event",
  robots: { index: false, follow: false },
};

type Asked = Promise<{ report?: string | string[] }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function NewEventPage({ searchParams }: { searchParams: Asked }) {
  return (
    <Suspense fallback={<Head lead="Reading the fleet." />}>
      <NewEvent asked={searchParams} />
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

async function NewEvent({ asked }: { asked: Asked }) {
  const [result, { report: askedReport }] = await Promise.all([getDraftingState(), asked]);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") return <Head lead="Operations are for the serving fleet." />;
  if (result.mayCreate.length === 0) {
    return <Head lead="Command drafts events, and instructors draft the types open to them. Ask one of them to set this up." />;
  }

  // Opened from a piracy report, the form starts as a Response to it. The report is read by its id, as the reader:
  // the database sends it to command and to nobody else, so for anyone else the form opens as it always does.
  const response = result.mayCreate.find((type) => type.key === "response");
  const report = response && typeof askedReport === "string" && UUID.test(askedReport) ? await getPiracyReport(askedReport) : null;
  const start = report ? responseStart(report) : null;
  const when = report?.urgent ? report.soon : result.suggested;

  // Otherwise it opens on the first type this member may draft. Either way, with that type's usual length and weapons state.
  const first = report && response ? response : result.mayCreate[0];
  return (
    <>
      <Head
        lead={
          report
            ? `Started from the piracy report sent by ${report.reporterHandle}. Once announced, an event is read by the whole serving fleet: say there only what its ships need. Until then a draft is seen only by you, its commander and command.`
            : "A draft is seen only by you, its commander and command until it is announced."
        }
      />
      <section className="wrap band band-last" aria-labelledby="details">
        <h2 id="details">
          The <strong>details</strong>
        </h2>
        <EventForm
          event={{
            kind: first.key,
            title: start?.title ?? "",
            summary: start?.summary ?? "",
            date: when.date,
            time: when.time,
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
            area: start?.area ?? "",
            teachesQualification: "",
          }}
          types={result.mayCreate}
          people={result.people}
          qualifications={result.qualifications}
          report={report?.id}
        />
      </section>
    </>
  );
}
