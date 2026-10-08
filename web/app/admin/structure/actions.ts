"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { explainRefusal } from "@/lib/refusals";
import { GRADES, sheetOf, type FieldSpec, type Sheet } from "@/lib/structure";
import { createClient } from "@/lib/supabase/server";

/**
 * What an admin can do to the fleet's structure. Nothing here decides who may
 * do it. The database does: only an admin's changes get through, a role keeps
 * to its kind, a post that has been held stays, and every change is logged.
 * Each action sends the change and passes on the database's answer.
 */

/** What a form is told. When a save is turned down, it gets back what was typed, so nothing is lost. */
export type EditResult = {
  ok: boolean;
  message: string;
  values?: Record<string, string>;
  /** When the answer was given. A form draws itself afresh for each answer, so its lists show what is now true. */
  stamp?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOT_CONNECTED: EditResult = { ok: false, message: "This site is not connected to the database yet." };
const NOT_THIS_PAGE = "That is not something this page can do.";
const ADMINS_ONLY = "Nothing was changed. Only an admin keeps the fleet's structure.";

type Value = string | number | boolean | string[] | null;
type DatabaseError = { code?: string; message: string };

/** The database client and the signed-in person's id, or a redirect to sign-in. */
async function signedIn() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) redirect("/sign-in");
  return { supabase, id };
}
type Session = NonNullable<Awaited<ReturnType<typeof signedIn>>>;

const said = async (session: Session, action: Attempt, shown: string): Promise<EditResult> => ({
  ok: false,
  message: await refused(session.supabase, action, shown),
});
const failed = async (session: Session, action: Attempt, error: DatabaseError, shown: string): Promise<EditResult> => ({
  ok: false,
  message: await turnedDown(session.supabase, action, error, shown),
});

/** What to tell the admin when the database says no. */
function explain(sheet: Sheet, error: DatabaseError): string {
  if (error.code === "23505") return `Another ${sheet.one} already has that name or address.`;
  // Something still points at the record. PostgreSQL 18 gives a refusal to remove its own code.
  if (error.code === "23503" || error.code === "23001") return sheet.inUse;
  if (error.code === "42501" && /row-level security|permission denied/.test(error.message)) return ADMINS_ONLY;
  return explainRefusal(error, `The ${sheet.one} could not be saved. Check each field and try again.`);
}

/** One field's value from the form, or what is wrong with it. */
function read(field: FieldSpec, formData: FormData): { value: Value } | { problem: string } {
  const raw = formData.get(field.key);
  const text = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  const missing = { problem: `Fill in "${field.label}".` };

  switch (field.kind) {
    case "text": {
      const value = text.replace(/\s+/g, " ");
      if (value === "") return field.required ? missing : { value: "" };
      if (value.length > field.max) return { problem: `Keep "${field.label}" under ${field.max} characters.` };
      return { value };
    }
    case "slug": {
      if (text === "") return missing;
      if (text.length > 60 || !SLUG.test(text)) {
        return { problem: `"${field.label}" is lower-case letters and numbers, with hyphens between words: fire-control.` };
      }
      return { value: text };
    }
    case "long": {
      if (text === "") return field.required ? missing : { value: "" };
      if (text.length > field.max) return { problem: `Keep "${field.label}" under ${field.max.toLocaleString("en-GB")} characters.` };
      return { value: text };
    }
    case "lines": {
      const lines = text
        .split("\n")
        .map((line) => line.trim().replace(/^\/?(manual\/)?/, ""))
        .filter(Boolean);
      if (lines.length > field.most) return { problem: `Keep "${field.label}" to ${field.most} lines.` };
      const odd = lines.find((line) => !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(line));
      if (odd) return { problem: `"${odd}" is not a section of the manual. Write each as volume/section, such as command/orders.` };
      return { value: lines };
    }
    case "number": {
      if (text === "") return field.required ? missing : { value: null };
      const value = Number(text);
      if (!Number.isInteger(value) || value < field.min || value > field.max) {
        return { problem: `"${field.label}" is a whole number from ${field.min} to ${field.max}.` };
      }
      return { value };
    }
    case "choice": {
      if (text === "") return field.required ? missing : { value: null };
      if (!field.options.some((option) => option.value === text)) return { problem: `Choose "${field.label}" from the list.` };
      return { value: text };
    }
    case "record": {
      if (text === "") return field.required ? { problem: `Choose "${field.label}".` } : { value: null };
      if (!UUID.test(text)) return { problem: `Choose "${field.label}" from the list.` };
      return { value: text };
    }
    case "yes-no":
      return { value: raw === "on" };
  }
}

