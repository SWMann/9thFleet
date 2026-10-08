import type { PictureName } from "@/lib/pictures";
import { pictures } from "@/lib/pictures";

/**
 * The groups the areas of work are filtered by on the roles page. The areas
 * themselves, and the roles in them, are records in the database that an
 * admin keeps on the site. See `lib/roles.ts` and the editors under
 * `/admin/structure`.
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

/** Sections every member reads, whatever their role. Each is volume/section. */
export const commonReading: string[] = [
  "organisation/primary-posts-and-secondary-duties",
  "organisation/two-chains-of-command",
  "command/principles-of-command",
  "command/the-chain-of-command",
  "command/command-on-an-operation",
];

/** The pictures an area can be given: every picture whose name starts with "area". */
export const areaPictures = (Object.keys(pictures) as PictureName[]).filter((name) => name.startsWith("area"));

/** The picture for an area, or the spare one if its record names a picture the site does not have. */
export function areaPicture(name: string): PictureName {
  return (areaPictures as string[]).includes(name) ? (name as PictureName) : "areaOther";
}
