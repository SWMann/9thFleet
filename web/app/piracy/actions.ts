"use server";

import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { typed } from "@/lib/application-form";
import { readReport } from "@/lib/piracy-form";
import { senderMark } from "@/lib/piracy-sender";
import { explainRefusal } from "@/lib/refusals";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * Send a piracy report. Anyone may, without signing in.
 *
 * The checks here give a clear message early. The database makes them again,
 * dates the report, and decides how many the line takes: five a day from one
 * sender, and ten an hour and thirty a day from everyone.
 *
 * A report is always sent as a visitor, so it never carries a member's
 * session, and nothing is read back. The sender's network address is used
 * once, here, to work out the mark the database counts. It is not stored.
 */

export type ReportResult = {
  ok: boolean;
  message: string;
  /** What was typed, given back when the report was not sent, so that the form keeps it. */
  values?: Record<string, string>;
  /** Changes each time the form is given back, so that it is drawn afresh. */
  stamp?: number;
};

/** The field no person sees. See the form. */
const TRAP = "fleet_check";

const sent = (urgent: boolean): ReportResult => ({
  ok: true,
  message: urgent
    ? "Report received. Command sees it the next time one of them opens this site. Help is not guaranteed."
    : "Report received. Command reads every report. There is no reply through this site.",
  stamp: Date.now(),
});

export async function sendReport(_previous: ReportResult, formData: FormData): Promise<ReportResult> {
  if (!supabaseEnv) return { ok: false, message: "This site is not connected to the database yet." };

  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && key !== TRAP) values[key] = value;
  }
  const again = { values, stamp: Date.now() };

  // A robot fills in every field it finds. It is told the report went, and nothing is sent.
  if (typed(formData.get(TRAP)) !== "") return sent(false);

  const today = new Date().toISOString().slice(0, 10);
  const read = readReport((name) => typed(formData.get(name)), today);
  if ("problem" in read) return { ok: false, message: read.problem, ...again };

  // The host sets these two itself, so a sender cannot choose them.
  const request = await headers();
  const sender = senderMark(request.get("x-real-ip") ?? request.get("x-forwarded-for"), today);

  const supabase = createClient(supabaseEnv.url, supabaseEnv.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.from("piracy_reports").insert({ ...read.fields, sender });
  if (error) {
    return { ok: false, message: explainRefusal(error, "The report could not be sent. Check it and try again."), ...again };
  }
  return sent(read.fields.urgent);
}
