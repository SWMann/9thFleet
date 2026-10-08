import "server-only";
import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { cache } from "react";
import { areaPicture, type Domain } from "@/lib/areas";
import type { Service } from "@/lib/member";
import type { PictureName } from "@/lib/pictures";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * The fleet's roles, for anyone to read.
 *
 * A role is a kind of work, such as Gunner. It is a record of its own that an
 * admin keeps: what the role is, what it does, what it needs and where it
 * leads. A post is one place for that work, such as Turret Gunner 3 on UEES
 * Nexus, and every post has a role. So a role's page is about the role, and
 * lists the ships it is found on.
 *
 * This reads the structure only. It asks as a visitor, so it can never return
 * who holds a post. The database keeps people, appointments and applications
 * for the fleet itself.
 */

export type Requirement = { name: string; description: string; waivedWhenActing: boolean };

export type Band = { from: string; to: string; fromRank: string | null; toRank: string | null };

/** One place a role is found: its posts in one unit. */
export type Place = {
  /** The ship, flight or headquarters, such as "UEES Nexus". */
  where: string;
  /** The unit the posts sit in, such as "Gunnery". The same as `where` for posts held directly on a ship. */
  unit: string;
  /** The units above them, from the fleet down. */
  path: string[];
  service: Service | null;
  posts: number;
  /** What the posts are called there, and how many of each: seven Turret Gunners, two Remote Weapons Operators. */
  titles: { title: string; posts: number }[];
  /** How many of them a new member can be given. */
  entryPosts: number;
  /** The stage at which the first of them can be filled, and the last. */
  opensAtStage: number;
  lastOpensAtStage: number;
  open: boolean;
  /** For posts: the grades they can be held at there, with the rank names of the unit's service. */
  band: Band | null;
  /** For a duty: the lowest grade that can take it on, if one is set. */
  openTo: { grade: string; rank: string | null } | null;
  /** What the posts here need on top of what the role needs, and how many of them need it. */
  extra: (Requirement & { posts: number })[];
};

export type RoleLink = { slug: string; name: string; area: string };

export type Role = {
  slug: string;
  name: string;
  /** Its area's address and name. */
  area: string;
  areaName: string;
  kind: "primary" | "duty";
  summary: string;
  /** What the role does, one duty to an entry. Empty until an admin writes it. */
  duties: string[];
  /** Sections of the manual to read for this role, each as volume/section. */
  reading: string[];
  /** The role this one leads to, and the roles that lead to this one. */
  next: RoleLink | null;
  from: RoleLink[];
  /** How many posts there are of this role, across every place. */
  posts: number;
  /** Whether any of them can be given to a new member. */
  entry: boolean;
  opensAtStage: number;
  open: boolean;
  /** For posts: the lowest and highest grade it is held at anywhere. */
  grades: { from: string; to: string } | null;
  /** What every post of this role needs. */
  requirements: Requirement[];
  places: Place[];
};

export type AreaWithRoles = {
  slug: string;
  name: string;
  domain: Domain;
  picture: PictureName;
  about: string;
  /** For an area with no posts yet: when it opens and its size. */
  planned: { stage: number; size: string } | null;
  reading: string[];
  roles: Role[];
  /** Primary posts and duties in the order of battle. Both are 0 for an area that opens later. */
  posts: number;
  duties: number;
  opensAtStage: number;
  open: boolean;
};

export type Roles = { state: "no-database" } | { state: "ready"; stage: number; areas: AreaWithRoles[] };

type AreaRow = {
  id: string;
  slug: string;
  name: string;
  domain: Domain;
  picture: string;
  about: string;
  planned_stage: number | null;
  planned_size: string;
  reading: string[];
  sort_order: number;
};
type RoleRow = {
  id: string;
  slug: string;
  name: string;
  area_id: string;
  kind: "primary" | "duty";
  summary: string;
  duties: string;
  reading: string[];
  next_role_id: string | null;
  sort_order: number;
};
type UnitRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  service: Service | null;
  opens_at_stage: number;
  sort_order: number;
};
type PositionRow = {
  id: string;
  unit_id: string;
  role_id: string;
  title: string;
  kind: "primary" | "duty";
  min_grade: string | null;
  max_grade: string | null;
  is_entry: boolean;
  opens_at_stage: number;
  sort_order: number;
};

/** Units that are a place in their own right. A department belongs to the ship above it. */
const PLACES = new Set(["ship", "flight", "command", "staff", "task force", "fleet"]);

