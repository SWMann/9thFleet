"use client";

import { useActionState } from "react";
import { SHIP_NAME_LIMIT, SHIP_NOTE_LIMIT } from "@/lib/ships-form";
import { shipKinds } from "@/lib/ship-kinds";
import { deleteTemplate, markShip, offerShip, registerShip, removeShip, saveModelRoles, saveShip, saveStation, saveTemplate, type ShipResult } from "./actions";

const untouched: ShipResult = { ok: false, message: "" };

function Result({ result }: { result: ShipResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

export type ModelChoice = { id: string; name: string; kind: string; maker: string; crew: string };
export type OwnerChoice = { id: string; name: string };

/**
 * Register a ship, or change one. A member registers their own; command may
 * name an owner, or register a hull as the fleet's.
 */
export function ShipForm({
  ship,
  models,
  owners,
  command,
}: {
  ship: { id: string; modelId: string; ownerId: string | null; name: string; ready: boolean; note: string | null } | null;
  models: ModelChoice[];
  /** Everyone serving, for command to name an owner. Empty for anyone else. */
  owners: OwnerChoice[];
  command: boolean;
}) {
  const [result, action, pending] = useActionState(ship ? saveShip : registerShip, untouched);
  const held = (key: string, value: string) => result.values?.[key] ?? value;
  const at = ship?.id ?? "new";
  return (
    <form action={action} className="fields ship-form" key={result.stamp ?? 0}>
      {ship ? <input type="hidden" name="id" value={ship.id} /> : null}
      <div className="field">
        <label htmlFor={`model_${at}`}>Model</label>
        <select id={`model_${at}`} name="model" defaultValue={held("model", ship?.modelId ?? "")} required disabled={Boolean(ship) && !command}>
          <option value="" disabled>
            Choose the model
          </option>
          {shipKinds
            .filter((kind) => models.some((model) => model.kind === kind.key))
            .map((kind) => (
              <optgroup key={kind.key} label={kind.many}>
                {models
                  .filter((model) => model.kind === kind.key)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.maker ? `${model.maker}, ` : ""}
                      {model.crew})
                    </option>
                  ))}
              </optgroup>
            ))}
        </select>
        {ship && !command ? <input type="hidden" name="model" value={ship.modelId} /> : null}
      </div>
      {command ? (
        <div className="field">
          <label htmlFor={`owner_${at}`}>Owner</label>
          <select id={`owner_${at}`} name="owner" defaultValue={held("owner", ship ? (ship.ownerId ?? "fleet") : "")}>
            {ship ? null : <option value="">Me</option>}
            <option value="fleet">The fleet</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`name_${at}`}>
          Name <span className="optional">Optional</span>
        </label>
        <p className="hint" id={`name_hint_${at}`}>
          What you call it, if anything. The fleet sees it.
        </p>
        <input id={`name_${at}`} name="name" type="text" defaultValue={held("name", ship?.name ?? "")} maxLength={SHIP_NAME_LIMIT} autoComplete="off" aria-describedby={`name_hint_${at}`} />
      </div>
      <div className="field">
        <label className="choice" htmlFor={`ready_${at}`}>
          <input id={`ready_${at}`} name="ready" type="checkbox" defaultChecked={result.values ? result.values.ready === "on" : (ship?.ready ?? true)} />
          <span>Ready: it could sail tonight</span>
        </label>
      </div>
      <div className="field">
        <label htmlFor={`note_${at}`}>
          Note <span className="optional">Optional</span>
        </label>
        <p className="hint" id={`note_hint_${at}`}>
          Where it is kept, what is fitted, what is wrong with it. For you and command only.
        </p>
        <textarea id={`note_${at}`} name="note" rows={2} defaultValue={held("note", ship?.note ?? "")} maxLength={SHIP_NOTE_LIMIT} aria-describedby={`note_hint_${at}`} />
      </div>
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : ship ? "Save" : "Register the ship"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Mark a ship ready, not ready or in claim, from its line: the two marks it is not. */
export function MarkForm({ id, ready, inClaim }: { id: string; ready: boolean; inClaim: boolean }) {
  const [result, action, pending] = useActionState(markShip, untouched);
  const marks: { value: string; label: string }[] = [
    ...(ready ? [] : [{ value: "ready", label: "Mark ready" }]),
    ...(ready || inClaim ? [{ value: "down", label: "Mark not ready" }] : []),
    ...(inClaim ? [] : [{ value: "claim", label: "Mark in claim" }]),
  ];
  return (
    <form action={action} className="inline-form marks">
      <input type="hidden" name="id" value={id} />
      {marks.map((mark) => (
        <button key={mark.value} className="button button-quiet button-small" type="submit" name="mark" value={mark.value} disabled={pending}>
          {pending ? "Marking" : mark.label}
        </button>
      ))}
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** Command: the roles a model fills, one of them primary. */
export function RolesForm({ model, roles, held }: { model: string; roles: { id: string; name: string; description: string }[]; held: { id: string; primary: boolean }[] }) {
  const [result, action, pending] = useActionState(saveModelRoles, untouched);
  const primary = held.find((role) => role.primary)?.id ?? held[0]?.id ?? "";
  return (
    <form action={action} className="roles-form" key={result.stamp ?? 0}>
      <input type="hidden" name="model" value={model} />
      <table className="roles-table">
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Fills it</th>
            <th scope="col">Primary</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id}>
              <th scope="row">
                <label htmlFor={`role_${model}_${role.id}`}>{role.name}</label>
                {role.description ? <small>{role.description}</small> : null}
              </th>
              <td>
                <input id={`role_${model}_${role.id}`} type="checkbox" name={`role_${role.id}`} defaultChecked={held.some((line) => line.id === role.id)} aria-label={`${role.name}: fills it`} />
              </td>
              <td>
                <input type="radio" name="primary" value={role.id} defaultChecked={primary === role.id} aria-label={`${role.name}: the primary role`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the roles"}
        </button>
        <Result result={result} />
      </div>
      <p className="hint">A model fills at least one role. The primary is the one it is listed under where one role is wanted.</p>
    </form>
  );
}

/** Take a ship off the register, after asking once. */
export function RemoveForm({ id, label }: { id: string; label: string }) {
  const [result, action, pending] = useActionState(removeShip, untouched);
  return (
    <details className="decisions">
      <summary>Remove from the register</summary>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <p className="hint">{label} comes off the register, with its note and any offer it is on.</p>
        <button className="button button-danger" type="submit" disabled={pending}>
          {pending ? "Removing" : "Yes, remove it"}
        </button>
        {result.message ? <Result result={result} /> : null}
      </form>
    </details>
  );
}

/** On an event: the reader's ready ships, each offered or not. */
export function OfferForm({ event, ships }: { event: string; ships: { id: string; label: string; offered: boolean }[] }) {
  const [result, action, pending] = useActionState(offerShip, untouched);
  return (
    <form action={action} className="offers" key={result.stamp ?? 0}>
      <input type="hidden" name="event" value={event} />
      <ul>
        {ships.map((ship) => (
          <li key={ship.id}>
            <span>{ship.label}</span>
            <button className={ship.offered ? "button button-quiet button-small" : "button button-small"} type="submit" name="ship" value={ship.id} disabled={pending}>
              {ship.offered ? "Withdraw" : "Bring it"}
            </button>
            <input type="hidden" name={`change_${ship.id}`} value={ship.offered ? "withdraw" : "offer"} />
          </li>
        ))}
      </ul>
      <Result result={result} />
    </form>
  );
}

/** Command: a crew template's name, and whether it is the standard. */
export function TemplateForm({ model, template }: { model: string; template: { id: string; name: string; isDefault: boolean } | null }) {
  const [result, action, pending] = useActionState(saveTemplate, untouched);
  const at = template?.id ?? `new_${model}`;
  return (
    <form action={action} className="fields template-form" key={result.stamp ?? 0}>
      <input type="hidden" name="model" value={model} />
      {template ? <input type="hidden" name="template" value={template.id} /> : null}
      <div className="field">
        <label htmlFor={`template_name_${at}`}>Template</label>
        <input id={`template_name_${at}`} name="name" type="text" defaultValue={template?.name ?? ""} maxLength={60} required autoComplete="off" placeholder="Army support" />
      </div>
      <div className="field">
        <label className="choice" htmlFor={`template_default_${at}`}>
          <input id={`template_default_${at}`} name="default" type="checkbox" defaultChecked={template?.isDefault ?? false} disabled={template?.isDefault ?? false} />
          <span>The standard template for this model</span>
        </label>
      </div>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : template ? "Save" : "Add the template"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

export function DeleteTemplateButton({ template }: { template: string }) {
  const [result, action, pending] = useActionState(deleteTemplate, untouched);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="template" value={template} />
      <button className="button button-quiet button-small" type="submit" disabled={pending}>
        {pending ? "Removing" : "Remove the template"}
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** Command: the stations of a template, one line per role, with how many. */
export function StationsForm({ template, roles, stations }: { template: string; roles: { id: string; name: string }[]; stations: { roleId: string; count: number }[] }) {
  const [result, action, pending] = useActionState(saveStation, untouched);
  const countOf = new Map(stations.map((station) => [station.roleId, station.count]));
  return (
    <form action={action} className="stations-form" key={result.stamp ?? 0}>
      <input type="hidden" name="template" value={template} />
      <div className="field field-short">
        <label htmlFor={`station_role_${template}`}>Station</label>
        <select id={`station_role_${template}`} name="role" required defaultValue="">
          <option value="" disabled>
            Choose a role
          </option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
              {countOf.has(role.id) ? ` (${countOf.get(role.id)} now)` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="field field-short">
        <label htmlFor={`station_count_${template}`}>How many</label>
        <input id={`station_count_${template}`} name="count" type="number" min={0} max={99} defaultValue={1} required />
      </div>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Set the station"}
        </button>
        <Result result={result} />
      </div>
      <p className="hint">Set a role to 0 to take its station away.</p>
    </form>
  );
}
