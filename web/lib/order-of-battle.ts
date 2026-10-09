import "server-only";
import { getSession, isServing, type Service } from "@/lib/member";
import { createClient } from "@/lib/supabase/server";

/** Someone holding a post or a duty. */
export type Holder = {
  memberId: string;
  name: string | null;
  rankName: string | null;
  acting: boolean;
  you: boolean;
};

export type Requirement = { name: string; waivedWhenActing: boolean };

export type Post = {
  id: string;
  title: string;
  kind: "primary" | "duty";
  /** For a post: the grades it can be held at, with their rank names in the unit's service. */
  band: { from: string; to: string; fromRank: string | null; toRank: string | null } | null;
  /** For a duty: the lowest grade that can take it on, if it has one. */
  openTo: string | null;
  entry: boolean;
  /** Marked as a leader in its unit. Whoever commands a unit leads it whether or not their post is marked. */
  leader: boolean;
  opensAtStage: number;
  /** Whether it can be filled at the fleet's current stage. */
  open: boolean;
  requirements: Requirement[];
  holders: Holder[];
};

export type Unit = {
  id: string;
  name: string;
  kind: string;
  service: Service | null;
  opensAtStage: number;
  open: boolean;
  /** The post that commands this unit. It may sit in a unit under it, or anywhere else in the fleet. */
  commanderPostId: string | null;
  /** What the unit brings to an event: a short list an admin keeps. */
  brings: string[];
  /** The name of one of the site's pictures, if an admin gave it one. Without, it is drawn with the symbol for its kind. */
  picture: string | null;
  posts: Post[];
  units: Unit[];
};

export type Tally = { stage: number; open: number; filled: number; vacant: number; later: number };

export type OrderOfBattle =
  | { state: "no-database" }
  | { state: "signed-out" }
  | { state: "no-record" }
  /** Signed in, but not serving. Who holds each post is shown to the serving fleet only. */
  | { state: "outside" }
  | { state: "ready"; fleet: Unit; tally: Tally };

type UnitRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  service: Service | null;
  opens_at_stage: number;
  sort_order: number;
  commander_position_id: string | null;
  brings: string | null;
  picture: string | null;
};
type PositionRow = {
  id: string;
  unit_id: string;
  title: string;
  kind: "primary" | "duty";
  min_grade: string | null;
  max_grade: string | null;
  is_entry: boolean;
  is_leader: boolean;
  opens_at_stage: number;
  sort_order: number;
};
type RosterRow = {
  member_id: string;
  character_name: string | null;
  rank_name: string | null;
  acting: boolean | null;
  position_id: string | null;
};

/**
 * The fleet's units and posts, with who holds each, as the signed-in member is
 * allowed to see them. Every row comes through that member's own access: the
 * database's rules decide what is returned, not this code.
 */
