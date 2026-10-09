import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The activity log: the things that never change a record, so the audit log
 * cannot see them. Someone signing in or out, and anything refused or failed.
 *
 * A line is written as the person it is about. The database says whose it is
 * and when, so nothing here can write a line in another name.
 *
 * Writing a line never stops the page. If the log cannot be written, the
 * person still gets their answer.
 */

export type ActivityKind = "sign_in" | "sign_out" | "refused" | "failed";

/**
 * What was being tried. The Logs page turns each into words. Add a name here
 * when a new action ships, and its words in `attemptNames` below.
 */
export const attemptNames = {
  "names.save": "save their names",
  "application.send": "send an application",
  "application.withdraw": "withdraw an application",
  "application.move": "move an application on",
  "note.add": "write an interview note",
  "note.remove": "remove an interview note",
  "recruitment.set": "open or close recruitment",
  "event.draft": "draft an event",
  "event.copy": "copy an event",
  "event.change": "change an event",
  "event.orders": "write an event's orders",
  "event.plan": "change an event's plan",
  "event.amend": "issue an amendment to an event's orders",
  "event.acknowledge": "acknowledge an amendment",
  "event.move": "announce or cancel an event",
  "event.approval": "ask for, give or take back approval of an event",
  "event.discord": "post an announcement to Discord",
  "event.opfor": "change an event's opposing force",
  "event.delete": "delete a draft event",
  "event.reply": "reply to an event",
  "event.stand-in": "set a stand-in",
  "event.taking": "say who takes part in an event",
  "event.place": "move someone on or off the reserve list",
  "event.return": "make an attendance return",
  "event.report": "file an after-action report",
  "event.sign-off": "sign off a qualification at an event",
  "structure.save": "change the fleet's structure",
  "structure.remove": "remove part of the fleet's structure",
  "structure.needs": "change what a role or post needs",
  "ranks.save": "change a grade or its rank names",
  "page.admin": "open an admin page",
  "page.staff": "open a staff page",
} as const;
export type Attempt = keyof typeof attemptNames;

type DatabaseError = { code?: string; message: string };

/** Codes the database gives when one of its rules said no. Anything else is a fault. */
const REFUSALS = ["42501", "23514", "23505", "23503", "23001", "23502", "P0001", "PGRST116"];

async function write(
  supabase: SupabaseClient,
  line: { kind: ActivityKind; action?: Attempt; shown?: string; cause?: string },
): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      kind: line.kind,
      action: line.action ?? null,
      shown: line.shown ?? null,
      cause: line.cause ?? null,
    });
  } catch {
    // The log is best effort.
  }
}

export const signedIn = (supabase: SupabaseClient) => write(supabase, { kind: "sign_in" });
export const signedOut = (supabase: SupabaseClient) => write(supabase, { kind: "sign_out" });

/**
 * The database answered with an error. Log it as refused when one of its rules
 * said no, and as failed otherwise. Returns the words shown, so an action can
 * write `message: await turnedDown(...)`.
 */
export async function turnedDown(supabase: SupabaseClient, action: Attempt, error: DatabaseError, shown: string): Promise<string> {
  const refused = REFUSALS.includes(error.code ?? "");
  await write(supabase, {
    kind: refused ? "refused" : "failed",
    action,
    shown,
    cause: `${error.code ?? "no code"}: ${error.message}`,
  });
  return shown;
}

/**
 * The site or the access rules said no without an error: a change that matched
 * no row, or a form asking for something its page never offers.
 */
export async function refused(supabase: SupabaseClient, action: Attempt, shown: string): Promise<string> {
  await write(supabase, { kind: "refused", action, shown });
  return shown;
}
