import "server-only";
import { getSession, isServing, type Member } from "@/lib/member";
import { lapses, standing, type HostileKind, type HostileLevel, type HostileState } from "@/lib/hostile-form";
import { fleetSources } from "@/lib/rich/offer";
import type { RichSources } from "@/lib/rich/sources";
import { createClient } from "@/lib/supabase/server";

/**
 * The hostile list, read as the member asking. The database sends the list as
 * it stands today to everyone serving. A name that waits, was declined, was
 * lifted or has lapsed is sent only to whoever put it forward and to command.
 */

export type Hostile = {
  id: string;
  kind: HostileKind;
  handle: string;
  name: string;
  level: HostileLevel;
  state: HostileState;
  reason: string;
  /** Web addresses, checked again here before any is made a link. */
  evidence: string[];
  reportedBy: string | null;
  reportedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string;
  expiresOn: string | null;
  renewedAt: string | null;
  liftedBy: string | null;
  liftedAt: string | null;
  /** Whether it is the reader's own: they put it forward. */
  mine: boolean;
  /** Whether it lapses at all, how long it has left, and whether it has lapsed. */
  lapses: boolean;
  standing: ReturnType<typeof standing>;
};

export type HostileList =
  | { state: "no-database" }
  | { state: "signed-out" }
  | { state: "no-record" }
  /** Signed in, but not serving. The list is for the serving fleet. */
  | { state: "outside" }
  | {
      state: "ready";
      member: Member;
      /** Whether the reader keeps the list. */
      command: boolean;
      /** On the list today, by level. */
      hostile: Hostile[];
      watch: Hostile[];
      /** Put forward and not yet decided. Command sees them all; anyone else, their own. */
      waiting: Hostile[];
      /** Declined, lifted or lapsed. */
      past: Hostile[];
      /** Today in UTC, which every count of days is taken from. */
      today: string;
      /** Each serving member's name, by id. */
      names: Record<string, string>;
      /** What the editor offers whoever writes an entry. */
      sources: RichSources;
    };

type Row = Record<string, unknown>;

const isWebAddress = (line: string) => /^https?:\/\/\S+$/i.test(line);

export async function getHostiles(): Promise<HostileList> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  if (!isServing(session.member)) return { state: "outside" };
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [entries, roster, sources] = await Promise.all([
    supabase
      .from("hostiles")
      .select("id, kind, handle, name, level, state, reason, evidence, reported_by, reported_at, decided_by, decided_at, decision_note, expires_on, renewed_at, lifted_by, lifted_at")
      .order("handle", { ascending: true }),
    supabase.from("roster").select("member_id, character_name, rank_name, acting"),
    fleetSources(),
  ]);
  for (const result of [entries, roster]) {
    if (result.error) throw new Error(`The hostile list could not be read: ${result.error.message}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const me = session.member.id;
  const names: Record<string, string> = {};
  for (const row of (roster.data ?? []) as Row[]) {
    if (!row.character_name) continue;
    names[row.member_id as string] = row.rank_name ? `${row.acting === true ? "Acting " : ""}${row.rank_name} ${row.character_name}` : (row.character_name as string);
  }

  const all = ((entries.data ?? []) as Row[]).map((row): Hostile => {
    const kind = row.kind as HostileKind;
    const level = row.level as HostileLevel;
    const expiresOn = (row.expires_on as string | null) ?? null;
    return {
      id: row.id as string,
      kind,
      handle: row.handle as string,
      name: (row.name as string) ?? "",
      level,
      state: row.state as HostileState,
      reason: row.reason as string,
      evidence: ((row.evidence as string) ?? "").split("\n").filter(isWebAddress),
      reportedBy: (row.reported_by as string | null) ?? null,
      reportedAt: row.reported_at as string,
      decidedBy: (row.decided_by as string | null) ?? null,
      decidedAt: (row.decided_at as string | null) ?? null,
      decisionNote: (row.decision_note as string) ?? "",
      expiresOn,
      renewedAt: (row.renewed_at as string | null) ?? null,
      liftedBy: (row.lifted_by as string | null) ?? null,
      liftedAt: (row.lifted_at as string | null) ?? null,
      mine: row.reported_by === me,
      lapses: lapses(kind, level),
      standing: standing(expiresOn, today),
    };
  });

  const stands = (entry: Hostile) => entry.state === "listed" && !entry.standing.lapsed;
  const byHandle = (a: Hostile, b: Hostile) => a.handle.localeCompare(b.handle, "en", { sensitivity: "base" });
  // The soonest to lapse first, then those that stand until lifted.
  const bySoonest = (a: Hostile, b: Hostile) => (a.standing.daysLeft ?? Infinity) - (b.standing.daysLeft ?? Infinity) || byHandle(a, b);
  const latest = (entry: Hostile) => entry.liftedAt ?? entry.decidedAt ?? entry.expiresOn ?? entry.reportedAt;

  return {
    state: "ready",
    member: session.member,
    command: session.member.roles.some((role) => role === "command" || role === "admin"),
    hostile: all.filter((entry) => stands(entry) && entry.level === "hostile").sort((a, b) => Number(b.kind === "organisation") - Number(a.kind === "organisation") || byHandle(a, b)),
    watch: all.filter((entry) => stands(entry) && entry.level === "watch").sort(bySoonest),
    waiting: all.filter((entry) => entry.state === "proposed").sort((a, b) => a.reportedAt.localeCompare(b.reportedAt)),
    past: all.filter((entry) => entry.state !== "proposed" && !stands(entry)).sort((a, b) => latest(b).localeCompare(latest(a))),
    today,
    names,
    sources,
  };
}
