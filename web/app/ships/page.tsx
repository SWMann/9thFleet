import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { getRegister, shipKindOf, type CrewTemplate, type Ship } from "@/lib/ships";
import { readyWords, sinceWords } from "@/lib/ships-form";
import { shipKinds } from "@/lib/structure";
import { MarkForm, RemoveForm, ShipForm } from "./ShipForms";

export const metadata: Metadata = {
  title: "Ships",
  robots: { index: false, follow: false },
};

const title = (
  <>
    The <strong>register</strong>
  </>
);

export default function ShipsPage() {
  return (
    <Suspense fallback={<Head lead="Reading the register." />}>
      <Register />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="fleet" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

async function Register() {
  const result = await getRegister();
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="The register is for the serving fleet. You will see it once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { member, command, ships, models, templates, serving, strength, readAt: now } = result;
  const mine = ships.filter((ship) => ship.ownerId === member.id);
  const ready = ships.filter((ship) => ship.ready).length;
  const lead =
    ships.length === 0
      ? "Nothing is registered yet. Register the ships you own, and mark each one ready when it could sail."
      : `${ships.length} ${ships.length === 1 ? "hull" : "hulls"} on the register, ${readyWords(ready, ships.length)}. ${mine.length === 0 ? "None of them is yours yet." : `${mine.length} ${mine.length === 1 ? "is" : "are"} yours.`}`;
  const choices = models.filter((model) => model.flyable).map((model) => ({ id: model.id, name: model.name, kind: model.kind, crew: model.crewMin === model.crewMax ? `crew ${model.crewMin}` : `crew ${model.crewMin} to ${model.crewMax}` }));
  const standardOf = new Map(templates.filter((template) => template.isDefault).map((template) => [template.modelId, template]));
  const byKind = shipKinds.map((kind) => ({ kind, ships: ships.filter((ship) => ship.model.kind === kind.key) })).filter((group) => group.ships.length > 0);

  return (
    <>
      <Head lead={lead}>
        <p className="actions">
          <a className="button button-quiet" href="#register">
            Register a ship
          </a>
        </p>
      </Head>

      {strength.length > 0 ? (
        <section className="wrap band" aria-labelledby="readiness">
          <h2 id="readiness">
            What could <strong>sail tonight</strong>
          </h2>
          <ul className="strength-tiles">
            {strength.map((line) => (
              <li key={line.kind} className={line.ready === line.hulls ? "strength-tile strength-tile-good" : line.ready === 0 ? "strength-tile strength-tile-bad" : "strength-tile"}>
                <strong>{line.ready}</strong>
                <span>
                  of {line.hulls} {line.hulls === 1 ? line.name.replace(/s$/, "").toLowerCase() : line.name.toLowerCase()} ready
                </span>
              </li>
            ))}
          </ul>
          <p className="intro">
            Each owner marks their own ships. A ship marked not ready is withdrawn from the events it was offered for; whoever runs an event sees what is offered
            against what the plan needs.
          </p>
        </section>
      ) : null}

      <section className="wrap band" aria-labelledby="hulls">
        <h2 id="hulls">
          The <strong>hulls</strong>
        </h2>
        {ships.length === 0 ? (
          <p className="intro">The register is empty.</p>
        ) : (
          byKind.map((group) => (
            <div className="hull-group" key={group.kind.key}>
              <h3>{group.kind.many}</h3>
              <ul className="hulls">
                {group.ships.map((ship) => (
                  <HullCard key={ship.id} ship={ship} template={standardOf.get(ship.model.id) ?? null} now={now} choices={choices} owners={serving} command={command} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="wrap band" aria-labelledby="register">
        <h2 id="register">
          Register a <strong>ship</strong>
        </h2>
        <p className="intro">
          {command
            ? "Register one of your own, one of a member's, or a hull as the fleet's. Models missing from the list are added under Structure."
            : "Each of the ships you own, by its model. Mark it ready when it could sail tonight, and not ready when it is down for repair or claim."}
        </p>
        <ShipForm ship={null} models={choices} owners={serving} command={command} />
      </section>

      <section className="wrap band band-last" aria-labelledby="templates">
        <h2 id="templates">
          Crew <strong>templates</strong>
        </h2>
        <p className="intro">
          The stations aboard each model, as the fleet crews it. Every station is a role of the order of battle, so the readiness view can count who is qualified to
          fill it.{command ? " Command keeps these under Fleet admin." : ""}
        </p>
        <ul className="templates">
          {models
            .filter((model) => templates.some((template) => template.modelId === model.id && template.stations.length > 0))
            .map((model) => (
              <li key={model.id} className="template-card">
                <h3>
                  {model.name} <span className="chip">{shipKindOf(model.kind).name}</span>
                </h3>
                {templates
                  .filter((template) => template.modelId === model.id && template.stations.length > 0)
                  .map((template) => (
                    <TemplateLine key={template.id} template={template} />
                  ))}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}

function TemplateLine({ template }: { template: CrewTemplate }) {
  return (
    <p className="template-line">
      <strong>{template.name}</strong>
      {template.isDefault && template.name !== "Standard" ? <span className="chip">Standard</span> : null}
      <span className="template-stations">
        {template.stations.map((station) => `${station.count} × ${station.role}`).join(", ")} ({template.seats} {template.seats === 1 ? "seat" : "seats"})
      </span>
    </p>
  );
}

function HullCard({
  ship,
  template,
  now,
  choices,
  owners,
  command,
}: {
  ship: Ship;
  template: CrewTemplate | null;
  now: number;
  choices: { id: string; name: string; kind: string; crew: string }[];
  owners: { id: string; name: string }[];
  command: boolean;
}) {
  const label = ship.name ? `${ship.name}, ${ship.model.name}` : ship.model.name;
  const editable = ship.mine || command;
  // The form offers the ship's own model and owner even when the list would leave them out, so a save changes only what was changed.
  const models = choices.some((choice) => choice.id === ship.model.id)
    ? choices
    : [{ id: ship.model.id, name: ship.model.name, kind: ship.model.kind, crew: ship.model.crewMin === ship.model.crewMax ? `crew ${ship.model.crewMin}` : `crew ${ship.model.crewMin} to ${ship.model.crewMax}` }, ...choices];
  const ownerChoices = ship.ownerId === null || owners.some((owner) => owner.id === ship.ownerId) ? owners : [{ id: ship.ownerId, name: ship.owner }, ...owners];
  return (
    <li className={ship.ready ? "hull hull-ready" : "hull hull-down"}>
      <div className="hull-head">
        <h4>
          {ship.name ? <span className="hull-name">{ship.name}</span> : null}
          <span className="hull-model">{ship.model.name}</span>
        </h4>
        <span className={ship.ready ? "chip chip-on" : "chip chip-amber"}>{ship.ready ? "Ready" : "Not ready"}</span>
      </div>
      <p className="hull-facts">
        <span className="with-icon">
          <Icon name="person" size={14} />
          {ship.owner}
        </span>
        <span className="with-icon">
          <Icon name="clock" size={14} />
          Marked {sinceWords(ship.readyAsOf, now)}
        </span>
        {template && template.seats > 0 ? (
          <span className="with-icon">
            <Icon name="people" size={14} />
            {template.seats} {template.seats === 1 ? "seat" : "seats"}
          </span>
        ) : null}
      </p>
      {editable ? (
        <>
          {ship.note ? <p className="hull-note">{ship.note}</p> : null}
          <div className="hull-tools">
            <MarkForm id={ship.id} ready={ship.ready} />
            <details className="hull-edit">
              <summary>Change</summary>
              <ShipForm ship={{ id: ship.id, modelId: ship.model.id, ownerId: ship.ownerId, name: ship.name, ready: ship.ready, note: ship.note }} models={models} owners={ownerChoices} command={command} />
              <RemoveForm id={ship.id} label={label} />
            </details>
          </div>
        </>
      ) : null}
    </li>
  );
}
