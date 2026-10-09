"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown } from "@/lib/activity";
import { confirmations, questions, typed } from "@/lib/application-form";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";

export type ApplyResult = {
  ok: boolean;
  message: string;
  /** What was typed and ticked, given back when the application was not sent, so that the form keeps it. */
  values?: Record<string, string>;
  /** Changes each time the form is given back, so that it is drawn afresh. */
  stamp?: number;
};

const SERVICES = ["navy", "army", "marines"];

/**
 * Send an application.
 *
 * The checks here give a clear message early. The database decides whether the
 * application is accepted: recruitment must be open, the service must be open,
 * the applicant needs their names set, and only one application can be open.
 */
export async function submitApplication(_previous: ApplyResult, formData: FormData): Promise<ApplyResult> {
  const result = await send(formData);
  if (result.ok) return result;
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return { ...result, values, stamp: Date.now() };
}

async function send(formData: FormData): Promise<ApplyResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "This site is not connected to the database yet." };

  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) redirect("/sign-in");

  const service = formData.get("service");
  if (typeof service !== "string" || !SERVICES.includes(service)) {
    return { ok: false, message: "Choose a service." };
  }

  const answers: { question: string; answer: string }[] = [];
  for (const question of questions) {
    const answer = typed(formData.get(question.id));
    if (answer === "") {
      if (question.required) return { ok: false, message: `Answer the question "${question.label}"` };
      continue;
    }
    if (answer.length > question.max) {
      return { ok: false, message: `Keep the answer to "${question.label}" under ${question.max} characters.` };
    }
    answers.push({ question: question.label, answer });
  }

  const confirmed: string[] = [];
  for (const confirmation of confirmations) {
    if (formData.get(confirmation.id) !== "on") {
      return { ok: false, message: `You need to confirm: ${confirmation.statement}` };
    }
    confirmed.push(confirmation.statement);
  }

  const { error } = await supabase
    .from("applications")
    .insert({ member_id: id, route: "recruit", preferred_service: service, answers: { answers, confirmed } });
  if (error) return { ok: false, message: await turnedDown(supabase, "application.send", error, explain(error)) };

  refresh();
  return { ok: true, message: "Sent." };
}

function explain(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "You already have an application with staff.";
  if (error.code === "42501" && error.message.includes("row-level security")) {
    return "The database did not accept the application. Recruitment or that service may have closed, or your names may not be set.";
  }
  return explainRefusal(error, "The application could not be sent. Try again, and tell staff if it keeps happening.");
}

/** Withdraw the applicant's own open application. */
export async function withdrawApplication(formData: FormData) {
  const supabase = await createClient();
  const applicationId = formData.get("id");
  if (!supabase || typeof applicationId !== "string") redirect("/apply");

  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) redirect("/sign-in");

  const { data, error } = await supabase
    .from("applications")
    .update({ stage: "withdrawn" })
    .eq("id", applicationId)
    .eq("member_id", id)
    .select("id");
  if (error) {
    await turnedDown(supabase, "application.withdraw", error, "The application could not be withdrawn.");
    throw new Error(`The application could not be withdrawn: ${error.message}`);
  }
  if (!data || data.length === 0) {
    await refused(supabase, "application.withdraw", "There was no open application of theirs to withdraw.");
  }
  redirect("/apply");
}
