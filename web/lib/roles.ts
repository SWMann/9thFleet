import "server-only";
import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { cache } from "react";
import { areaOf, areas, otherArea, type Area } from "@/lib/areas";
import type { Service } from "@/lib/member";
import { slugify } from "@/lib/slug";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * The fleet's roles, for anyone to read. A role is a kind of post in one place:
 * the seven Turret Gunner posts on UEES Nexus are one role.
 *
 * This reads the structure only: units, posts and what each post requires. It
 * asks as a visitor, so it can never return who holds a post. The database
 * keeps people, appointments and applications for the fleet itself.
 */

export type Requirement = { name: string; description: string; waivedWhenActing: boolean };

export type Role = {
  slug: string;
  title: string;
  area: string;
  kind: "primary" | "duty";
  /** The ship, flight or headquarters it belongs to, such as "UEES Nexus". */
  where: string;
  /** The unit it sits in, such as "Gunnery". The same as `where` for a post held directly on a ship. */
  unit: string;
  /** The units above it, from the fleet down. */
  path: string[];
  service: Service | null;
  /** How many posts of this kind there are here. */
  posts: number;
  entry: boolean;
  /** The stage at which the first of them can be filled, and the last. */
  opensAtStage: number;
  lastOpensAtStage: number;
  open: boolean;
  /** For a post: the grades it can be held at, with their rank names in the unit's service. */
  band: { from: string; to: string; fromRank: string | null; toRank: string | null } | null;
  /** For a duty: the lowest grade that can take it on, if one is set. */
  openTo: { grade: string; rank: string | null } | null;
  requirements: Requirement[];
};

export type AreaWithRoles = Area & {
  roles: Role[];
  /** Primary posts and duties in the order of battle. Both are 0 for an area that opens later. */
  posts: number;
  duties: number;
  opensAtStage: number;
  open: boolean;
};

