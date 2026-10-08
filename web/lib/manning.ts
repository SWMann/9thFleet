import type { Reply } from "@/lib/operations-form";

/**
 * Whether an event has the people it needs. This is worked out the same way
 * for the event's own page and for the admin pages, so it lives here.
 *
 * It only reports. Whether an event goes ahead is the operation commander's decision.
 */

export type Place = "in" | "reserve";

/** One member's line on an event's roll. */
export type RollLine = {
  memberId: string;
  reply: Reply | null;
  /** Attending with a place, or attending on the reserve list. Nothing for anyone else. */
  place: Place | null;
  /** A post of the order of battle they stand in for on the night. */
  standInFor: string | null;
  /** A post that exists for this event only, which they fill. */
  extraPost: string | null;
  repliedAt: string | null;
};

/** Whether a post's holder is in it on the night: attending with a place, and not moved to another post. */
export const inOwnPost = (line: RollLine | undefined): boolean =>
  line !== undefined && line.place === "in" && !line.standInFor && !line.extraPost;

export type Manning = {
  /**
   * go: it has what it needs. short: it does not yet, and members can still reply.
   * no-go: it does not, and the roll has closed.
   */
  state: "go" | "short" | "no-go";
  /** How many are attending with a place. */
  attending: number;
  minimum: number | null;
  /** Posts that must be filled and have nobody in them. */
  unfilled: string[];
};

/** What an event needs against what it has. Null for an event that sets no minimum and marks no post. */
export function manningOf(input: {
  minimum: number | null;
  /** The posts of the order of battle that must be filled, each with its holder if it has one. */
  keyPosts: { id: string; title: string; holderId: string | null }[];
  /** The event's own posts. */
  extraPosts: { id: string; title: string; mustFill: boolean }[];
  lines: RollLine[];
  rollOpen: boolean;
}): Manning | null {
  const must = input.extraPosts.filter((post) => post.mustFill);
  if (input.minimum === null && input.keyPosts.length === 0 && must.length === 0) return null;

  const byMember = new Map(input.lines.map((line) => [line.memberId, line]));
  const standIns = new Set(input.lines.map((line) => line.standInFor).filter(Boolean));
  const taken = new Set(input.lines.map((line) => line.extraPost).filter(Boolean));
  const unfilled = [
    ...input.keyPosts
      .filter((post) => !standIns.has(post.id) && !(post.holderId && inOwnPost(byMember.get(post.holderId))))
      .map((post) => post.title),
    ...must.filter((post) => !taken.has(post.id)).map((post) => post.title),
  ];
  const attending = input.lines.filter((line) => line.place === "in").length;
  const enough = (input.minimum === null || attending >= input.minimum) && unfilled.length === 0;
  return { state: enough ? "go" : input.rollOpen ? "short" : "no-go", attending, minimum: input.minimum, unfilled };
}

/** Why an event falls short, as a sentence or two. Empty when it does not. */
export function shortfall(manning: Manning): string {
  const parts: string[] = [];
  if (manning.minimum !== null && manning.attending < manning.minimum) {
    const short = manning.minimum - manning.attending;
    parts.push(`${short} more ${short === 1 ? "is" : "are"} needed to reach the minimum of ${manning.minimum}.`);
  }
  if (manning.unfilled.length > 0) {
    parts.push(`${manning.unfilled.length === 1 ? "A post that must be filled is empty" : "Posts that must be filled are empty"}: ${manning.unfilled.join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * The units that take part, given the ones an event names: each of those and
 * everything under it. Null means every unit, which is what naming none means.
 */
export function unitsTakingPart(units: { id: string; parentId: string | null }[], named: string[]): Set<string> | null {
  if (named.length === 0) return null;
  const taking = new Set(named);
  // The tree is shallow, so walking it until nothing is added is quick.
  let grew = true;
  while (grew) {
    grew = false;
    for (const unit of units) {
      if (unit.parentId && taking.has(unit.parentId) && !taking.has(unit.id)) {
        taking.add(unit.id);
        grew = true;
      }
    }
  }
  return taking;
}
