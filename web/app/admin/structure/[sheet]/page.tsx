import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { gateStructure, loadSheet, sheetOf } from "@/lib/structure";
import { Editor } from "../Editor";
import { StructureNav } from "../StructureNav";

type Props = PageProps<"/admin/structure/[sheet]">;

export const metadata: Metadata = {
  title: "Structure",
  robots: { index: false, follow: false },
};

const fallbackTitle = <strong>Structure</strong>;

export default function SheetPage({ params }: Props) {
  return (
    <Suspense fallback={<AdminHead current="structure" tier={null} title={fallbackTitle} lead="Reading the records." />}>
      <SheetEditor params={params} />
    </Suspense>
  );
}

async function SheetEditor({ params }: { params: Props["params"] }) {
  const sheet = sheetOf((await params).sheet);
  if (!sheet) notFound();
  const title = <strong>{sheet.many}</strong>;

  const access = await gateStructure(`/admin/structure/${sheet.key}`);
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="structure" title={title} />;
  const loaded = await loadSheet(sheet);
  if (loaded.state !== "ready") return <AdminShut access={loaded} current="structure" title={title} />;

  return (
    <>
      <AdminHead current="structure" tier={access.tier} title={title} lead={sheet.about} />
      <section className="wrap band band-last" aria-labelledby="records">
        <StructureNav current={sheet.key} />
        <h2 id="records">
          Every <strong>{sheet.one}</strong>
        </h2>
        <Editor
          sheet={{ key: sheet.key, one: sheet.one, needsAbout: sheet.needs?.about ?? null }}
          fields={loaded.fields}
          records={loaded.records}
          qualifications={loaded.qualifications}
        />
      </section>
    </>
  );
}
