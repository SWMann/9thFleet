import type { MentionKind } from "./format";

/**
 * What an editor can offer beyond formatting, on the page it is on: who and
 * what can be named with @, and what the / menu can drop in. A page gives
 * these to its editors once, and each field picks them up.
 */
export type RichSources = {
  /** The members, units and posts that can be named. Empty where naming is not offered. */
  mentions: { kind: MentionKind; id: string; label: string; note?: string }[];
  /** Words from the page's own records to drop in: a callsign, a net, an objective. */
  inserts: { group: string; label: string; text: string }[];
  /** Pages to link to, such as sections of the manual. */
  links: { label: string; note: string; href: string }[];
  /** The day a time written in the text belongs to: the start of the event, as an ISO moment. */
  day?: string;
};

export const noSources: RichSources = { mentions: [], inserts: [], links: [] };
