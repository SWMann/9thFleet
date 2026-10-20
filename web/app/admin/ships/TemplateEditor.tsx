"use client";

import { useActionState, useState } from "react";
import { STATION_BRIEF_LIMIT, STATION_NAME_LIMIT, type CrewPayload } from "@/lib/crew-form";
import { saveCrew, type ShipResult } from "@/app/ships/actions";

const untouched: ShipResult = { ok: false, message: "" };

type GroupRow = { key: string; id: string | null; name: string };
type StationRow = { key: string; id: string | null; name: string; roleId: string; count: number; minimum: number; groupKey: string; brief: string; standInKey: string };

export type EditableTemplate = {
  id: string;
  groups: { id: string; name: string }[];
  stations: { id: string; name: string; roleId: string; count: number; minimum: number; groupId: string | null; brief: string; standInId: string | null }[];
};

/**
 * Command: the whole crew of a template on one screen. Departments at the
 * top, then a row per station with its role, seats, how many are needed to
 * sail, its department, what it does and its stand-in. One save sends it
 * all; the server works out what changed.
 */
export function TemplateEditor({ template, roles }: { template: EditableTemplate; roles: { id: string; name: string }[] }) {
  const [result, action, pending] = useActionState(saveCrew, untouched);
  return (
    <form action={action} className="crew-editor">
      <input type="hidden" name="template" value={template.id} />
      {/* The crew starts again from what the database holds after every save that reached it, so the ids are real. A crew refused before it was sent keeps its edits. */}
      <CrewFields key={result.stamp ?? 0} template={template} roles={roles} />
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the crew"}
        </button>
        {result.message && !pending ? (
          <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
            {result.message}
          </p>
        ) : null}
      </div>
      <p className="hint">
        A station needs a role; give it a name of its own where the role alone is vague, such as Turret gunner. To sail is how many of its seats the watch bill needs.
        A stand-in is another station of this template that covers it when empty.
      </p>
    </form>
  );
}

