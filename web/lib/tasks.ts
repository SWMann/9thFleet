import type { IconName } from "@/components/Icon";
import type { Post, Unit } from "@/lib/order-of-battle";

/**
 * A unit's task for an event, and who reads it.
 *
 * The database decides who may read a task's words. What is here says the same
 * thing in words, for whoever sets the level, and works out where the reader
 * stands in a unit so the page can offer what the database will allow.
 */

export type TaskLevel = "everyone" | "unit" | "leaders" | "commander";

export const taskLevels: { key: TaskLevel; label: string; about: string }[] = [
  { key: "everyone", label: "Everyone", about: "Anyone who can read the event." },
  { key: "unit", label: "The unit", about: "Everyone posted in the unit, or standing in there for the night." },
  { key: "leaders", label: "Its leaders", about: "The unit's commander and the leaders under them." },
  { key: "commander", label: "Its commander", about: "The unit's commander alone, until they pass it down." },
];

/** Each level has its own picture, so who a task is for can be told without reading its colour. */
export const levelIcons: Record<TaskLevel, IconName> = {
  everyone: "eye",
  unit: "people",
  leaders: "chevrons",
  commander: "star",
};

export const levelName = (level: TaskLevel) => taskLevels.find((entry) => entry.key === level)?.label ?? level;

type Entry = { unit: Unit; parentId: string | null; path: string; depth: number };
export type FleetIndex = {
  units: Map<string, Entry>;
  /** Every post, with the unit it sits in. */
  posts: Map<string, { post: Post; unitId: string }>;
  /** Units in the order of battle's own order, the fleet first. */
  order: string[];
};

export function indexFleet(fleet: Unit): FleetIndex {
  const index: FleetIndex = { units: new Map(), posts: new Map(), order: [] };
  const walk = (unit: Unit, parent: Unit | null, above: string[], depth: number) => {
    // The fleet itself is left out of a unit's path: "Task Force Jericho › UEES Nexus".
    const path = parent ? [...above, unit.name] : [];
    index.units.set(unit.id, { unit, parentId: parent?.id ?? null, path: path.join(" › ") || unit.name, depth });
    index.order.push(unit.id);
    for (const post of unit.posts) index.posts.set(post.id, { post, unitId: unit.id });
    for (const child of unit.units) walk(child, unit, path, depth + 1);
  };
  walk(fleet, null, [], 0);
  return index;
}

/** A unit and every unit under it. */
export function unitAndBelow(index: FleetIndex, id: string): string[] {
  const found: string[] = [];
  const walk = (unit: Unit) => {
    found.push(unit.id);
    for (const child of unit.units) walk(child);
  };
  const entry = index.units.get(id);
  if (entry) walk(entry.unit);
  return found;
}

/** The units above a unit, the nearest first. */
export function unitsAbove(index: FleetIndex, id: string): string[] {
  const found: string[] = [];
  let at = index.units.get(id)?.parentId ?? null;
  while (at && found.length < 20) {
    found.push(at);
    at = index.units.get(at)?.parentId ?? null;
  }
  return found;
}

/** The posts that lead in a unit: whoever commands it or a unit under it, and posts in it marked as a leader's. */
function leaderPosts(index: FleetIndex, id: string): string[] {
  const units = unitAndBelow(index, id);
  const commanders = new Set(units.map((unit) => index.units.get(unit)?.unit.commanderPostId).filter((post): post is string => Boolean(post)));
  const found = new Set<string>();
  const own = index.units.get(id)?.unit.commanderPostId;
  if (own) found.add(own);
  for (const unit of units) {
    for (const post of index.units.get(unit)?.unit.posts ?? []) {
      if (post.leader || commanders.has(post.id)) found.add(post.id);
    }
  }
  return [...found];
}

/** A post as a sentence names it: its title, with the unit it commands or sits in when the title alone could be another post. */
function postName(index: FleetIndex, id: string): string {
  const found = index.posts.get(id);
  if (!found) return "a post that has been removed";
  const title = found.post.title;
  const shared = [...index.posts.values()].filter((entry) => entry.post.title === title).length > 1;
  if (!shared) return title;
  // The largest unit it commands says most about it: "Commanding Officer, UEES Nexus".
  const commanded = index.order.find((unit) => index.units.get(unit)?.unit.commanderPostId === id);
  return `${title}, ${index.units.get(commanded ?? found.unitId)?.unit.name ?? ""}`;
}

export type Audience = {
  /** How many posts sit in the unit and under it. */
  posts: number;
  leaders: string[];
  commander: string | null;
  /** Whoever commands the units above, the nearest first. */
  above: string[];
};

export function audienceOf(index: FleetIndex, id: string): Audience {
  const units = unitAndBelow(index, id);
  const commander = index.units.get(id)?.unit.commanderPostId ?? null;
  const above = new Set<string>();
  for (const unit of unitsAbove(index, id)) {
    const post = index.units.get(unit)?.unit.commanderPostId;
    if (post && post !== commander) above.add(post);
  }
  return {
    posts: units.reduce((sum, unit) => sum + (index.units.get(unit)?.unit.posts.length ?? 0), 0),
    leaders: leaderPosts(index, id).map((post) => postName(index, post)),
    commander: commander ? postName(index, commander) : null,
    above: [...above].map((post) => postName(index, post)),
  };
}

const listed = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Who reads a task at a level, in a sentence or two. */
export function readsLine(unit: string, level: TaskLevel, audience: Audience): string {
  if (level === "everyone") return "Read by everyone who can read the event.";
  const above = audience.above.length > 0 ? ` Above them: ${listed(audience.above)}.` : "";
  if (level === "unit") {
    return `Read by everyone posted in ${unit}, which is ${audience.posts} ${audience.posts === 1 ? "post" : "posts"}.${above}`;
  }
  if (level === "leaders") {
    return audience.leaders.length > 0
      ? `Read by the leaders of ${unit}: ${listed(audience.leaders)}.${above}`
      : `${unit} has no leader, so nobody in it reads this.${above}`;
  }
  return audience.commander
    ? `Read by ${audience.commander} alone.${above}`
    : `${unit} has no commander, so nobody in it reads this. An admin names one under Structure.${above}`;
}

/** Where someone stands in a unit, given the posts they fill: the ones they hold, and one they stand in for on the night. */
export function standingIn(index: FleetIndex, id: string, filled: Set<string>) {
  const units = new Set(unitAndBelow(index, id));
  const commander = index.units.get(id)?.unit.commanderPostId ?? null;
  return {
    inUnit: [...filled].some((post) => units.has(index.posts.get(post)?.unitId ?? "")),
    commands: commander !== null && filled.has(commander),
  };
}

/** The levels a unit's commander may pass its task down to. */
export function passableTo(level: TaskLevel): TaskLevel[] {
  if (level === "commander") return ["leaders", "unit"];
  if (level === "leaders") return ["unit"];
  return [];
}
