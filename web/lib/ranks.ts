import "server-only";
import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import type { Service } from "@/lib/member";
import { supabaseEnv } from "@/lib/supabase/env";

export type Band = "enlisted" | "nco" | "cadet" | "officer";

export type Grade = {
  code: string;
  band: Band;
  /** What someone at this grade usually does, such as "Team leader". */
  typicalPosition: string;
  /** The rank's name in each service. */
  names: Record<Service, string>;
  /** The stage at which the grade can first be held. */
  opensAtStage: number;
};

export type RankTable =
  | { state: "no-database" }
  | { state: "ready"; stage: number; openServices: Service[]; grades: Grade[] };

/**
 * No rank is held above the largest formation that is open, so the top of the
 * ladder opens one grade at a time. Everything up to O4 is open from stage 1.
 */
const OPENS_AT_STAGE: Record<string, number> = { O5: 4, O6: 5, O7: 6, O8: 7, O9: 8, O10: 9 };

/**
 * The grades, their rank names and the fleet's stage. Anyone may read these,
 * signed in or not, so this asks as a visitor and needs no session.
 */
export async function getRankTable(): Promise<RankTable> {
  // The stage changes, so read it when the page is asked for, not when the site is built.
  await connection();
  if (!supabaseEnv) return { state: "no-database" };
  const supabase = createClient(supabaseEnv.url, supabaseEnv.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const [settings, grades, ranks] = await Promise.all([
    supabase.from("fleet_settings").select("current_stage, open_services").maybeSingle(),
    supabase.from("grades").select("code, sort_order, band, typical_position").order("sort_order"),
    supabase.from("ranks").select("service, grade_code, name"),
  ]);
  for (const result of [settings, grades, ranks]) {
    if (result.error) throw new Error(`The ranks could not be read: ${result.error.message}`);
  }

  const names = new Map<string, Partial<Record<Service, string>>>();
  for (const rank of ranks.data ?? []) {
    names.set(rank.grade_code, { ...names.get(rank.grade_code), [rank.service as Service]: rank.name });
  }

  return {
    state: "ready",
    stage: settings.data?.current_stage ?? 1,
    openServices: (settings.data?.open_services ?? ["navy"]) as Service[],
    grades: (grades.data ?? []).map((grade) => ({
      code: grade.code,
      band: grade.band as Band,
      typicalPosition: grade.typical_position,
      names: { navy: "", army: "", marines: "", ...names.get(grade.code) },
      opensAtStage: OPENS_AT_STAGE[grade.code] ?? 1,
    })),
  };
}
