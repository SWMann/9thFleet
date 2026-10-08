/** Facts the whole site shares. Change them here and every page follows. */
export const site = {
  name: "UEE 9th Fleet",
  shortName: "9th Fleet",
  formation: "Task Force Jericho",
  flagship: "UEES Nexus",
  motto: "Correct before fast",
  description:
    "A Star Citizen organisation that crews UEE Navy ships properly: one chain of command, correct radio procedure, and operations that start when the checks are done.",
  recruitmentOpens: "6 February 2027",
  /** The same day for a computer: the start of it, in UTC. */
  recruitmentOpensAt: "2027-02-06T00:00:00Z",
  /**
   * The stage the fleet is at, and how many posts that stage opens. The order
   * of battle reads both from the database. The front page is public and
   * built ahead of time, so it reads them from here: change them when a stage opens.
   */
  stage: 1,
  postsOpen: 7,
  /** Cloud Imperium asks every fan site to link to the official one. */
  officialSite: "https://robertsspaceindustries.com",
} as const;

/**
 * Search engines stay out until launch. Set SITE_INDEXABLE=1 in the hosting
 * settings on launch day to let them in.
 */
export const indexable = process.env.SITE_INDEXABLE === "1";
