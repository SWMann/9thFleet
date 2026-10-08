import type { PictureName } from "@/lib/pictures";

/**
 * The areas of work the roles pages sort the fleet's posts into. The posts
 * themselves come from the database. This file only says which area each one
 * belongs to, and describes the areas whose posts are not in the order of
 * battle yet. The grouping is provisional: the Fleet Commander will set his own.
 */

export type Domain = "command" | "ship" | "flight" | "ground" | "support" | "staff";

export const domains: { key: Domain; label: string }[] = [
  { key: "command", label: "Command" },
  { key: "ship", label: "Ship" },
  { key: "flight", label: "Flight" },
  { key: "ground", label: "Ground and boarding" },
  { key: "support", label: "Support" },
  { key: "staff", label: "Staff" },
];

export type Area = {
  slug: string;
  name: string;
  domain: Domain;
  picture: PictureName;
  /** One or two sentences on what the area is, from Volumes 1 and 2. */
  about: string;
  /** For an area with no posts in the order of battle yet: when it opens and its size, from Volume 1. */
  planned?: { stage: number; size: string };
  /** Sections of the manual to read for this area, as [volume, section]. */
  reading: [string, string][];
};

export const areas: Area[] = [
  {
    slug: "command",
    name: "Command posts",
    domain: "command",
    picture: "areaCommand",
    about: "The commanders and their deputies, from the Fleet Commander to the commanding officer of a ship.",
    reading: [
      ["organisation", "fleet-command"],
      ["command", "succession-and-continuity"],
      ["command", "appointments"],
      ["command", "orders"],
      ["command", "reports"],
      ["command", "who-decides-what"],
    ],
  },
  {
    slug: "signals",
    name: "Signals",
    domain: "command",
    picture: "areaSignals",
    about: "The Signaller is the control station of the command net and keeps its log.",
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "helm",
    name: "Helm and navigation",
    domain: "ship",
    picture: "areaHelm",
    about: "The flagship's helm is an enlisted Helmsman. The Navigator is the backup helm and also works sensors and route planning.",
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "gunnery",
    name: "Gunnery",
    domain: "ship",
    picture: "areaGunnery",
    about: "Turret gunners and remote weapons operators, led on the flagship by the Gunnery Chief.",
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "engineering",
    name: "Engineering",
    domain: "ship",
    picture: "areaEngineering",
    about: "A ship's engineers, led on the flagship by the Chief Engineer.",
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "medical",
    name: "Medical",
    domain: "ship",
    picture: "areaMedical",
    about: "The flagship's Medic. The medical chain is set out in a later volume of the manual.",
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "flight-deck",
    name: "Flight deck",
    domain: "ship",
    picture: "areaDeck",
    about: "The Flight Deck Chief and the deck hands of the flagship.",
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "ship-security",
    name: "Ship security",
    domain: "ship",
    picture: "areaSecurity",
    about: "The flagship's Master-at-Arms. From stage 5 the Marines post a ship security detachment aboard.",
    reading: [
      ["organisation", "navy-squadron"],
      ["organisation", "marine-company"],
    ],
  },
  {
    slug: "fighters",
    name: "Fighters",
    domain: "flight",
    picture: "areaFighters",
    about: "The pilots of the air wing. A full flight is 12 aircraft in three sections of four, and the flight lead flies as one of them.",
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "lift",
    name: "Lift",
    domain: "flight",
    picture: "areaLift",
    about: "The lift flight: a flight commander, three dropship skippers and eight crew.",
    planned: { stage: 4, size: "12 posts" },
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "infantry",
    name: "Infantry",
    domain: "ground",
    picture: "areaInfantry",
    about: "The Army. It opens as one section of eight soldiers and grows to a platoon in the same stage.",
    planned: { stage: 4, size: "Army" },
    reading: [["organisation", "army-battalion"]],
  },
  {
    slug: "boarding",
    name: "Boarding",
    domain: "ground",
    picture: "areaBoarding",
    about: "The Marines' boarding teams, each eight strong. The Marines grow from a ship security detachment to a platoon at stage 6.",
    planned: { stage: 6, size: "Marines" },
    reading: [["organisation", "marine-company"]],
  },
  {
    slug: "fleet-support",
    name: "Fleet support",
    domain: "support",
    picture: "areaSupport",
    about: "The support flight, with its refuel, repair, medical and cargo ships.",
    planned: { stage: 5, size: "22 posts" },
    reading: [["organisation", "navy-squadron"]],
  },
  {
    slug: "reconnaissance",
    name: "Reconnaissance",
    domain: "support",
    picture: "areaRecon",
    about: "The reconnaissance flight of the patrol and support flotilla.",
    planned: { stage: 7, size: "8 posts" },
    reading: [["organisation", "patrol-and-support-flotilla"]],
  },
  {
    slug: "staff-duties",
    name: "Staff duties",
    domain: "staff",
    picture: "areaStaff",
    about: "Part-time staff jobs held as well as a post, such as recruiter, instructor and planner. A duty carries no rank.",
    reading: [
      ["command", "staff-sections-and-the-command-board"],
      ["command", "appointments"],
    ],
  },
];

/** Where a post goes if nothing below places it, so a new post is never left off the site. */
export const otherArea: Area = {
  slug: "other",
  name: "Other posts",
  domain: "support",
  picture: "areaOther",
  about: "Posts that have not been placed in an area yet.",
  reading: [],
};

/** Sections every member reads, whatever their post. */
export const commonReading: [string, string][] = [
  ["organisation", "primary-posts-and-secondary-duties"],
  ["organisation", "two-chains-of-command"],
  ["command", "principles-of-command"],
  ["command", "the-chain-of-command"],
  ["command", "command-on-an-operation"],
];

type Placed = { kind: "primary" | "duty"; title: string; units: string[]; service: string | null };

/** The area a post belongs to, by its title first and then by where it sits. */
export function areaOf(post: Placed): string {
  if (post.kind === "duty") return "staff-duties";
  const title = post.title;
  if (/^(Fleet Commander|Commanding Officer|Executive Officer|Tactical Officer|Chief of the Boat)$/.test(title)) {
    return "command";
  }
  if (/Signal/.test(title)) return "signals";
  if (/Helm|Navigator/.test(title)) return "helm";
  if (/Gunner|Weapons/.test(title)) return "gunnery";
  if (/Engineer/.test(title)) return "engineering";
  if (/Medic/.test(title)) return "medical";
  if (/Deck/.test(title)) return "flight-deck";
  if (/Master-at-Arms|Security/.test(title)) return "ship-security";

  const where = post.units.join(" / ");
  if (/Lift/.test(where)) return "lift";
  if (/Reconnaissance|Recon/.test(where)) return "reconnaissance";
  if (/Support|Logistics/.test(where)) return "fleet-support";
  if (post.service === "army") return "infantry";
  if (post.service === "marines") return "boarding";
  if (/Pilot|Flight Lead|Wing/.test(title)) return "fighters";
  return otherArea.slug;
}
