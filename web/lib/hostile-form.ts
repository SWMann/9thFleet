/**
 * The hostile list: its words, and the checks a form's fields go through
 * before they are sent. Nothing here reads the database, and the database
 * makes the same checks for itself.
 */

export type HostileKind = "organisation" | "individual";
export type HostileLevel = "hostile" | "watch";
export type HostileState = "proposed" | "listed" | "declined" | "lifted";

export const kindNames: Record<HostileKind, string> = { organisation: "Organisation", individual: "Individual" };
export const levelNames: Record<HostileLevel, string> = { hostile: "Hostile", watch: "Watch" };

/** What each level asks of a member who meets the name in the game. */
export const levelMeaning: Record<HostileLevel, string> = {
  hostile: "May be engaged when the weapons state allows it.",
  watch: "Report on contact. Do not engage, except in self-defence.",
};

/** What the handle is called for each kind, as the game calls it. */
export const handleNames: Record<HostileKind, string> = { organisation: "Organisation ID", individual: "RSI handle" };

/** How many days an entry stands before it lapses, where it lapses at all. */
export const STANDS_FOR = 90;

/** Whether an entry of this kind and level lapses. A declared hostile organisation stands until it is lifted. */
export const lapses = (kind: HostileKind, level: HostileLevel) => !(kind === "organisation" && level === "hostile");

const HANDLE = /^[A-Za-z0-9_-]{2,60}$/;

export type HostileFields = { kind: HostileKind; handle: string; name: string; level: HostileLevel; reason: string; evidence: string };

/**
 * The web addresses in a field of evidence, one to a line. A line that is not
 * a plain http or https address is a problem, not something to guess at.
 */
export function readEvidence(text: string): { lines: string[] } | { problem: string } {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    let address: URL | null = null;
    try {
      address = new URL(line);
    } catch {
      address = null;
    }
    if (!address || !["http:", "https:"].includes(address.protocol) || /\s/.test(line) || !/^https?:\/\//i.test(line)) {
      return { problem: "Give each piece of evidence as a web address starting https://, one to a line." };
    }
  }
  if (lines.join("\n").length > 1000) return { problem: "Keep the evidence to 1,000 characters." };
  return { lines };
}

/** The words of an entry from a form, or what is wrong with them. `get` reads one field as tidy text. */
export function readHostile(get: (name: string) => string): { fields: HostileFields } | { problem: string } {
  const kind = get("kind");
  if (kind !== "organisation" && kind !== "individual") return { problem: "Say whether this is an organisation or an individual." };
  const handle = get("handle");
  if (!HANDLE.test(handle)) {
    return { problem: `Give the ${handleNames[kind]} as the game shows it: 2 to 60 letters, numbers, hyphens or underscores, with no spaces.` };
  }
  const name = get("name").replace(/\s+/g, " ");
  if (name.length > 80) return { problem: "Keep the name under 80 characters." };
  const level = get("level") || "hostile";
  if (level !== "hostile" && level !== "watch") return { problem: "Choose hostile or watch." };
  const words = readWords(get);
  if ("problem" in words) return words;
  return { fields: { kind, handle, name, level, ...words.fields } };
}

/** What happened and where to see it: the part of an entry command can rewrite. */
export function readWords(get: (name: string) => string): { fields: { reason: string; evidence: string } } | { problem: string } {
  const reason = get("reason");
  if (reason.length < 10) return { problem: "Say what happened, in a sentence or more." };
  if (reason.length > 2000) return { problem: "Keep what happened to 2,000 characters, counting its formatting." };
  const evidence = readEvidence(get("evidence"));
  if ("problem" in evidence) return evidence;
  return { fields: { reason, evidence: evidence.lines.join("\n") } };
}

/** A web address as a short label: where it is and the start of its path. */
export function linkLabel(address: string): string {
  try {
    const url = new URL(address);
    const path = url.pathname === "/" ? "" : url.pathname;
    const label = `${url.hostname.replace(/^www\./, "")}${path}`;
    return label.length > 48 ? `${label.slice(0, 47)}…` : label;
  } catch {
    return address;
  }
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * How an entry stands today: whether it has lapsed, how many days it has left,
 * and the words for that. `today` and `expiresOn` are days in UTC, 2026-10-13.
 */
export function standing(expiresOn: string | null, today: string): { lapsed: boolean; soon: boolean; daysLeft: number | null; words: string } {
  if (!expiresOn) return { lapsed: false, soon: false, daysLeft: null, words: "Until lifted" };
  const left = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (left < 0) return { lapsed: true, soon: false, daysLeft: left, words: left === -1 ? "Lapsed yesterday" : `Lapsed ${-left} days ago` };
  const words = left === 0 ? "Lapses after today" : left === 1 ? "1 day left" : `${left} days left`;
  return { lapsed: false, soon: left <= 14, daysLeft: left, words };
}
