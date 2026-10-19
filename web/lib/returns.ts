import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The monthly returns the database records on the first of each month:
 * strength at the month's end, who joined and left, the register, events
 * held and attendances. Command's to read.
 */

export type MonthlyReturn = {
  month: string;
  recordedAt: string;
  serving: number;
  members: number;
  auxiliaries: number;
  recruits: number;
  reserve: number;
  joined: number;
  departed: number;
  hulls: number | null;
  hullsReady: number | null;
  eventsHeld: number;
  attendances: number;
};

type Row = Record<string, unknown>;

/** Every month recorded, the latest first. The database sends them to command and to nobody else. */
export async function getMonthlyReturns(): Promise<MonthlyReturn[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const found = await supabase.from("fleet_returns").select("*").order("month", { ascending: false }).range(0, 599);
  if (found.error) throw new Error(`The returns could not be read: ${found.error.message}`);
  return ((found.data ?? []) as Row[]).map((row) => ({
    month: String(row.month).slice(0, 10),
    recordedAt: row.recorded_at as string,
    serving: Number(row.serving),
    members: Number(row.members),
    auxiliaries: Number(row.auxiliaries),
    recruits: Number(row.recruits),
    reserve: Number(row.reserve),
    joined: Number(row.joined),
    departed: Number(row.departed),
    hulls: row.hulls === null || row.hulls === undefined ? null : Number(row.hulls),
    hullsReady: row.hulls_ready === null || row.hulls_ready === undefined ? null : Number(row.hulls_ready),
    eventsHeld: Number(row.events_held),
    attendances: Number(row.attendances),
  }));
}

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** A month as the page names it: October 2026. */
export const monthName = (month: string) => monthFormat.format(new Date(`${month.slice(0, 10)}T00:00:00Z`));
