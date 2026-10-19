import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { gate } from "@/lib/admin";
import { getModels, shipKindOf } from "@/lib/ships";
import { createClient } from "@/lib/supabase/server";
import { DeleteTemplateButton, StationsForm, TemplateForm } from "@/app/ships/ShipForms";

export const metadata: Metadata = {
  title: "Crew templates",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Crew <strong>templates</strong>
  </>
);

export default function ShipsAdminPage() {
  return (
    <Suspense fallback={<AdminHead current="ships" tier={null} title={title} lead="Reading the templates." />}>
      <Templates />
    </Suspense>
  );
}

async function Templates() {
  const access = await gate("command", "/admin/ships");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="ships" title={title} />;
  const supabase = await createClient();
  if (!supabase) return <AdminShut access={{ state: "no-database" }} current="ships" title={title} />;
  const [catalogue, roles] = await Promise.all([getModels(supabase), supabase.from("fleet_roles").select("id, name, kind, sort_order")]);
  if (roles.error) throw new Error(`The roles could not be read: ${roles.error.message}`);
  const roleChoices = ((roles.data ?? []) as { id: string; name: string; kind: string; sort_order: number }[])
    .filter((role) => role.kind === "primary")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((role) => ({ id: role.id, name: role.name }));

  return (
    <>
      <AdminHead
        current="ships"
        tier={access.tier}
        title={title}
        lead="The stations aboard each model, each a role of the order of battle with a count. One template is the standard; a variant is for a role, such as Army support. Command keeps these; an admin adds the models themselves under Structure."
      />
      <section className="wrap band band-last" aria-labelledby="models">
        <h2 id="models">
          The <strong>models</strong>
        </h2>
        <p className="intro">
          Volume 1 sets the Idris&apos;s standard crew and the escorts&apos;. Every change is written to the <Link href="/admin/logs?show=structure">logs</Link>. The
          fleet reads the templates on <Link href="/ships">the register</Link>.
        </p>
        <div className="syllabus-editor">
          {catalogue.models.map((model) => (
            <section className="syllabus-course" key={model.id} aria-labelledby={`model-${model.slug}`}>
              <h3 id={`model-${model.slug}`}>
                {model.name} <span className="chip">{shipKindOf(model.kind).name}</span>
                <span className="chip">{model.crewMin === model.crewMax ? `crew ${model.crewMin}` : `crew ${model.crewMin} to ${model.crewMax}`}</span>
                {model.flyable ? null : <span className="chip chip-amber">Not flyable yet</span>}
              </h3>
              {catalogue.templates
                .filter((template) => template.modelId === model.id)
                .map((template) => (
                  <details className="template-editor" key={template.id} open={template.isDefault && template.stations.length === 0}>
                    <summary>
                      <strong>{template.name}</strong>
                      {template.isDefault && template.name !== "Standard" ? <span className="chip">Standard</span> : null}
                      <span className="lesson-about">
                        {template.stations.length > 0 ? `${template.stations.map((station) => `${station.count} × ${station.role}`).join(", ")} (${template.seats} seats)` : "No stations yet"}
                      </span>
                    </summary>
                    <TemplateForm model={model.id} template={{ id: template.id, name: template.name, isDefault: template.isDefault }} />
                    <StationsForm template={template.id} roles={roleChoices} stations={template.stations.map((station) => ({ roleId: station.roleId, count: station.count }))} />
                    {template.isDefault ? null : <DeleteTemplateButton template={template.id} />}
                  </details>
                ))}
              <details className="add-lesson">
                <summary>Add a variant for {model.name}</summary>
                <TemplateForm model={model.id} template={null} />
              </details>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
