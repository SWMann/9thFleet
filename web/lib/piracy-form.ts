/**
 * The piracy report line: its words, and the checks a report goes through
 * before it is sent. Nothing here reads the database, and the database makes
 * the same checks for itself.
 */

import { readEvidence, type HostileKind } from "@/lib/hostile-form";

export type ReportState = "new" | "handled" | "dismissed";
export const stateNames: Record<ReportState, string> = { new: "New", handled: "Handled", dismissed: "Dismissed" };

/** How many months a report is kept after it arrives. */
export const KEEP_MONTHS = 12;
/** How far back a report may reach, in days. */
export const REACHES_BACK = 90;

export type ReportFields = {
  urgent: boolean;
  reporter_handle: string;
  location: string;
  happened_on: string;
  suspect_kind: HostileKind | null;
  suspect_handle: string;
  details: string;
  evidence: string;
};

const HANDLE = /^[A-Za-z0-9_-]{2,60}$/;
const HANDLE_SHAPE = "2 to 60 letters, numbers, hyphens or underscores, with no spaces";

// Characters that hide or reorder what is written: control characters, and
// the marks that turn text right to left. They are made by number, so that
// this file holds none of them.
const range = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const TURNS = range(0x202a, 0x202e) + range(0x2066, 0x2069);
const NOT_ONE_LINE = new RegExp(`[${range(0x00, 0x1f)}${range(0x7f, 0x9f)}${TURNS}]`);
/** As above, but a line may break. */
const NOT_PLAIN_WORDS = new RegExp(`[${range(0x00, 0x09)}${range(0x0b, 0x1f)}${range(0x7f, 0x9f)}${TURNS}]`);

const DAY = 24 * 60 * 60 * 1000;
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * A report from the form, or what is wrong with it. `get` reads one field as
 * tidy text, and `today` is the day in UTC, 2026-10-13.
 */
export function readReport(get: (name: string) => string, today: string): { fields: ReportFields } | { problem: string } {
  const urgent = get("urgent") === "on";

  const reporter = get("reporter_handle");
  if (!HANDLE.test(reporter)) return { problem: `Give your handle as the game shows it: ${HANDLE_SHAPE}.` };

  const location = get("location").replace(/\s+/g, " ").trim();
  if (location.length < 2) return { problem: "Say where it happened: the system and the nearest place." };
  if (location.length > 120) return { problem: "Keep where it happened under 120 characters." };
  if (NOT_ONE_LINE.test(location)) return { problem: "Keep where it happened to plain letters, numbers and marks." };

  // Left empty, the day is today. So is the day of anything happening now.
  const typedDay = get("happened_on");
  const happened = urgent || typedDay === "" ? today : typedDay;
  if (!isDay(happened)) return { problem: "Give the day it happened as a date, or leave it empty for today." };
  const ago = daysFrom(happened, today);
  // Tomorrow is today somewhere ahead of UTC.
  if (ago < -1) return { problem: "The day it happened cannot be in the future." };
  if (ago > REACHES_BACK) return { problem: `The line takes reports from the last ${REACHES_BACK} days.` };

  const who = get("suspect_kind");
  const suspect = get("suspect_handle");
  let kind: HostileKind | null = null;
  if (who === "individual" || who === "organisation") {
    kind = who;
    if (suspect === "") return { problem: "Give their handle or organisation ID, or choose that you do not know who it was." };
    if (!HANDLE.test(suspect)) return { problem: `Give their name as the game shows it: ${HANDLE_SHAPE}.` };
  } else if (suspect !== "") {
    return { problem: "Say whether that name is a player or an organisation." };
  }

  // Lines may break. Any other white space is one space, and three line breaks are two.
  const details = get("details")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (details.length < 20) return { problem: "Say what happened, in a sentence or more." };
  if (details.length > 2000) return { problem: "Keep what happened to 2,000 characters." };
  if (NOT_PLAIN_WORDS.test(details)) return { problem: "Keep what happened to plain text." };

  const evidence = readEvidence(get("evidence"));
  if ("problem" in evidence) return evidence;

  return {
    fields: {
      urgent,
      reporter_handle: reporter,
      location,
      happened_on: happened,
      suspect_kind: kind,
      suspect_handle: kind ? suspect : "",
      details,
      evidence: evidence.lines.join("\n"),
    },
  };
}

/** The day before which a report is no longer kept, given today in UTC. */
export function keptSince(today: string): string {
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() - KEEP_MONTHS);
  return day.toISOString().slice(0, 10);
}

/**
 * What a Response event drafted from a report starts with: where it happened,
 * and nothing about who sent the report. An event is read by the whole serving
 * fleet once it is announced, and a report by command alone, so naming the
 * sender to the fleet is command's choice to make, not the form's.
 */
export function responseStart(report: { location: string }): { title: string; summary: string; area: string } {
  const title = `Response: ${report.location}`;
  return {
    title: title.length > 80 ? `${title.slice(0, 79).trimEnd()}…` : title,
    summary: "Answering a piracy report sent to the fleet.",
    area: report.location,
  };
}