export type Roles = { state: "no-database" } | { state: "ready"; stage: number; areas: AreaWithRoles[] };

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
  // The stage changes, so read it when the page is asked for, not when the site is built.
  await connection();
  if (!supabaseEnv) return { state: "no-database" };
  const supabase = createClient(supabaseEnv.url, supabaseEnv.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const [settings, units, positions, needs, qualifications, ranks] = await Promise.all([
    supabase.from("fleet_settings").select("current_stage").maybeSingle(),
    supabase.from("units").select("id, parent_id, name, kind, service, opens_at_stage, sort_order"),
    supabase
      .from("positions")
      .select("id, unit_id, title, kind, min_grade, max_grade, is_entry, opens_at_stage, sort_order"),
    supabase.from("position_qualifications").select("position_id, qualification_id, waived_when_acting"),
    supabase.from("qualifications").select("id, name, description"),
    supabase.from("ranks").select("service, grade_code, name"),
  ]);
  for (const result of [settings, units, positions, needs, qualifications, ranks]) {
    if (result.error) throw new Error(`The roles could not be read: ${result.error.message}`);
  }

  const stage: number = settings.data?.current_stage ?? 1;

  const rankName = new Map<string, string>();
  for (const rank of ranks.data ?? []) rankName.set(`${rank.service}:${rank.grade_code}`, rank.name);

  const qualification = new Map<string, { name: string; description: string }>();
  for (const row of qualifications.data ?? []) qualification.set(row.id, row);
  const requirements = new Map<string, Requirement[]>();
  for (const row of needs.data ?? []) {
    const found = qualification.get(row.qualification_id);
    if (!found) continue;
    const list = requirements.get(row.position_id) ?? [];
    list.push({ name: found.name, description: found.description, waivedWhenActing: row.waived_when_acting === true });
    requirements.set(row.position_id, list);
  }

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

  // Posts of one title in one unit are one role: "Turret Gunner 1" to "Turret Gunner 7".
  const rolesByKey = new Map<string, Role>();
  // Where each role comes in the order of battle: its units' places from the top down, then its own.
  const placeInOrder = new Map<Role, number[]>();
  for (const post of (positions.data ?? []) as PositionRow[]) {
    const unit = unitById.get(post.unit_id);
    if (!unit) continue;
    const line = lineOf(unit);
    const place = [...line].reverse().find((entry) => PLACES.has(entry.kind)) ?? unit;
    const title = post.title.replace(/ \d+$/, "");
    // A unit opens no earlier than the units above it, and a post no earlier than its unit.
    const opensAt = Math.max(post.opens_at_stage, ...line.map((entry) => entry.opens_at_stage));
    const service = [...line].reverse().find((entry) => entry.service)?.service ?? null;
    const rank = (grade: string) => (service ? (rankName.get(`${service}:${grade}`) ?? null) : null);

    const key = `${unit.id}:${title}`;
    const known = rolesByKey.get(key);
    if (known) {
      known.posts += 1;
      known.opensAtStage = Math.min(known.opensAtStage, opensAt);
      known.lastOpensAtStage = Math.max(known.lastOpensAtStage, opensAt);
      known.open = known.opensAtStage <= stage;
      continue;
    }
    const role: Role = {
      slug: slugify(`${place.name} ${title}`),
      title,
      area: areaOf({ kind: post.kind, title, units: line.map((entry) => entry.name), service }),
      kind: post.kind,
      where: place.name,
      unit: unit.name,
      path: line.map((entry) => entry.name),
      service,
      posts: 1,
      entry: post.is_entry,
      opensAtStage: opensAt,
      lastOpensAtStage: opensAt,
      open: opensAt <= stage,
      band:
        post.kind === "primary" && post.min_grade && post.max_grade
          ? { from: post.min_grade, to: post.max_grade, fromRank: rank(post.min_grade), toRank: rank(post.max_grade) }
          : null,
      openTo: post.kind === "duty" && post.min_grade ? { grade: post.min_grade, rank: rank(post.min_grade) } : null,
      requirements: (requirements.get(post.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    };
    rolesByKey.set(key, role);
    placeInOrder.set(role, [...line.map((entry) => entry.sort_order), post.sort_order]);
  }

  // Two departments of one ship could share a title. Name the unit in the address then.
  const roles = [...rolesByKey.values()];
  const taken = new Map<string, number>();
  for (const role of roles) taken.set(role.slug, (taken.get(role.slug) ?? 0) + 1);
  for (const role of roles) {
    if ((taken.get(role.slug) ?? 0) > 1) role.slug = slugify(`${role.where} ${role.unit} ${role.title}`);
  }

  // In the order the order of battle lists them: by unit from the top down, then by post.
  roles.sort((a, b) => {
    const first = placeInOrder.get(a) ?? [];
    const second = placeInOrder.get(b) ?? [];
    for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
      const difference = (first[index] ?? -1) - (second[index] ?? -1);
      if (difference !== 0) return difference;
    }
    return 0;
  });

  const listed = roles.some((role) => role.area === otherArea.slug) ? [...areas, otherArea] : areas;
  return {
    state: "ready",
    stage,
    areas: listed.map((area): AreaWithRoles => {
      const mine = roles.filter((role) => role.area === area.slug);
      const opensAtStage = mine.length > 0 ? Math.min(...mine.map((role) => role.opensAtStage)) : (area.planned?.stage ?? 9);
      return {
        ...area,
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
export function gradeSpan(band: NonNullable<Role["band"]>): string {
  return band.from === band.to ? band.from : `${band.from} to ${band.to}`;
}

/** "Starman to Jr. Petty Officer", if the unit belongs to a service. */
export function rankSpan(band: NonNullable<Role["band"]>): string | null {
  if (!band.fromRank || !band.toRank) return null;
  return band.fromRank === band.toRank ? band.fromRank : `${band.fromRank} to ${band.toRank}`;
}

/** "7 posts", "1 post", "11 duties". */
export function count(number: number, one: string, many: string): string {
  return `${number} ${number === 1 ? one : many}`;
}

/** An area's size in a few words: its posts, its duties, or what Volume 1 plans for it. */
export function sizeOf(area: AreaWithRoles): string {
  if (area.posts > 0) return count(area.posts, "post", "posts");
  if (area.duties > 0) return count(area.duties, "duty", "duties");
  return area.planned?.size ?? "No posts yet";
}