/** Two values as one text each, so a number, a list and nothing compare as the form sees them. */
const same = (a: unknown, b: unknown) => {
  const text = (value: unknown) => (value === null || value === undefined ? "" : Array.isArray(value) ? value.join("\n") : String(value));
  return text(a) === text(b);
};

/** Add a record, or change one. Only the fields that differ are sent, so the log shows what changed. */
export async function saveRecord(_previous: EditResult, formData: FormData): Promise<EditResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const result = await save(session, formData);
  const stamp = Date.now();
  if (result.ok) return { ...result, stamp };
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return { ...result, values, stamp };
}

async function save(session: Session, formData: FormData): Promise<EditResult> {
  const sheet = sheetOf(String(formData.get("sheet") ?? ""));
  const id = String(formData.get("id") ?? "");
  if (!sheet || (id !== "" && !UUID.test(id))) return said(session, "structure.save", NOT_THIS_PAGE);

  const record: Record<string, Value> = {};
  for (const field of sheet.fields) {
    if (field.onlyWhenNew && id !== "") continue;
    const found = read(field, formData);
    if ("problem" in found) return { ok: false, message: found.problem };
    record[field.key] = found.value;
  }

  if (sheet.key === "posts") {
    // A post takes its kind from its role, so the two can never disagree.
    const role = await session.supabase.from("fleet_roles").select("kind").eq("id", String(record.role_id)).maybeSingle();
    if (role.error) return failed(session, "structure.save", role.error, "The role could not be read. Try again.");
    if (!role.data) return { ok: false, message: "Choose a role from the list." };
    record.kind = role.data.kind;
    if (role.data.kind === "primary") {
      if (!record.nominal_grade || !record.min_grade || !record.max_grade) {
        return { ok: false, message: "A primary post needs its usual, lowest and highest grades." };
      }
      const place = (grade: Value) => GRADES.indexOf(String(grade));
      if (place(record.min_grade) > place(record.nominal_grade) || place(record.nominal_grade) > place(record.max_grade)) {
        return { ok: false, message: "The usual grade sits between the lowest and the highest." };
      }
    } else {
      record.nominal_grade = null;
      record.max_grade = null;
      record.is_entry = false;
    }
  }
  if ((sheet.key === "units" && record.parent_id === id) || (sheet.key === "roles" && record.next_role_id === id)) {
    return { ok: false, message: sheet.key === "units" ? "A unit cannot be under itself." : "A role cannot lead to itself." };
  }

  if (id === "") {
    const { error } = await session.supabase.from(sheet.table).insert(record);
    if (error) return failed(session, "structure.save", error, explain(sheet, error));
    refresh();
    return { ok: true, message: "Added." };
  }

  const current = await session.supabase.from(sheet.table).select("*").eq("id", id).maybeSingle();
  if (current.error) return failed(session, "structure.save", current.error, `The ${sheet.one} could not be read. Try again.`);
  if (!current.data) return said(session, "structure.save", `That ${sheet.one} is no longer there.`);
  const changes: Record<string, Value> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!same((current.data as Record<string, unknown>)[key], value)) changes[key] = value;
  }
  if (Object.keys(changes).length === 0) return { ok: true, message: "Nothing was changed." };

  const { data, error } = await session.supabase.from(sheet.table).update(changes).eq("id", id).select("id");
  if (error) return failed(session, "structure.save", error, explain(sheet, error));
  if (!data || data.length === 0) return said(session, "structure.save", ADMINS_ONLY);
  refresh();
  return { ok: true, message: "Saved." };
}

/** Remove a record. The database refuses while anything still hangs from it. */
export async function removeRecord(_previous: EditResult, formData: FormData): Promise<EditResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const sheet = sheetOf(String(formData.get("sheet") ?? ""));
  const id = String(formData.get("id") ?? "");
  if (!sheet || !UUID.test(id)) return said(session, "structure.remove", NOT_THIS_PAGE);

  const { data, error } = await session.supabase.from(sheet.table).delete().eq("id", id).select("id");
  if (error) return failed(session, "structure.remove", error, explain(sheet, error));
  if (!data || data.length === 0) return said(session, "structure.remove", ADMINS_ONLY);
  refresh();
  return { ok: true, message: "Removed." };
}

