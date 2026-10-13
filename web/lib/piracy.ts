import "server-only";
import { levelNames, standing, type HostileKind, type HostileLevel, type HostileState } from "@/lib/hostile-form";
import { keptSince, type ReportState } from "@/lib/piracy-form";
import { createClient } from "@/lib/supabase/server";

/**
 * The piracy reports, read as command. The database sends them to command and
 * to nobody else, so for anyone else every list here comes back empty.
 *
 * A report is kept for twelve months. Whatever is older is deleted here,
 * before anything is read, so no page ever shows one.
 */

/** A hostile-list entry, as far as a report's card needs it. */
export type ReportEntry = { id: string; handle: string; words: string; href: string };

export type PiracyReport = {
  id: string;
  receivedAt: string;
  urgent: boolean;
  reporterHandle: string;
  location: string;
  happenedOn: string;
  suspectKind: HostileKind | null;
  suspectHandle: string;
  details: string;
  /** Web addresses, checked again here before any is made a link. */
  evidence: string[];
  state: ReportState;
  handledBy: string | null;
  handledAt: string | null;
  outcomeNote: string;
  /** The Response event drafted from it, while that event is still there. */
  event: { id: string; title: string } | null;
  /** The hostile-list entries started from it. */
  entries: ReportEntry[];
  /** An entry for the name it gives that waits or stands today, wherever that entry came from. */
  known: ReportEntry | null;
};

export type PiracyReports =
  | { state: "no-database" }
  | {
      state: "ready";
      /** Not yet handled: those marked as happening now first, then the oldest. */
      waiting: PiracyReport[];
      /** Handled or dismissed, the latest first. */
      closed: PiracyReport[];
      /** Each serving member's name, by id. */
      names: Record<string, string>;
    };

type Row = Record<string, unknown>;

const isWebAddress = (line: string) => /^https?:\/\/\S+$/i.test(line);
const COLUMNS =
  "id, received_at, urgent, reporter_handle, location, happened_on, suspect_kind, suspect_handle, details, evidence, state, handled_by, handled_at, outcome_note, event_id";

/** What an entry or an event started from a report begins with. */
export type ReportStart = Pick<PiracyReport, "id" | "urgent" | "reporterHandle" | "location" | "suspectKind" | "suspectHandle" | "details" | "evidence"> & {
  /** A start for a Response to something happening now: half an hour on, at the next quarter hour, in UTC. */
  soon: { date: string; time: string };
};

/** One report by its id, for starting an entry or an event from it. Null for anyone but command, and for a report that is gone. */
export async function getPiracyReport(id: string): Promise<ReportStart | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("piracy_reports")
    .select("id, urgent, reporter_handle, location, suspect_kind, suspect_handle, details, evidence")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as Row;
  const QUARTER = 15 * 60 * 1000;
  const soon = new Date(Math.ceil((Date.now() + 2 * QUARTER) / QUARTER) * QUARTER).toISOString();
  return {
    soon: { date: soon.slice(0, 10), time: soon.slice(11, 16) },
    id: row.id as string,
    urgent: row.urgent === true,
    reporterHandle: row.reporter_handle as string,
    location: row.location as string,
    suspectKind: (row.suspect_kind as HostileKind | null) ?? null,
    suspectHandle: (row.suspect_handle as string) ?? "",
    details: row.details as string,
    evidence: ((row.evidence as string) ?? "").split("\n").filter(isWebAddress),
  };
}

