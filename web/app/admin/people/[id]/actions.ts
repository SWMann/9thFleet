"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown } from "@/lib/activity";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";

export type DutyResult = { ok: boolean; message: string; stamp?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renew a secondary duty for another term, from today. The database decides
 * who may, and that only a duty still held is renewed.
 */
export async function renewDuty(_previous: DutyResult, formData: FormData): Promise<DutyResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "This site is not connected to the database yet." };
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/sign-in");
  const id = formData.get("assignment");
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, message: await refused(supabase, "duty.renew", "That is not something this page can do.") };
  const today = new Date().toISOString().slice(0, 10);
  const renewed = await supabase.from("assignments").update({ renewed_on: today }).eq("id", id).eq("kind", "duty").is("ended_on", null).select("id");
  if (renewed.error) return { ok: false, message: await turnedDown(supabase, "duty.renew", renewed.error, explainRefusal(renewed.error, "The duty could not be renewed. Command renews a duty that is still held.")), stamp: Date.now() };
  if (!renewed.data || renewed.data.length === 0) return { ok: false, message: await refused(supabase, "duty.renew", "The duty could not be renewed. Command renews a duty that is still held."), stamp: Date.now() };
  refresh();
  return { ok: true, message: "Renewed for another term, from today.", stamp: Date.now() };
}
