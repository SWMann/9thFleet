import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PictureName } from "@/lib/pictures";
import { slugify } from "@/lib/slug";

/**
 * The fleet manual. Its words are the doctrine volumes, kept as Markdown in
 * `content/manual`. A volume is published here once the Fleet Commander has
 * reviewed it. Until then the site names it and shows none of its text.
 */

export type VolumeState = "reviewed" | "draft" | "planned";

export type Volume = {
  number: number;
  slug: string;
  title: string;
  /** What the volume covers, in the doctrine plan's own words. */
  covers: string;
  state: VolumeState;
  /** When it was reviewed or drafted, or when it is due. */
  dated: string;
  picture: PictureName;
  /** The Markdown file in `content/manual`, for a volume that is published. */
  file?: string;
};

export const volumes: Volume[] = [
  {
    number: 1,
    slug: "organisation",
    title: "Organisation",
    covers: "The full order of battle, from Fleet Command down to the team",
    state: "reviewed",
    dated: "Reviewed 6 October 2026",
    picture: "volume1",
    file: "01-organisation.md",
  },
  {
    number: 2,
    slug: "command",
    title: "Command",
    covers: "Fleet Command, the chain of command, staff sections, appointments and orders",
    state: "reviewed",
    dated: "Reviewed 7 October 2026",
    picture: "volume2",
    file: "02-command.md",
  },
  {
    number: 3,
    slug: "communications",
    title: "Communications",
    covers: "Voice procedure, nets, callsigns and reports",
    state: "draft",
    dated: "Drafted 7 October 2026",
    picture: "volume3",
  },
  {
    number: 4,
    slug: "personnel",
    title: "Personnel",
    covers: "Grades, positions, promotion, activity, reserve and discipline",
    state: "planned",
    dated: "Due 6 December 2026",
    picture: "volume4",
  },
  {
    number: 5,
    slug: "training",
    title: "Training",
    covers: "Recruit and cadet syllabi and the instructor standard",
    state: "planned",
    dated: "Due 10 January 2027",
    picture: "volume5",
  },
  {
    number: 6,
    slug: "operations",
    title: "Operations",
    covers: "The event cycle, rules of engagement, casualties and after-action reports",
    state: "planned",
    dated: "Due 10 January 2027",
    picture: "volume6",
  },
  {
    number: 7,
    slug: "navy",
    title: "Navy",
    covers: "Shipboard and flight operations",
    state: "planned",
    dated: "Due 24 January 2027",
    picture: "volume7",
  },
  {
    number: 8,
    slug: "army",
    title: "Army",
    covers: "Ground operations and lift",
    state: "planned",
    dated: "Due 6 June 2027",
    picture: "volume8",
  },
  {
    number: 9,
    slug: "logistics-and-medical",
    title: "Logistics and medical",
    covers: "Fleet, bank, supply and the medical chain",
    state: "planned",
    dated: "Due 6 June 2027",
    picture: "volume9",
  },
  {
    number: 10,
    slug: "marines",
    title: "Marines",
    covers: "Boarding and ship security",
    state: "planned",
    dated: "Due 6 August 2027",
    picture: "volume10",
  },
];

/** What has changed lately, newest first. Add a line when a volume is drafted, reviewed or amended. */
export const changes: { when: string; volume: number; what: string }[] = [
  { when: "7 October 2026", volume: 3, what: "First draft written. It is published here once it has been reviewed." },
  { when: "7 October 2026", volume: 2, what: "Reviewed, with the rules for stepping up during an absence added." },
  { when: "6 October 2026", volume: 1, what: "Reviewed. Every post now has a grade band around its nominal grade." },
];

export type Section = {
  slug: string;
  title: string;
  /** The sentence the section opens with. */
  lead: string;
  /** The rest of the section, as Markdown. */
  body: string;
  /** The headings inside the section. */
  parts: { slug: string; title: string }[];
};

export type Published = { volume: Volume; intro: string; sections: Section[] };

const parsed = new Map<string, Published>();

/** A published volume's text, split into its sections. Null for a volume that is not published. */
export function readVolume(slug: string): Published | null {
  const volume = volumes.find((entry) => entry.slug === slug);
  if (!volume?.file || volume.state !== "reviewed") return null;
  const known = parsed.get(slug);
  if (known) return known;

  const text = readFileSync(path.join(process.cwd(), "content", "manual", volume.file), "utf8");
  const [top, ...rest] = text.split(/^## /m);
  const intro = top.replace(/^# .*$/m, "").trim();
  const sections = rest.map((chunk): Section => {
    const [heading, ...lines] = chunk.split("\n");
    const title = heading.trim();
    const [lead, ...paragraphs] = lines.join("\n").trim().split(/\n\s*\n/);
    // A section that opens with a list or a table has no opening sentence.
    const opensWithProse = !/^(#|\||-|\d+\.)/.test(lead);
    const body = (opensWithProse ? paragraphs : [lead, ...paragraphs]).join("\n\n");
    return {
      slug: slugify(title),
      title,
      lead: opensWithProse ? lead : "",
      body,
      parts: [...body.matchAll(/^### (.+)$/gm)].map((match) => ({ slug: slugify(match[1]), title: match[1].trim() })),
    };
  });

  const published = { volume, intro, sections };
  parsed.set(slug, published);
  return published;
}

/** Every published volume, in order. */
export function publishedVolumes(): Published[] {
  return volumes.flatMap((volume) => readVolume(volume.slug) ?? []);
}

export type SectionLink = { href: string; title: string; volume: string };

/**
 * A link to one section. It fails loudly if the section is not there, so a
 * heading renamed in the manual cannot leave a dead link elsewhere on the site.
 */
export function sectionLink(volumeSlug: string, sectionSlug: string): SectionLink {
  const published = readVolume(volumeSlug);
  const section = published?.sections.find((entry) => entry.slug === sectionSlug);
  if (!published || !section) throw new Error(`The manual has no section ${volumeSlug}/${sectionSlug}.`);
  return {
    href: `/manual/${volumeSlug}/${sectionSlug}`,
    title: section.title,
    volume: `Volume ${published.volume.number}, ${published.volume.title}`,
  };
}

/** The sections either side of one, across volumes, for the links at the foot of a section. */
export function neighbours(volumeSlug: string, sectionSlug: string): { before: SectionLink | null; after: SectionLink | null } {
  const all = publishedVolumes().flatMap((published) =>
    published.sections.map((section) => sectionLink(published.volume.slug, section.slug)),
  );
  const at = all.findIndex((link) => link.href === `/manual/${volumeSlug}/${sectionSlug}`);
  return { before: at > 0 ? all[at - 1] : null, after: at >= 0 && at < all.length - 1 ? all[at + 1] : null };
}
