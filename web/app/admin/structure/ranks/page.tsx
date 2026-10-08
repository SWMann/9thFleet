import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { gateStructure, loadRanks } from "@/lib/structure";
import { StructureNav } from "../StructureNav";
import { GradeForm } from "./RanksEditor";

export const metadata: Metadata = {
  title: "Ranks and grades",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Ranks and <strong>grades</strong>
  </>
);

export default function RanksEditorPage() {
  return (
    <Suspense fallback={<AdminHead current="structure" tier={null} title={title} lead="Reading the grades." />}>
      <Ranks />
    </Suspense>
  );
}

async function Ranks() {
  const access = await gateStructure("/admin/structure/ranks");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="structure" title={title} />;
  const loaded = await loadRanks();
  if (loaded.state !== "ready") return <AdminShut access={loaded} current="structure" title={title} />;

  return (
    <>
      <AdminHead
        current="structure"
        tier={access.tier}
        title={title}
        lead="What each service calls a grade, and what a member at that grade usually does."
      />
      <section className="wrap band band-last" aria-labelledby="grades">
        <StructureNav current="ranks" />
        <h2 id="grades">
          Every <strong>grade</strong>
        </h2>
        <p className="intro">
          The 18 grades, their codes and their order are fixed, because every post&apos;s band is written in them. The names are yours to
          change. <Link href="/ranks">See the ranks page</Link>.
        </p>
        {loaded.grades.map((grade) => (
          <GradeForm grade={grade} key={grade.code} />
        ))}
      </section>
    </>
  );
}
