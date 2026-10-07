import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Service = "navy" | "army" | "marines";
export type Status = "applicant" | "recruit" | "auxiliary" | "member" | "reserve" | "discharged";
export type Role = "instructor" | "staff" | "command" | "admin";

/** What the site shows a member about themselves. */
export type Member = {
  id: string;
  discordName: string | null;
  characterName: string | null;
  rsiHandle: string | null;
  service: Service | null;
  status: Status;
  gradeCode: string | null;
  rankName: string | null;
  acting: boolean;
  postTitle: string | null;
  unitName: string | null;
  roles: Role[];
};

export type Session =
  | { state: "no-database" }
  | { state: "signed-out" }
  /** Signed in, but not through Discord, so the fleet has no record of them. */
  | { state: "no-record" }
  | { state: "member"; member: Member; recruitmentOpen: boolean };

/**
 * Who is signed in on this request, read once and shared by everything that
 * asks. The session is checked here, on the server, every time. The database
 * then returns only the rows this person is allowed to see.
 */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) return { state: "signed-out" };

  const [roster, account, roles, settings] = await Promise.all([
    supabase
      .from("roster")
      .select("character_name, rsi_handle, service, status, grade_code, rank_name, acting, position_title, unit_name")
      .eq("member_id", id)
      .maybeSingle(),
    supabase.from("member_accounts").select("discord_name").eq("member_id", id).maybeSingle(),
    supabase.from("member_roles").select("role").eq("member_id", id),
    supabase.from("fleet_settings").select("recruitment_open").maybeSingle(),
  ]);
  for (const result of [roster, account, roles, settings]) {
    if (result.error) {
      throw new Error(`The database could not be read: ${result.error.message}`);
    }
  }
  if (!roster.data) return { state: "no-record" };

  return {
    state: "member",
    recruitmentOpen: settings.data?.recruitment_open === true,
    member: {
      id,
      discordName: account.data?.discord_name ?? null,
      characterName: roster.data.character_name,
      rsiHandle: roster.data.rsi_handle,
      service: roster.data.service,
      status: roster.data.status,
      gradeCode: roster.data.grade_code,
      rankName: roster.data.rank_name,
      acting: roster.data.acting === true,
      postTitle: roster.data.position_title,
      unitName: roster.data.unit_name,
      roles: (roles.data ?? []).map((row) => row.role as Role),
    },
  };
});