export async function getOrderOfBattle(): Promise<OrderOfBattle> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  // Anyone may read the structure, so the database no longer hides the units
  // from someone outside the fleet. Who holds each post is for the serving
  // fleet, and this page shows holders, so it is refused here.
  if (!isServing(session.member)) return { state: "outside" };

  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [settings, units, positions, needs, qualifications, ranks, roster, duties] = await Promise.all([
    supabase.from("fleet_settings").select("current_stage").maybeSingle(),
    supabase.from("units").select("id, parent_id, name, kind, service, opens_at_stage, sort_order, commander_position_id, brings, picture"),
    supabase
      .from("positions")
      .select("id, unit_id, title, kind, min_grade, max_grade, is_entry, is_leader, opens_at_stage, sort_order"),
    supabase.from("position_qualifications").select("position_id, qualification_id, waived_when_acting"),
    supabase.from("qualifications").select("id, name"),
    supabase.from("ranks").select("service, grade_code, name"),
    supabase.from("roster").select("member_id, character_name, rank_name, acting, position_id"),
    supabase.from("assignments").select("member_id, position_id").eq("kind", "duty").is("ended_on", null),
  ]);
  for (const result of [settings, units, positions, needs, qualifications, ranks, roster, duties]) {
    if (result.error) {
      throw new Error(`The order of battle could not be read: ${result.error.message}`);
    }
  }

  const unitRows = (units.data ?? []) as UnitRow[];
  if (unitRows.length === 0) return { state: "outside" };

  const stage: number = settings.data?.current_stage ?? 1;
  const you = session.member.id;

  const rankName = new Map<string, string>();
  for (const rank of ranks.data ?? []) rankName.set(`${rank.service}:${rank.grade_code}`, rank.name);

  const qualificationName = new Map<string, string>();
  for (const row of qualifications.data ?? []) qualificationName.set(row.id, row.name);
  const requirements = new Map<string, Requirement[]>();
  for (const row of needs.data ?? []) {
    const name = qualificationName.get(row.qualification_id);
    if (!name) continue;
    const list = requirements.get(row.position_id) ?? [];
    list.push({ name, waivedWhenActing: row.waived_when_acting === true });
    requirements.set(row.position_id, list);
  }

  const members = new Map<string, RosterRow>();
  const holders = new Map<string, Holder[]>();
  const hold = (positionId: string, row: RosterRow) => {
    const list = holders.get(positionId) ?? [];
    list.push({
      memberId: row.member_id,
      name: row.character_name,
      rankName: row.rank_name,
      acting: row.acting === true,
      you: row.member_id === you,
    });
    holders.set(positionId, list);
  };
  for (const row of (roster.data ?? []) as RosterRow[]) {
    members.set(row.member_id, row);
    if (row.position_id) hold(row.position_id, row);
  }
  for (const duty of duties.data ?? []) {
    const row = members.get(duty.member_id);
    if (row) hold(duty.position_id, row);
  }

  const bySortOrder = <Row extends { sort_order: number }>(name: (row: Row) => string) => (a: Row, b: Row) =>
    a.sort_order - b.sort_order || name(a).localeCompare(name(b));

  const positionsByUnit = new Map<string, PositionRow[]>();
  for (const row of (positions.data ?? []) as PositionRow[]) {
    const list = positionsByUnit.get(row.unit_id) ?? [];
    list.push(row);
    positionsByUnit.set(row.unit_id, list);
  }
  const childrenOf = new Map<string | null, UnitRow[]>();
  for (const row of unitRows) {
    const list = childrenOf.get(row.parent_id) ?? [];
    list.push(row);
    childrenOf.set(row.parent_id, list);
  }

  const tally: Tally = { stage, open: 0, filled: 0, vacant: 0, later: 0 };

  // A unit opens no earlier than the units above it, and a post no earlier
  // than its unit. The database applies the same rule to appointments.
  const build = (row: UnitRow, opensAbove: number, seen: Set<string>): Unit => {
    const opensAt = Math.max(row.opens_at_stage, opensAbove);
    const posts = (positionsByUnit.get(row.id) ?? []).sort(bySortOrder((post) => post.title)).map((post): Post => {
      const postOpensAt = Math.max(post.opens_at_stage, opensAt);
      const held = holders.get(post.id) ?? [];
      const open = postOpensAt <= stage;
      if (post.kind === "primary") {
        if (!open) tally.later += 1;
        else {
          tally.open += 1;
          if (held.length > 0) tally.filled += 1;
          else tally.vacant += 1;
        }
      }
      const rank = (grade: string) => (row.service ? (rankName.get(`${row.service}:${grade}`) ?? null) : null);
      return {
        id: post.id,
        title: post.title,
        kind: post.kind,
        band:
          post.kind === "primary" && post.min_grade && post.max_grade
            ? { from: post.min_grade, to: post.max_grade, fromRank: rank(post.min_grade), toRank: rank(post.max_grade) }
            : null,
        openTo: post.kind === "duty" ? post.min_grade : null,
        entry: post.is_entry,
        leader: post.is_leader === true,
        opensAtStage: postOpensAt,
        open,
        requirements: (requirements.get(post.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
        holders: held,
      };
    });
    // Guard against a loop of units, which would otherwise never end.
    const below = (childrenOf.get(row.id) ?? []).filter((child) => !seen.has(child.id));
    for (const child of below) seen.add(child.id);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      service: row.service,
      opensAtStage: opensAt,
      open: opensAt <= stage,
      commanderPostId: row.commander_position_id ?? null,
      brings: linesOf(row.brings),
      picture: row.picture || null,
      posts,
      units: below.sort(bySortOrder((unit) => unit.name)).map((child) => build(child, opensAt, seen)),
    };
  };

  const roots = (childrenOf.get(null) ?? []).sort(bySortOrder((unit) => unit.name));
  const seen = new Set(roots.map((root) => root.id));
  const built = roots.map((root) => build(root, 1, seen));
  // One fleet is expected. If there is ever more than one top-level unit, show
  // them side by side under a plain heading instead of dropping any.
  const fleet: Unit =
    built.length === 1
      ? built[0]
      : { id: "all", name: "The fleet", kind: "fleet", service: null, opensAtStage: 1, open: true, commanderPostId: null, brings: [], picture: null, posts: [], units: built };

  return { state: "ready", fleet, tally };
}

/** A list kept as text, one thing to a line. */
const linesOf = (text: string | null | undefined) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Every post in a unit and the units below it. */
export function postsWithin(unit: Unit): Post[] {
  return [...unit.posts, ...unit.units.flatMap(postsWithin)];
}
