/**
 * The force an event uses, worked out from the order of battle and the units
 * that were added. It is plain arithmetic with nothing of the server in it, so
 * the chart can redo it in the browser each time a unit is added or taken out.
 */

export type ForcePost = {
  id: string;
  title: string;
  /** Whoever holds it, by rank and name. Empty when nobody does. */
  holders: string[];
};

/** A picture for a unit: one of the site's own, with whose it is. */
export type ForcePicture = { src: string; focus: string; author: string; credit: string };

export type ForceUnit = {
  id: string;
  name: string;
  kind: string;
  /** Whether it can take part at the fleet's current stage. */
  open: boolean;
  opensAtStage: number;
  /** The open primary posts that sit in this unit itself. */
  posts: ForcePost[];
  /** What the unit brings: a short list an admin keeps. */
  brings: string[];
  picture: ForcePicture | null;
  units: ForceUnit[];
};

export type Strength = { posts: number; filled: number };

/** The posts in a unit and everything open under it, and how many are filled. */
export function strengthOf(unit: ForceUnit): Strength {
  if (!unit.open) return { posts: 0, filled: 0 };
  const strength = { posts: unit.posts.length, filled: unit.posts.filter((post) => post.holders.length > 0).length };
  for (const child of unit.units) {
    const below = strengthOf(child);
    strength.posts += below.posts;
    strength.filled += below.filled;
  }
  return strength;
}

/** "6 posts, 4 filled", in words that read for one and for none. */
export function strengthLine({ posts, filled }: Strength): string {
  if (posts === 0) return "No posts on the roll";
  const held = filled === 0 ? "none filled" : filled === posts ? "all filled" : `${filled} filled`;
  return `${posts} ${posts === 1 ? "post" : "posts"}, ${held}`;
}

/** What a unit and everything open under it brings, each thing once, in the order of battle's order. */
export function bringsOf(unit: ForceUnit, into: string[] = []): string[] {
  if (!unit.open) return into;
  for (const thing of unit.brings) if (!into.includes(thing)) into.push(thing);
  for (const child of unit.units) bringsOf(child, into);
  return into;
}

/**
 * The units that were added, as the chart holds them: only units that are in
 * the order of battle and open, and never a unit whose own ship or formation
 * was added too, since that already brings it.
 */
export function tidyChoice(fleet: ForceUnit, chosen: Iterable<string>): string[] {
  const wanted = new Set(chosen);
  const kept: string[] = [];
  const walk = (unit: ForceUnit, root: boolean) => {
    if (!unit.open) return;
    if (!root && wanted.has(unit.id)) {
      kept.push(unit.id);
      return;
    }
    for (const child of unit.units) walk(child, false);
  };
  walk(fleet, true);
  return kept;
}

export type Force = Strength & {
  /** Nothing was added, so the whole fleet takes part. */
  whole: boolean;
  /** The units added, each with its own strength. With none added, the fleet itself. */
  units: (Strength & { id: string; name: string })[];
  brings: string[];
};

/** What the units added come to. */
export function forceOf(fleet: ForceUnit, chosen: Iterable<string>): Force {
  const added = new Set(tidyChoice(fleet, chosen));
  if (added.size === 0) {
    const all = strengthOf(fleet);
    return { ...all, whole: true, units: [{ id: fleet.id, name: fleet.name, ...all }], brings: bringsOf(fleet) };
  }
  const force: Force = { posts: 0, filled: 0, whole: false, units: [], brings: [] };
  const walk = (unit: ForceUnit, above: string | null) => {
    if (added.has(unit.id)) {
      const strength = strengthOf(unit);
      force.posts += strength.posts;
      force.filled += strength.filled;
      // A department is named with its ship: "UEES Nexus, Gunnery".
      force.units.push({ id: unit.id, name: unit.kind === "department" && above ? `${above}, ${unit.name}` : unit.name, ...strength });
      bringsOf(unit, force.brings);
      return;
    }
    for (const child of unit.units) walk(child, unit.name);
  };
  walk(fleet, null);
  return force;
}

/** Every unit under this one, at any depth. */
export function unitsUnder(unit: ForceUnit): string[] {
  return unit.units.flatMap((child) => [child.id, ...unitsUnder(child)]);
}