function CrewFields({ template, roles }: { template: EditableTemplate; roles: { id: string; name: string }[] }) {
  const [groups, setGroups] = useState<GroupRow[]>(() => template.groups.map((group) => ({ key: group.id, id: group.id, name: group.name })));
  const [stations, setStations] = useState<StationRow[]>(() =>
    template.stations.map((station) => ({
      key: station.id,
      id: station.id,
      name: station.name,
      roleId: station.roleId,
      count: station.count,
      minimum: station.minimum,
      groupKey: station.groupId ?? "",
      brief: station.brief,
      standInKey: station.standInId ?? "",
    })),
  );
  const [next, setNext] = useState(1);
  const fresh = (prefix: string) => {
    setNext((n) => n + 1);
    return `${prefix}-${next}`;
  };

  const move = <T,>(list: T[], index: number, by: number): T[] => {
    const to = index + by;
    if (to < 0 || to >= list.length) return list;
    const copy = [...list];
    [copy[index], copy[to]] = [copy[to], copy[index]];
    return copy;
  };
  const roleName = (id: string) => roles.find((role) => role.id === id)?.name ?? "A role";
  const stationLabel = (station: StationRow) => station.name || roleName(station.roleId);
  const payload: CrewPayload = {
    groups: groups.map((group) => ({ key: group.key, id: group.id, name: group.name })),
    stations: stations.map((station) => ({
      key: station.key,
      id: station.id,
      name: station.name,
      roleId: station.roleId,
      count: station.count,
      minimum: station.minimum,
      groupKey: station.groupKey,
      brief: station.brief,
      standInKey: station.standInKey,
    })),
  };
  const seats = stations.reduce((sum, station) => sum + (Number.isFinite(station.count) ? station.count : 0), 0);
  const minimum = stations.reduce((sum, station) => sum + (Number.isFinite(station.minimum) ? station.minimum : 0), 0);

  return (
    <>
      <input type="hidden" name="crew" value={JSON.stringify(payload)} />

      <fieldset className="crew-groups">
        <legend>Departments</legend>
        {groups.length === 0 ? <p className="hint">None yet. Stations without a department are listed on their own.</p> : null}
        <ol className="crew-group-list">
          {groups.map((group, index) => (
            <li key={group.key}>
              <input
                type="text"
                value={group.name}
                maxLength={60}
                placeholder="Bridge"
                aria-label={`Department ${index + 1} name`}
                onChange={(event) => setGroups(groups.map((row) => (row.key === group.key ? { ...row, name: event.target.value } : row)))}
              />
              <span className="crew-row-tools">
                <button type="button" className="button button-quiet button-small" aria-label={`Move ${group.name || "the department"} up`} disabled={index === 0} onClick={() => setGroups(move(groups, index, -1))}>
                  Up
                </button>
                <button type="button" className="button button-quiet button-small" aria-label={`Move ${group.name || "the department"} down`} disabled={index === groups.length - 1} onClick={() => setGroups(move(groups, index, 1))}>
                  Down
                </button>
                <button
                  type="button"
                  className="button button-quiet button-small"
                  aria-label={`Remove ${group.name || "the department"}`}
                  onClick={() => {
                    setGroups(groups.filter((row) => row.key !== group.key));
                    setStations(stations.map((station) => (station.groupKey === group.key ? { ...station, groupKey: "" } : station)));
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
        <button type="button" className="button button-quiet button-small" onClick={() => setGroups([...groups, { key: fresh("group"), id: null, name: "" }])}>
          Add a department
        </button>
      </fieldset>

      <fieldset className="crew-stations">
        <legend>
          Stations <span className="crew-editor-sum">{seats} seats, {minimum} to sail</span>
        </legend>
        {stations.length === 0 ? <p className="hint">No stations yet.</p> : null}
        <ol className="crew-station-list">
          {stations.map((station, index) => (
            <li key={station.key} className="crew-station">
              <div className="crew-station-main">
                <label>
                  <span>Role</span>
                  <select value={station.roleId} onChange={(event) => setStations(stations.map((row) => (row.key === station.key ? { ...row, roleId: event.target.value } : row)))} required>
                    <option value="" disabled>
                      Choose a role
                    </option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Station name</span>
                  <input
                    type="text"
                    value={station.name}
                    maxLength={STATION_NAME_LIMIT}
                    placeholder="Same as the role"
                    onChange={(event) => setStations(stations.map((row) => (row.key === station.key ? { ...row, name: event.target.value } : row)))}
                  />
                </label>
                <label className="crew-number">
                  <span>Seats</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={Number.isFinite(station.count) ? station.count : ""}
                    required
                    onChange={(event) => setStations(stations.map((row) => (row.key === station.key ? { ...row, count: event.target.valueAsNumber } : row)))}
                  />
                </label>
                <label className="crew-number">
                  <span>To sail</span>
                  <input
                    type="number"
                    min={0}
                    max={Number.isFinite(station.count) ? station.count : 99}
                    value={Number.isFinite(station.minimum) ? station.minimum : ""}
                    required
                    onChange={(event) => setStations(stations.map((row) => (row.key === station.key ? { ...row, minimum: event.target.valueAsNumber } : row)))}
                  />
                </label>
                <label>
                  <span>Department</span>
                  <select value={station.groupKey} onChange={(event) => setStations(stations.map((row) => (row.key === station.key ? { ...row, groupKey: event.target.value } : row)))}>
                    <option value="">None</option>
                    {groups.map((group) => (
                      <option key={group.key} value={group.key}>
                        {group.name || "Unnamed department"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Stand-in</span>
                  <select value={station.standInKey} onChange={(event) => setStations(stations.map((row) => (row.key === station.key ? { ...row, standInKey: event.target.value } : row)))}>
                    <option value="">None</option>
                    {stations
                      .filter((other) => other.key !== station.key)
                      .map((other) => (
                        <option key={other.key} value={other.key}>
                          {stationLabel(other)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label className="crew-brief-field">
                <span>What it does aboard this model</span>
                <input
                  type="text"
                  value={station.brief}
                  maxLength={STATION_BRIEF_LIMIT}
                  placeholder="Optional. One line."
                  onChange={(event) => setStations(stations.map((row) => (row.key === station.key ? { ...row, brief: event.target.value } : row)))}
                />
              </label>
              <span className="crew-row-tools">
                <button type="button" className="button button-quiet button-small" aria-label={`Move ${stationLabel(station)} up`} disabled={index === 0} onClick={() => setStations(move(stations, index, -1))}>
                  Up
                </button>
                <button type="button" className="button button-quiet button-small" aria-label={`Move ${stationLabel(station)} down`} disabled={index === stations.length - 1} onClick={() => setStations(move(stations, index, 1))}>
                  Down
                </button>
                <button
                  type="button"
                  className="button button-quiet button-small"
                  aria-label={`Remove ${stationLabel(station)}`}
                  onClick={() => setStations(stations.filter((row) => row.key !== station.key).map((row) => (row.standInKey === station.key ? { ...row, standInKey: "" } : row)))}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button button-quiet button-small"
          onClick={() => setStations([...stations, { key: fresh("station"), id: null, name: "", roleId: roles[0]?.id ?? "", count: 1, minimum: 0, groupKey: groups[0]?.key ?? "", brief: "", standInKey: "" }])}
        >
          Add a station
        </button>
      </fieldset>
    </>
  );
}
