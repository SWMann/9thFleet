import { Icon } from "@/components/Icon";
import type { CrewTemplate, Ship } from "@/lib/ships";
import { sinceWords } from "@/lib/ships-form";
import { MarkForm, RemoveForm, ShipForm, type ModelChoice, type OwnerChoice } from "@/app/ships/ShipForms";

/** The mark a hull carries, as a chip. */
export function StateChip({ ship }: { ship: { ready: boolean; inClaim: boolean } }) {
  if (ship.ready) return <span className="chip chip-on">Ready</span>;
  return <span className="chip chip-amber">{ship.inClaim ? "In claim" : "Not ready"}</span>;
}

/**
 * One hull with its tools: the mark, and under Change the rest. On a
 * member's record it is theirs; under Fleet admin, anyone's.
 */
export function HullCard({
  ship,
  template,
  now,
  choices,
  owners,
  command,
  showOwner = true,
}: {
  ship: Ship;
  template: CrewTemplate | null;
  now: number;
  choices: ModelChoice[];
  owners: OwnerChoice[];
  command: boolean;
  showOwner?: boolean;
}) {
  const label = ship.name ? `${ship.name}, ${ship.model.name}` : ship.model.name;
  const editable = ship.mine || command;
  const crew = (model: Ship["model"]) => (model.crewMin === model.crewMax ? `crew ${model.crewMin}` : `crew ${model.crewMin} to ${model.crewMax}`);
  // The form offers the ship's own model and owner even when the list would leave them out, so a save changes only what was changed.
  const models = choices.some((choice) => choice.id === ship.model.id)
    ? choices
    : [{ id: ship.model.id, name: ship.model.name, kind: ship.model.kind, maker: ship.model.maker, crew: crew(ship.model) }, ...choices];
  const ownerChoices = ship.ownerId === null || owners.some((owner) => owner.id === ship.ownerId) ? owners : [{ id: ship.ownerId, name: ship.owner }, ...owners];
  return (
    <li className={ship.ready ? "hull hull-ready" : "hull hull-down"}>
      <div className="hull-head">
        <h4>
          {ship.name ? <span className="hull-name">{ship.name}</span> : null}
          <span className="hull-model">{ship.model.name}</span>
        </h4>
        <StateChip ship={ship} />
      </div>
      <p className="hull-facts">
        {showOwner ? (
          <span className="with-icon">
            <Icon name="person" size={14} />
            {ship.owner}
          </span>
        ) : null}
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
            <MarkForm id={ship.id} ready={ship.ready} inClaim={ship.inClaim} />
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

/** The flyable models as the register's form offers them. */
export const modelChoices = (models: Ship["model"][]): ModelChoice[] =>
  models
    .filter((model) => model.flyable)
    .map((model) => ({ id: model.id, name: model.name, kind: model.kind, maker: model.maker, crew: model.crewMin === model.crewMax ? `crew ${model.crewMin}` : `crew ${model.crewMin} to ${model.crewMax}` }));
