/** Facts the whole site shares. Change them here and every page follows. */
export const site = {
  name: "UEE 9th Fleet",
  shortName: "9th Fleet",
  formation: "Task Force Jericho",
  flagship: "UEES Nexus",
  description:
    "A Star Citizen organisation that crews UEE Navy ships properly: one chain of command, correct radio procedure, and operations that start when the checks are done.",
  recruitmentOpens: "6 February 2027",
} as const;

/**
 * Search engines stay out until launch. Set SITE_INDEXABLE=1 in the hosting
 * settings on launch day to let them in.
 */
export const indexable = process.env.SITE_INDEXABLE === "1";