export async function getPiracyReports(): Promise<PiracyReports> {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const today = new Date().toISOString().slice(0, 10);
  const swept = await supabase.from("piracy_reports").delete().lt("received_at", `${keptSince(today)}T00:00:00Z`);
  if (swept.error) throw new Error(`Old piracy reports could not be cleared: ${swept.error.message}`);

  const [reports, hostiles, roster] = await Promise.all([
    supabase.from("piracy_reports").select(COLUMNS).order("received_at", { ascending: false }),
    supabase.from("hostiles").select("id, kind, handle, state, level, expires_on, report_id"),
    supabase.from("roster").select("member_id, character_name, rank_name, acting"),
  ]);
  for (const result of [reports, hostiles, roster]) {
    if (result.error) throw new Error(`The piracy reports could not be read: ${result.error.message}`);
  }
  const rows = (reports.data ?? []) as Row[];

  const eventIds = [...new Set(rows.map((row) => row.event_id as string | null).filter((id): id is string => typeof id === "string"))];
  const events = new Map<string, string>();
  for (let from = 0; from < eventIds.length; from += 100) {
    const batch = await supabase.from("events").select("id, title").in("id", eventIds.slice(from, from + 100));
    if (batch.error) throw new Error(`The events could not be read: ${batch.error.message}`);
    for (const row of (batch.data ?? []) as Row[]) events.set(row.id as string, row.title as string);
  }

  const names: Record<string, string> = {};
  for (const row of (roster.data ?? []) as Row[]) {
    if (!row.character_name) continue;
    names[row.member_id as string] = row.rank_name ? `${row.acting === true ? "Acting " : ""}${row.rank_name} ${row.character_name}` : (row.character_name as string);
  }

  // Each entry on the hostile list, with how it stands today in a word or two and where on that page it is.
  const entries = ((hostiles.data ?? []) as Row[]).map((row) => {
    const state = row.state as HostileState;
    const level = row.level as HostileLevel;
    const lapsed = state === "listed" && standing((row.expires_on as string | null) ?? null, today).lapsed;
    const stands = state === "listed" && !lapsed;
    const words = state === "proposed" ? "Waiting for a decision" : stands ? (level === "watch" ? "On watch" : levelNames.hostile) : lapsed ? "Lapsed" : state === "declined" ? "Declined" : "Lifted";
    const tab = state === "proposed" ? "?tab=forward" : stands ? (level === "watch" ? "?tab=watch" : "") : "?tab=past";
    return {
      id: row.id as string,
      kind: row.kind as HostileKind,
      handle: row.handle as string,
      reportId: (row.report_id as string | null) ?? null,
      open: state === "proposed" || stands,
      words,
      href: `/hostiles${tab}#entry-${row.id as string}`,
    };
  });
  const card = (entry: (typeof entries)[number]): ReportEntry => ({ id: entry.id, handle: entry.handle, words: entry.words, href: entry.href });

  const all = rows.map((row): PiracyReport => {
    const id = row.id as string;
    const suspectKind = (row.suspect_kind as HostileKind | null) ?? null;
    const suspectHandle = (row.suspect_handle as string) ?? "";
    const eventId = (row.event_id as string | null) ?? null;
    const known = suspectKind ? entries.find((entry) => entry.open && entry.kind === suspectKind && entry.handle.toLowerCase() === suspectHandle.toLowerCase()) : undefined;
    return {
      id,
      receivedAt: row.received_at as string,
      urgent: row.urgent === true,
      reporterHandle: row.reporter_handle as string,
      location: row.location as string,
      happenedOn: row.happened_on as string,
      suspectKind,
      suspectHandle,
      details: row.details as string,
      evidence: ((row.evidence as string) ?? "").split("\n").filter(isWebAddress),
      state: row.state as ReportState,
      handledBy: (row.handled_by as string | null) ?? null,
      handledAt: (row.handled_at as string | null) ?? null,
      outcomeNote: (row.outcome_note as string) ?? "",
      event: eventId && events.has(eventId) ? { id: eventId, title: events.get(eventId) as string } : null,
      entries: entries.filter((entry) => entry.reportId === id).map(card),
      known: known ? card(known) : null,
    };
  });

  return {
    state: "ready",
    waiting: all.filter((report) => report.state === "new").sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.receivedAt.localeCompare(b.receivedAt)),
    closed: all.filter((report) => report.state !== "new").sort((a, b) => (b.handledAt ?? b.receivedAt).localeCompare(a.handledAt ?? a.receivedAt)),
    names,
  };
}
