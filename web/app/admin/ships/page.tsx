import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { HullCard, modelChoices } from "@/components/ships/HullCard";
import { gate } from "@/lib/admin";
import { getRegister, shipKindOf } from "@/lib/ships";
import { createClient } from "@/lib/supabase/server";
import { CopyTemplateForm, DeleteTemplateButton, RolesForm, ShipForm, TemplateForm } from "@/app/ships/ShipForms";
import { TemplateEditor } from "./TemplateEditor";

export const metadata: Metadata = {
  title: "Ships",
  robots: { index: false, follow: false },
};

const title = (
  <>
    The <strong>ships</strong>
  </>
);

export default function ShipsAdminPage() {
  return (
    <Suspense fallback={<AdminHead current="ships" tier={null} title={title} lead="Reading the register." />}>
      <Ships />
    </Suspense>
  );
}

/**
 * Command's side of the register: the fleet's own hulls, a form to register
 * a hull for anyone, every hull with the tools to correct it, and for each
 * model its roles and crew templates.
 */
async function Ships() {
  const access = await gate("command", "/admin/ships");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="ships" title={title} />;
  const supabase = await createClient();
  if (!supabase) return <AdminShut access={{ state: "no-database" }} current="ships" title={title} />;
  const [register, roles] = await Promise.all([getRegister(), supabase.from("fleet_roles").select("id, name, kind, sort_order")]);
  if (roles.error) throw new Error(`The roles could not be read: ${roles.error.message}`);
  if (register.state !== "ready") return <AdminShut access={{ state: "no-database" }} current="ships" title={title} />;
  const { ships, models, templates, roles: shipRoles, serving, command, readAt: now } = register;
  const roleChoices = ((roles.data ?? []) as { id: string; name: string; kind: string; sort_order: number }[])
    .filter((role) => role.kind === "primary")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((role) => ({ id: role.id, name: role.name }));
  const modelName = new Map(models.map((model) => [model.id, model.name]));
  const copySources = templates
    .filter((template) => template.stations.length > 0)
    .map((template) => ({ id: template.id, label: `${modelName.get(template.modelId) ?? "A model"}: ${template.name} (${template.seats} ${template.seats === 1 ? "seat" : "seats"})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const choices = modelChoices(models);
  const standardOf = new Map(templates.filter((template) => template.isDefault).map((template) => [template.modelId, template]));
  const fleets = ships.filter((ship) => ship.ownerId === null);
  const owned = ships.filter((ship) => ship.ownerId !== null).sort((a, b) => a.owner.localeCompare(b.owner) || a.model.name.localeCompare(b.model.name) || a.name.localeCompare(b.name));
  const owners = [...new Set(owned.map((ship) => ship.owner))];

  return (
    <>
      <AdminHead
        current="ships"
        tier={access.tier}
        title={title}
        lead="The fleet's own hulls, every member's with the tools to correct them, and for each model the roles it fills and the stations aboard it. An admin adds the models themselves under Structure. The fleet reads the board and the model pages; a note stays with its owner and command."
      />

      <section className="wrap band" aria-labelledby="fleets">
        <h2 id="fleets">
          The fleet&apos;s <strong>hulls</strong>
        </h2>
        <p className="intro">
          Hulls that are the fleet&apos;s rather than a member&apos;s. Command marks them and offers them for events without attending. Every change is written to the{" "}
          <Link href="/admin/logs?show=personnel">logs</Link>.
        </p>
        {fleets.length === 0 ? (
          <p className="intro">None yet.</p>
        ) : (
          <ul className="hulls">
            {fleets.map((ship) => (
              <HullCard key={ship.id} ship={ship} template={standardOf.get(ship.model.id) ?? null} now={now} choices={choices} owners={serving} command={command} />
            ))}
          </ul>
        )}
        <details className="add-lesson">
          <summary>Register a hull</summary>
          <p className="hint">One of your own, one of a member&apos;s, or a hull as the fleet&apos;s.</p>
          <ShipForm ship={null} models={choices} owners={serving} command={command} />
        </details>
      </section>

      <section className="wrap band" aria-labelledby="owned">
        <h2 id="owned">
          Members&apos; <strong>hulls</strong>
        </h2>
        <p className="intro">
          {owned.length === 0 ? "Nobody has registered a ship yet." : `${owned.length} ${owned.length === 1 ? "hull" : "hulls"}, by owner. Each owner keeps their own from their record; correct an entry here when you must.`}
        </p>
        {owners.map((owner) => (
          <div className="hull-group" key={owner}>
            <h3>{owner}</h3>
            <ul className="hulls">
              {owned
                .filter((ship) => ship.owner === owner)
                .map((ship) => (
                  <HullCard key={ship.id} ship={ship} template={standardOf.get(ship.model.id) ?? null} now={now} choices={choices} owners={serving} command={command} showOwner={false} />
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="wrap band band-last" aria-labelledby="models">
        <h2 id="models">
          The <strong>models</strong>
        </h2>
        <p className="intro">
          Each model&apos;s roles, one of them primary, and its crew templates: the stations aboard, each a role of the order of battle with a count. One template is
          the standard; a variant is for a purpose, such as Army support. Volume 1 sets the Idris&apos;s standard crew and the escorts&apos;. The roles themselves are
          an admin&apos;s, under <Link href="/admin/structure/ship-roles">Structure</Link>.
        </p>
        <div className="syllabus-editor">
          {models.map((model) => (
            <section className="syllabus-course" key={model.id} aria-labelledby={`model-${model.slug}`}>
              <h3 id={`model-${model.slug}`}>
                <Link href={`/ships/models/${model.slug}`}>{model.name}</Link> <span className="chip">{shipKindOf(model.kind).name}</span>
                <span className="chip">{model.crewMin === model.crewMax ? `crew ${model.crewMin}` : `crew ${model.crewMin} to ${model.crewMax}`}</span>
                {model.flyable ? null : <span className="chip chip-amber">Not flyable yet</span>}
              </h3>
              <details className="template-editor" open={model.roles.length === 0}>
                <summary>
                  <strong>Roles</strong>
                  <span className="lesson-about">{model.roles.length > 0 ? model.roles.map((role) => (role.primary ? `${role.name} (primary)` : role.name)).join(", ") : "None yet"}</span>
                </summary>
                <RolesForm model={model.id} roles={shipRoles} held={model.roles.map((role) => ({ id: role.id, primary: role.primary }))} />
              </details>
              {templates
                .filter((template) => template.modelId === model.id)
                .map((template) => (
                  <details className="template-editor" key={template.id} open={template.isDefault && template.stations.length === 0}>
                    <summary>
                      <strong>{template.name}</strong>
                      {template.isDefault && template.name !== "Standard" ? <span className="chip">Standard</span> : null}
                      <span className="lesson-about">
                        {template.stations.length > 0
                          ? `${template.stations.map((station) => `${station.count} × ${station.name || station.role}`).join(", ")} (${template.seats} seats, ${template.minimumSeats} to sail)`
                          : "No stations yet"}
                      </span>
                    </summary>
                    <TemplateForm model={model.id} template={{ id: template.id, name: template.name, isDefault: template.isDefault, source: template.source }} />
                    <TemplateEditor
                      template={{
                        id: template.id,
                        groups: template.groups.map((group) => ({ id: group.id, name: group.name })),
                        stations: template.stations.map((station) => ({
                          id: station.id,
                          name: station.name,
                          roleId: station.roleId,
                          count: station.count,
                          minimum: station.minimum,
                          groupId: station.groupId,
                          brief: station.brief,
                          standInId: station.standInId,
                        })),
                      }}
                      roles={roleChoices}
                    />
                    {template.isDefault ? null : <DeleteTemplateButton template={template.id} />}
                  </details>
                ))}
              <details className="add-lesson">
                <summary>Add a variant for {model.name}</summary>
                <TemplateForm model={model.id} template={null} />
              </details>
              <details className="add-lesson">
                <summary>Copy a template into {model.name}</summary>
                <CopyTemplateForm model={model.id} sources={copySources} />
              </details>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
