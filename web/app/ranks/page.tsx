import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHead } from "@/components/PageHead";
import { getRankTable } from "@/lib/ranks";
import { Ladder } from "./Ladder";

export const metadata: Metadata = {
  title: "Ranks and structure",
  description: "The eighteen grades of the UEE 9th Fleet, their rank names in the Navy, Army and Marines, and how promotion works.",
};

const needs = ["Time in grade", "Positive observations", "A recommendation", "The course for the next post", "A vacancy"];

export default function RanksPage() {
  return (
    <>
      <PageHead
        picture="ranks"
        title={
          <>
            Ranks and <strong>structure</strong>
          </>
        }
        lead="One ladder of 18 grades, shared by all three services."
      >
        <ul className="boxes">
          <li>
            <h2>Enlisted</h2>
            <p>E1 to E7. Entry posts run from E2 to E4.</p>
          </li>
          <li>
            <h2>Cadet</h2>
            <p>OC. A cadet course of about two months.</p>
          </li>
          <li>
            <h2>Officer</h2>
            <p>O1 to O10. Cadets commission at O1.</p>
          </li>
        </ul>
      </PageHead>

      <section className="wrap band" aria-labelledby="ladder">
        <h2 id="ladder">
          The <strong>ladder</strong>
        </h2>
        <Suspense fallback={<p>Reading the ranks.</p>}>
          <Ranks />
        </Suspense>
      </section>

      <section className="wrap band band-last" aria-labelledby="promotion">
        <h2 id="promotion">
          How promotion <strong>works</strong>
        </h2>
        <p className="intro">Rank belongs to the post you hold. A promotion needs five things.</p>
        <ol className="needs">
          {needs.map((need) => (
            <li key={need}>{need}</li>
          ))}
        </ol>
      </section>
    </>
  );
}

async function Ranks() {
  const table = await getRankTable();
  if (table.state === "no-database") return <p>This site is not connected to the fleet&apos;s database yet.</p>;

  const { grades, stage, openServices } = table;
  const top = grades.filter((grade) => grade.opensAtStage <= stage).at(-1);
  return (
    <>
      <dl className="tally">
        <div>
          <dt>Grades</dt>
          <dd>{grades.length}</dd>
        </div>
        <div>
          <dt>Services</dt>
          <dd>3</dd>
        </div>
        <div>
          <dt>Fleet stage</dt>
          <dd>{stage}</dd>
        </div>
        {top ? (
          <div>
            <dt>Top rank at this stage</dt>
            <dd className="tally-words">{top.names.navy}</dd>
          </div>
        ) : null}
      </dl>
      <Ladder grades={grades} stage={stage} openServices={openServices} />
    </>
  );
}