/** Set what a role or a post needs: which qualifications, and which an acting holder is let off. */
export async function saveNeeds(_previous: EditResult, formData: FormData): Promise<EditResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const sheet = sheetOf(String(formData.get("sheet") ?? ""));
  const id = String(formData.get("id") ?? "");
  if (!sheet?.needs || !UUID.test(id)) return said(session, "structure.needs", NOT_THIS_PAGE);
  const { table, column } = sheet.needs;

  const wanted = formData.getAll("need").filter((value): value is string => typeof value === "string" && UUID.test(value));
  const waived = new Set(formData.getAll("waived").filter((value): value is string => typeof value === "string"));

  const current = await session.supabase.from(table).select("qualification_id, waived_when_acting").eq(column, id);
  if (current.error) return failed(session, "structure.needs", current.error, "What it needs could not be read. Try again.");
  const held = new Map((current.data ?? []).map((row) => [row.qualification_id as string, row.waived_when_acting === true]));

  let changed = 0;
  for (const [qualification] of held) {
    if (wanted.includes(qualification)) continue;
    const { data, error } = await session.supabase.from(table).delete().eq(column, id).eq("qualification_id", qualification).select("qualification_id");
    if (error) return failed(session, "structure.needs", error, explain(sheet, error));
    if (!data || data.length === 0) return said(session, "structure.needs", ADMINS_ONLY);
    changed += 1;
  }
  for (const qualification of wanted) {
    const letOff = waived.has(qualification);
    if (!held.has(qualification)) {
      const { error } = await session.supabase.from(table).insert({ [column]: id, qualification_id: qualification, waived_when_acting: letOff });
      if (error) return failed(session, "structure.needs", error, explain(sheet, error));
      changed += 1;
    } else if (held.get(qualification) !== letOff) {
      const { data, error } = await session.supabase
        .from(table)
        .update({ waived_when_acting: letOff })
        .eq(column, id)
        .eq("qualification_id", qualification)
        .select("qualification_id");
      if (error) return failed(session, "structure.needs", error, explain(sheet, error));
      if (!data || data.length === 0) return said(session, "structure.needs", ADMINS_ONLY);
      changed += 1;
    }
  }
  if (changed === 0) return { ok: true, message: "Nothing was changed." };
  refresh();
  return { ok: true, message: "Saved." };
}

const SERVICES = ["navy", "army", "marines"] as const;

/** Change what a grade usually does, and what each service calls it. */
export async function saveGrade(_previous: EditResult, formData: FormData): Promise<EditResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const code = String(formData.get("code") ?? "");
  if (!GRADES.includes(code)) return said(session, "ranks.save", NOT_THIS_PAGE);

  const text = (key: string) => String(formData.get(key) ?? "").replace(/\s+/g, " ").trim();
  const typical = text("typical_position");
  if (typical === "" || typical.length > 80) return { ok: false, message: "Say what the grade usually does, in under 80 characters." };
  const names = Object.fromEntries(SERVICES.map((service) => [service, text(service)])) as Record<(typeof SERVICES)[number], string>;
  for (const service of SERVICES) {
    if (names[service] === "" || names[service].length > 40) return { ok: false, message: "Give each service a rank name of under 40 characters." };
  }

  const [grade, ranks] = await Promise.all([
    session.supabase.from("grades").select("typical_position").eq("code", code).maybeSingle(),
    session.supabase.from("ranks").select("service, name").eq("grade_code", code),
  ]);
  if (grade.error || ranks.error) return failed(session, "ranks.save", (grade.error ?? ranks.error)!, "The grade could not be read. Try again.");

  let changed = 0;
  if (grade.data && grade.data.typical_position !== typical) {
    const { data, error } = await session.supabase.from("grades").update({ typical_position: typical }).eq("code", code).select("code");
    if (error) return failed(session, "ranks.save", error, explainRefusal(error, "The grade could not be saved. Try again."));
    if (!data || data.length === 0) return said(session, "ranks.save", ADMINS_ONLY);
    changed += 1;
  }
  for (const service of SERVICES) {
    const held = (ranks.data ?? []).find((rank) => rank.service === service)?.name;
    if (held === names[service]) continue;
    const { data, error } = await session.supabase
      .from("ranks")
      .update({ name: names[service] })
      .eq("grade_code", code)
      .eq("service", service)
      .select("grade_code");
    if (error) return failed(session, "ranks.save", error, explainRefusal(error, "The rank name could not be saved. Try again."));
    if (!data || data.length === 0) return said(session, "ranks.save", ADMINS_ONLY);
    changed += 1;
  }
  if (changed === 0) return { ok: true, message: "Nothing was changed." };
  refresh();
  return { ok: true, message: "Saved." };
}
