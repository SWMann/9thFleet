import "server-only";
import { publishedVolumes } from "@/lib/manual";
import { getOrderOfBattle, type Unit } from "@/lib/order-of-battle";
import { createClient } from "@/lib/supabase/server";
import type { RichSources } from "./sources";

/** The statuses of someone serving, who can be named. */
const SERVING = ["recruit", "auxiliary", "member", "reserve"];

/** The published sections of the manual, for an editor to link to. A volume that is not published is not offered. */
export function manualLinks(): RichSources["links"] {
  return publishedVolumes().flatMap((published) =>
    published.sections.map((section) => ({
      label: section.title,
      note: `Volume ${published.volume.number}, ${published.volume.title}`,
      href: `/manual/${published.volume.slug}/${section.slug}`,
    })),
  );
}

/**
 * Who and what can be named with @: the serving members given, then every
 * unit and every post of the order of battle. A post is named with its unit,
 * since two ships each have a commanding officer.
 */
export function fleetMentions(fleet: Unit | null, people: { id: string; name: string; rankName: string | null }[]): RichSources["mentions"] {
  const mentions: RichSources["mentions"] = people.map((person) => ({
    kind: "member",
    id: person.id,
    label: person.name,
    note: person.rankName ?? undefined,
  }));
  const posts: RichSources["mentions"] = [];
  const walk = (unit: Unit, above: string | null) => {
    if (unit.id !== "all") mentions.push({ kind: "unit", id: unit.id, label: unit.name, note: above ? `${unit.kind}, ${above}` : unit.kind });
    for (const post of unit.posts) {
      if (post.kind === "primary") posts.push({ kind: "post", id: post.id, label: `${post.title}, ${unit.name}` });
    }
    for (const child of unit.units) walk(child, unit.name);
  };
  if (fleet) walk(fleet, null);
  return [...mentions, ...posts];
}

/**
 * What an editor can offer on a members' page that is not an event's: the
 * serving fleet to name, and the manual to link to. Everything is read as the
 * member asking, so someone the database shows no roster to is given no names.
 */
export async function fleetSources(): Promise<RichSources> {
  const supabase = await createClient();
  const battle = await getOrderOfBattle();
  if (!supabase || battle.state !== "ready") return { mentions: [], inserts: [], links: manualLinks() };
  const roster = await supabase.from("roster").select("member_id, character_name, rank_name, status");
  const people = ((roster.data ?? []) as { member_id: string; character_name: string | null; rank_name: string | null; status: string }[])
    .filter((entry) => SERVING.includes(entry.status) && entry.character_name)
    .map((entry) => ({ id: entry.member_id, name: entry.character_name!, rankName: entry.rank_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { mentions: fleetMentions(battle.fleet, people), inserts: [], links: manualLinks() };
}
