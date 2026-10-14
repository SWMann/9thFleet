"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { typed } from "@/lib/application-form";
import { readOrders } from "@/lib/orders-form";
import { explainRefusal } from "@/lib/refusals";
import { draftFromRecord } from "@/lib/routine-orders";
import { createClient } from "@/lib/supabase/server";

/**
 * What command does with routine orders, and what a member does with an
 * issue. Nothing here decides who may: the database does. Command drafts,
 * writes, issues and corrects; the number, the dates and the period are the
 * database's; a member marks an issue as read for themselves.
 */

export type OrdersResult = {
  ok: boolean;
  message: string;
  /** What was typed, given back when it was not saved, so that the form keeps it. */
  values?: Record<string, string>;
  stamp?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONNECTED: OrdersResult = { ok: false, message: "This site is not connected to the database yet." };
const NOT_THIS_PAGE = "That is not something this page can do.";

async function signedIn() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) redirect("/sign-in");
  return { supabase, id };
}
type Session = NonNullable<Awaited<ReturnType<typeof signedIn>>>;

const uuid = (value: FormDataEntryValue | null) => (typeof value === "string" && UUID.test(value) ? value : null);

function typedInto(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}

async function answer(
  session: Session,
  action: Attempt,
  result: { data: unknown[] | null; error: { code?: string; message: string } | null },
  words: { done: string; refusedAs: string; nothing: string },
): Promise<OrdersResult> {
  if (result.error) return { ok: false, message: await turnedDown(session.supabase, action, result.error, explainRefusal(result.error, words.refusedAs)) };
  refresh();
  if (!result.data || result.data.length === 0) return { ok: false, message: await refused(session.supabase, action, words.nothing) };
  return { ok: true, message: words.done };
}

/**
 * Draft the next issue. The database opens the draft and sets the period it
 * records; the site then writes the record of that period into it.
 */
export async function draftOrders(): Promise<OrdersResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const opened = await session.supabase.from("routine_orders").insert({ title: "" }).select("id, covers_from, covers_to").single();
  if (opened.error) {
    const shown = opened.error.code === "23505" ? "A draft is already waiting. Finish it, or discard it, before drafting another." : explainRefusal(opened.error, "The draft could not be opened. Command drafts routine orders.");
    return { ok: false, message: await turnedDown(session.supabase, "orders.draft", opened.error, shown) };
  }
  const { data: before } = await session.supabase.from("routine_orders").select("id").eq("state", "issued").limit(1);
  const body = await draftFromRecord(opened.data.covers_from as string, opened.data.covers_to as string, (before ?? []).length === 0);
  const written = await session.supabase.from("routine_orders").update({ body }).eq("id", opened.data.id as string).select("id");
  if (written.error) return { ok: false, message: await turnedDown(session.supabase, "orders.draft", written.error, "The draft was opened but could not be written. Open it and write it yourself.") };
  redirect("/routine-orders/draft");
}

/** Save the title and words of a draft, or correct an issued order. */
export async function saveOrders(_previous: OrdersResult, formData: FormData): Promise<OrdersResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const again = { values: typedInto(formData), stamp: Date.now() };
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "orders.save", NOT_THIS_PAGE) };
  const read = readOrders((name) => typed(formData.get(name)));
  if ("problem" in read) return { ok: false, message: read.problem, ...again };

  const result = await session.supabase.from("routine_orders").update(read.fields).eq("id", id).select("id");
  const saved = await answer(session, "orders.save", result, {
    done: "Saved.",
    refusedAs: "That could not be saved. Try again.",
    nothing: "Nothing was saved. Command writes routine orders, and this one may have been discarded.",
  });
  return saved.ok ? { ...saved, stamp: Date.now() } : { ...saved, ...again };
}

/** Issue the draft. The database numbers it, signs it and sends it to the fleet. */
export async function issueOrders(_previous: OrdersResult, formData: FormData): Promise<OrdersResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "orders.issue", NOT_THIS_PAGE) };
  const result = await session.supabase.from("routine_orders").update({ state: "issued" }).eq("id", id).eq("state", "draft").select("number");
  if (result.error) return { ok: false, message: await turnedDown(session.supabase, "orders.issue", result.error, explainRefusal(result.error, "The orders could not be issued. Try again.")) };
  const number = result.data?.[0]?.number;
  if (typeof number !== "number") return { ok: false, message: await refused(session.supabase, "orders.issue", "Nothing was issued. The draft may have been issued or discarded already.") };
  refresh();
  redirect(`/routine-orders/${number}`);
}

/** Discard the draft. An issued order is never discarded. */
export async function discardDraft(_previous: OrdersResult, formData: FormData): Promise<OrdersResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "orders.discard", NOT_THIS_PAGE) };
  const result = await session.supabase.from("routine_orders").delete().eq("id", id).eq("state", "draft").select("id");
  if (result.error) return { ok: false, message: await turnedDown(session.supabase, "orders.discard", result.error, explainRefusal(result.error, "The draft could not be discarded. Try again.")) };
  if (!result.data || result.data.length === 0) return { ok: false, message: await refused(session.supabase, "orders.discard", "Nothing was discarded. Only a draft can be, and only by command.") };
  refresh();
  redirect("/routine-orders");
}

/** Mark an issue as read, for yourself. */
export async function markOrdersRead(_previous: OrdersResult, formData: FormData): Promise<OrdersResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "orders.read", NOT_THIS_PAGE) };
  const { error } = await session.supabase.from("routine_order_reads").insert({ order_id: id, member_id: session.id });
  // Marked twice is marked once.
  if (error && error.code !== "23505") {
    return { ok: false, message: await turnedDown(session.supabase, "orders.read", error, explainRefusal(error, "That could not be marked. Try again.")) };
  }
  refresh();
  return { ok: true, message: "Marked as read." };
}
