import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { countStructure, gateStructure, sheets } from "@/lib/structure";

export const metadata: Metadata = {
  title: "Structure",
  robots: { index: false, follow: false },
};

const title = <strong>Structure</strong>;

export default function StructurePage() {
  return (
    <Suspense fallback={<AdminHead current="structure" tier={null} title={title} lead="Reading the fleet's structure." />}>
      <Structure />
    </Suspense>
  );
}

async function Structure() {
  const access = await gateStructure("/admin/structure");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="structure" title={title} />;
  const counted = await countStructure();
  if (counted.state !== "ready") return <AdminShut access={counted} current="structure" title={title} />;
  const { counts } = counted;

  return (
    <>
      <AdminHead
        current="structure"
        tier={access.tier}
        title={title}
        lead="What the fleet is made of: its areas, roles, units, posts, qualifications and ranks. Change any of it here, and the site follows."
      />
      <section className="wrap band band-last" aria-labelledby="editors">
        <h2 id="editors">
          The <strong>editors</strong>
        </h2>
        <ul className="role-cards">
          {sheets.map((sheet) => (
            <li className="role-card" key={sheet.key}>
              <p className="role-card-chips">
                <span className="chip">{counts[sheet.key]}</span>
              </p>
              <h3>
                <Link href={`/admin/structure/${sheet.key}`}>{sheet.many}</Link>
              </h3>
              <p className="role-card-summary">{sheet.about}</p>
            </li>
          ))}
          <li className="role-card">
            <p className="role-card-chips">
              <span className="chip">{counts.grades} grades</span>
            </p>
            <h3>
              <Link href="/admin/structure/ranks">Ranks and grades</Link>
            </h3>
            <p className="role-card-summary">What each service calls a grade, and what a member at that grade usually does.</p>
          </li>
        </ul>
        <div className="prose log-note">
          <p>
            Only an admin can change these. Every change is written to the <Link href="/admin/logs?show=structure">logs</Link> with who made
            it and what it was before. A role keeps to its kind while it has posts, and a post that someone has held cannot be removed.
          </p>
        </div>
      </section>
    </>
  );
}