export const getRoles = cache(async (): Promise<Roles> => {
  // The stage and the records change, so read them when the page is asked for, not when the site is built.
  await connection();
  if (!supabaseEnv) return { state: "no-database" };
  const supabase = createClient(supabaseEnv.url, supabaseEnv.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const [settings, areas, roles, roleNeeds, units, positions, postNeeds, qualifications, grades, ranks] = await Promise.all([
    supabase.from("fleet_settings").select("current_stage").maybeSingle(),
    supabase.from("areas").select("id, slug, name, domain, picture, about, planned_stage, planned_size, reading, sort_order"),
    supabase.from("fleet_roles").select("id, slug, name, area_id, kind, summary, duties, reading, next_role_id, sort_order"),
    supabase.from("fleet_role_qualifications").select("role_id, qualification_id, waived_when_acting"),
    supabase.from("units").select("id, parent_id, name, kind, service, opens_at_stage, sort_order"),
    supabase
      .from("positions")
      .select("id, unit_id, role_id, title, kind, min_grade, max_grade, is_entry, opens_at_stage, sort_order"),
    supabase.from("position_qualifications").select("position_id, qualification_id, waived_when_acting"),
    supabase.from("qualifications").select("id, name, description"),
    supabase.from("grades").select("code, sort_order"),
    supabase.from("ranks").select("service, grade_code, name"),
  ]);
  for (const result of [settings, areas, roles, roleNeeds, units, positions, postNeeds, qualifications, grades, ranks]) {
    if (result.error) throw new Error(`The roles could not be read: ${result.error.message}`);
  }

  const stage: number = settings.data?.current_stage ?? 1;

  const rankName = new Map<string, string>();
  for (const rank of ranks.data ?? []) rankName.set(`${rank.service}:${rank.grade_code}`, rank.name);
  const gradeOrder = new Map<string, number>();
  for (const grade of grades.data ?? []) gradeOrder.set(grade.code, grade.sort_order);
  const lowest = (codes: string[]) => [...codes].sort((a, b) => (gradeOrder.get(a) ?? 0) - (gradeOrder.get(b) ?? 0))[0];
  const highest = (codes: string[]) => [...codes].sort((a, b) => (gradeOrder.get(b) ?? 0) - (gradeOrder.get(a) ?? 0))[0];

  const qualification = new Map<string, { name: string; description: string }>();
  for (const row of qualifications.data ?? []) qualification.set(row.id, row);
  const needs = (rows: { qualification_id: string; waived_when_acting: boolean }[]): Requirement[] =>
    rows
      .map((row) => {
        const found = qualification.get(row.qualification_id);
        return found ? { name: found.name, description: found.description, waivedWhenActing: row.waived_when_acting === true } : null;
      })
      .filter((entry): entry is Requirement => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

  const unitById = new Map<string, UnitRow>();
  for (const row of (units.data ?? []) as UnitRow[]) unitById.set(row.id, row);
  // The units from the fleet down to this one. The count guards against a loop of units.
  const lineOf = (unit: UnitRow): UnitRow[] => {
    const line = [unit];
    while (line[0].parent_id && line.length < 12) {
      const parent = unitById.get(line[0].parent_id);
      if (!parent) break;
      line.unshift(parent);
    }
    return line;
  };

  const areaRows = ((areas.data ?? []) as AreaRow[]).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const areaById = new Map(areaRows.map((row) => [row.id, row]));
  const roleRows = ((roles.data ?? []) as RoleRow[]).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const roleById = new Map(roleRows.map((row) => [row.id, row]));
  const linkTo = (row: RoleRow): RoleLink => ({ slug: row.slug, name: row.name, area: areaById.get(row.area_id)?.slug ?? "" });

  const postsOf = new Map<string, PositionRow[]>();
  for (const post of (positions.data ?? []) as PositionRow[]) {
    const list = postsOf.get(post.role_id) ?? [];
    list.push(post);
    postsOf.set(post.role_id, list);
  }

  const built = roleRows.map((row): Role => {
    const area = areaById.get(row.area_id);
    const mine = postsOf.get(row.id) ?? [];

    // The role's posts, unit by unit, in the order of battle's own order.
    const byUnit = new Map<string, PositionRow[]>();
    for (const post of mine) {
      const list = byUnit.get(post.unit_id) ?? [];
      list.push(post);
      byUnit.set(post.unit_id, list);
    }
    const places = [...byUnit.entries()]
      .map(([unitId, posts]) => {
        const unit = unitById.get(unitId);
        if (!unit) return null;
        const line = lineOf(unit);
        const place = [...line].reverse().find((entry) => PLACES.has(entry.kind)) ?? unit;
        const service = [...line].reverse().find((entry) => entry.service)?.service ?? null;
        const rank = (grade: string) => (service ? (rankName.get(`${service}:${grade}`) ?? null) : null);
        // A unit opens no earlier than the units above it, and a post no earlier than its unit.
        const opens = posts.map((post) => Math.max(post.opens_at_stage, ...line.map((entry) => entry.opens_at_stage)));

        const titles = new Map<string, number>();
        for (const post of [...posts].sort((a, b) => a.sort_order - b.sort_order)) {
          const title = post.title.replace(/ \d+$/, "");
          titles.set(title, (titles.get(title) ?? 0) + 1);
        }
        const extra = new Map<string, Requirement & { posts: number }>();
        for (const post of posts) {
          const rows = (postNeeds.data ?? []).filter((need) => need.position_id === post.id);
          for (const requirement of needs(rows)) {
            const known = extra.get(requirement.name);
            if (known) known.posts += 1;
            else extra.set(requirement.name, { ...requirement, posts: 1 });
          }
        }
        const floors = posts.map((post) => post.min_grade).filter((grade): grade is string => grade !== null);
        const ceilings = posts.map((post) => post.max_grade).filter((grade): grade is string => grade !== null);
        const found: Place = {
          where: place.name,
          unit: unit.name,
          path: line.map((entry) => entry.name),
          service,
          posts: posts.length,
          titles: [...titles.entries()].map(([title, count]) => ({ title, posts: count })),
          entryPosts: posts.filter((post) => post.is_entry).length,
          opensAtStage: Math.min(...opens),
          lastOpensAtStage: Math.max(...opens),
          open: Math.min(...opens) <= stage,
          band:
            row.kind === "primary" && floors.length > 0 && ceilings.length > 0
              ? { from: lowest(floors), to: highest(ceilings), fromRank: rank(lowest(floors)), toRank: rank(highest(ceilings)) }
              : null,
          openTo: row.kind === "duty" && floors.length > 0 ? { grade: lowest(floors), rank: rank(lowest(floors)) } : null,
          extra: [...extra.values()].sort((a, b) => a.name.localeCompare(b.name)),
        };
        return { place: found, order: line.map((entry) => entry.sort_order) };
      })
      .filter((entry): entry is { place: Place; order: number[] } => entry !== null)
      .sort((a, b) => {
        for (let index = 0; index < Math.max(a.order.length, b.order.length); index += 1) {
          const difference = (a.order[index] ?? -1) - (b.order[index] ?? -1);
          if (difference !== 0) return difference;
        }
        return 0;
      })
      .map((entry) => entry.place);

    const floors = places.map((place) => place.band?.from).filter((grade): grade is string => Boolean(grade));
    const ceilings = places.map((place) => place.band?.to).filter((grade): grade is string => Boolean(grade));
    const next = row.next_role_id ? roleById.get(row.next_role_id) : undefined;
    const opensAtStage = places.length > 0 ? Math.min(...places.map((place) => place.opensAtStage)) : 9;

    return {
      slug: row.slug,
      name: row.name,
      area: area?.slug ?? "",
      areaName: area?.name ?? "",
      kind: row.kind,
      summary: row.summary.trim(),
      duties: row.duties
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      reading: row.reading ?? [],
      next: next ? linkTo(next) : null,
      from: roleRows.filter((other) => other.next_role_id === row.id).map(linkTo),
      posts: mine.length,
      entry: mine.some((post) => post.is_entry),
      opensAtStage,
      open: places.some((place) => place.open),
      grades: floors.length > 0 && ceilings.length > 0 ? { from: lowest(floors), to: highest(ceilings) } : null,
      requirements: needs((roleNeeds.data ?? []).filter((need) => need.role_id === row.id)),
      places,
    };
  });

  return {
    state: "ready",
    stage,
    areas: areaRows.map((area): AreaWithRoles => {
      const mine = built.filter((role) => role.area === area.slug);
      const withPosts = mine.filter((role) => role.posts > 0);
      const opensAtStage = withPosts.length > 0 ? Math.min(...withPosts.map((role) => role.opensAtStage)) : (area.planned_stage ?? 9);
      return {
        slug: area.slug,
        name: area.name,
        domain: area.domain,
        picture: areaPicture(area.picture),
        about: area.about,
        planned: area.planned_stage ? { stage: area.planned_stage, size: area.planned_size } : null,
        reading: area.reading ?? [],
        roles: mine,
        posts: mine.filter((role) => role.kind === "primary").reduce((sum, role) => sum + role.posts, 0),
        duties: mine.filter((role) => role.kind === "duty").reduce((sum, role) => sum + role.posts, 0),
        opensAtStage,
        open: opensAtStage <= stage,
      };
    }),
  };
});

/** "E2 to E4", or one grade if the band is a single grade. */
export function gradeSpan(band: { from: string; to: string }): string {
  return band.from === band.to ? band.from : `${band.from} to ${band.to}`;
}

/** "Starman to Jr. Petty Officer", if the unit belongs to a service. */
export function rankSpan(band: Band): string | null {
  if (!band.fromRank || !band.toRank) return null;
  return band.fromRank === band.toRank ? band.fromRank : `${band.fromRank} to ${band.toRank}`;
}

/** "7 posts", "1 post", "11 duties". */
export function count(number: number, one: string, many: string): string {
  return `${number} ${number === 1 ? one : many}`;
}

/** An area's size in a few words: its posts, its duties, or what is planned for it. */
export function sizeOf(area: AreaWithRoles): string {
  if (area.posts > 0) return count(area.posts, "post", "posts");
  if (area.duties > 0) return count(area.duties, "duty", "duties");
  return area.planned?.size || "No posts yet";
}

/** Where a place is, in a few words: "Gunnery, UEES Nexus", or "Training Ship". */
export const placeName = (place: Place) => (place.unit === place.where ? place.where : `${place.unit}, ${place.where}`);

/** The distinct ships, flights and headquarters a role is found on, in order. */
export const shipsOf = (role: Role) => [...new Set(role.places.map((place) => place.where))];
