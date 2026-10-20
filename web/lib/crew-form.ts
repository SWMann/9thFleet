/**
 * The crew editor's payload: the whole of a template as command sends it,
 * read and checked before the database sees any of it. Nothing here reads
 * the database.
 */

export const STATION_NAME_LIMIT = 60;
export const STATION_BRIEF_LIMIT = 300;
export const GROUP_NAME_LIMIT = 60;
export const TEMPLATE_SOURCE_LIMIT = 300;
export const GROUP_LIMIT = 30;
export const STATION_LIMIT = 150;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A character that would hide in a name or a line: controls, zero-width marks, direction marks. */
export const HIDDEN = /[\u0000-\u001f\u007f\u200b\u2028-\u202e\u2060-\u2069\ufeff]/;

export type CrewPayload = {
  groups: { key: string; id: string | null; name: string }[];
  stations: { key: string; id: string | null; name: string; roleId: string; count: number; minimum: number; groupKey: string; brief: string; standInKey: string }[];
};

/** The payload once read: tidy, in order, with every reference checked. */
export type Crew = {
  groups: { key: string; id: string | null; name: string; sortOrder: number }[];
  stations: { key: string; id: string | null; name: string; roleId: string; count: number; minimum: number; groupKey: string | null; brief: string; standInKey: string | null; sortOrder: number }[];
};

const tidy = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const id = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value : null);
const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : NaN);

/** The crew as sent, or what is wrong with it. */
export function readCrew(raw: string): { crew: Crew } | { problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problem: "The crew could not be read. Reload the page and try again." };
  }
  if (!parsed || typeof parsed !== "object") return { problem: "The crew could not be read. Reload the page and try again." };
  const { groups, stations } = parsed as { groups?: unknown; stations?: unknown };
  if (!Array.isArray(groups) || !Array.isArray(stations)) return { problem: "The crew could not be read. Reload the page and try again." };
  if (groups.length > GROUP_LIMIT) return { problem: `A template has at most ${GROUP_LIMIT} departments.` };
  if (stations.length > STATION_LIMIT) return { problem: `A template has at most ${STATION_LIMIT} stations.` };

  const ids = new Set<string>();
  const once = (value: string | null) => {
    if (!value) return true;
    if (ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  const groupKeys = new Set<string>();
  const groupNames = new Set<string>();
  const readGroups: Crew["groups"] = [];
  for (const [index, entry] of groups.entries()) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const key = tidy(row.key);
    if (!key || groupKeys.has(key)) return { problem: "The crew could not be read. Reload the page and try again." };
    groupKeys.add(key);
    const name = tidy(row.name);
    if (!name) return { problem: `Department ${index + 1} needs a name.` };
    if (name.length > GROUP_NAME_LIMIT || HIDDEN.test(name)) return { problem: `Keep each department's name under ${GROUP_NAME_LIMIT} plain characters.` };
    if (groupNames.has(name.toLowerCase())) return { problem: `Two departments are called ${name}. Give each its own name.` };
    groupNames.add(name.toLowerCase());
    const groupId = id(row.id);
    if (!once(groupId)) return { problem: "The crew could not be read. Reload the page and try again." };
    readGroups.push({ key, id: groupId, name, sortOrder: index + 1 });
  }

  const stationKeys = new Set<string>();
  const seen = new Set<string>();
  const readStations: Crew["stations"] = [];
  for (const [index, entry] of stations.entries()) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const key = tidy(row.key);
    if (!key || stationKeys.has(key)) return { problem: "The crew could not be read. Reload the page and try again." };
    stationKeys.add(key);
    const roleId = id(row.roleId);
    if (!roleId) return { problem: `Station ${index + 1} needs a role.` };
    const name = tidy(row.name);
    if (name.length > STATION_NAME_LIMIT || HIDDEN.test(name)) return { problem: `Keep each station's name under ${STATION_NAME_LIMIT} plain characters.` };
    const brief = tidy(row.brief);
    if (brief.length > STATION_BRIEF_LIMIT || HIDDEN.test(brief)) return { problem: `Keep what a station does under ${STATION_BRIEF_LIMIT} plain characters.` };
    const count = whole(row.count);
    if (!(count >= 1 && count <= 99)) return { problem: `${name || "A station"} needs a whole number of seats from 1 to 99.` };
    const minimum = whole(row.minimum);
    if (!(minimum >= 0 && minimum <= count)) return { problem: `${name || "A station"}'s seats to sail are a whole number from 0 up to its seats.` };
    const groupKey = tidy(row.groupKey) || null;
    if (groupKey && !groupKeys.has(groupKey)) return { problem: "The crew could not be read. Reload the page and try again." };
    const standInKey = tidy(row.standInKey) || null;
    if (standInKey === key) return { problem: `${name || "A station"} cannot stand in for itself.` };
    const same = `${roleId}:${name.toLowerCase()}`;
    if (seen.has(same)) return { problem: `Two stations share the role and the name ${name ? `"${name}"` : "of the role"}. Give one of them a name of its own.` };
    seen.add(same);
    const stationId = id(row.id);
    if (!once(stationId)) return { problem: "The crew could not be read. Reload the page and try again." };
    readStations.push({ key, id: stationId, name, roleId, count, minimum, groupKey, brief, standInKey, sortOrder: index + 1 });
  }
  for (const station of readStations) {
    if (station.standInKey && !stationKeys.has(station.standInKey)) return { problem: "The crew could not be read. Reload the page and try again." };
  }
  return { crew: { groups: readGroups, stations: readStations } };
}
