"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SIGNED_IN_COOKIE } from "@/lib/supabase/cookies";
import { createClient } from "@/lib/supabase/server";

export type NamesResult = { ok: boolean; message: string };

const NAME_PATTERN = /^\p{L}[\p{L} .'-]*$/u;
const HANDLE_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Save the member's character name and RSI handle.
 *
 * The checks here only give a clear message early. The database decides what
 * is allowed: it fixes a character name once someone has joined, and keeps
 * names unique inside the fleet.
 */
export async function saveNames(_previous: NamesResult, formData: FormData): Promise<NamesResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "This site is not connected to the database yet." };

  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) redirect("/sign-in");

  const changes: { character_name?: string; rsi_handle?: string } = {};

  const rawName = formData.get("character_name");
  if (typeof rawName === "string") {
    const name = rawName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 40) {
      return { ok: false, message: "A character name is 2 to 40 characters long." };
    }
    if (!NAME_PATTERN.test(name)) {
      return { ok: false, message: "A character name uses letters, spaces, hyphens, apostrophes and full stops." };
    }
    changes.character_name = name;
  }

  const rawHandle = formData.get("rsi_handle");
  if (typeof rawHandle === "string") {
    const handle = rawHandle.trim();
    if (handle.length < 3 || handle.length > 60) {
      return { ok: false, message: "An RSI handle is 3 to 60 characters long." };
    }
    if (!HANDLE_PATTERN.test(handle)) {
      return { ok: false, message: "An RSI handle uses letters, numbers, hyphens and underscores, with no spaces." };
    }
    changes.rsi_handle = handle;
  }

  if (Object.keys(changes).length === 0) {
    return { ok: false, message: "There was nothing to save." };
  }

  const { data, error } = await supabase.from("members").update(changes).eq("id", id).select("id");
  if (error) return { ok: false, message: explain(error) };
  if (!data || data.length === 0) return { ok: false, message: "Your record could not be found." };

  refresh();
  return { ok: true, message: "Saved." };
}

function explain(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return error.message.includes("rsi_handle")
      ? "Another member already has that RSI handle."
      : "Another member already has that character name.";
  }
  // The database's own refusals are written to be read, so pass them on.
  if (error.code === "42501" && !error.message.startsWith("permission denied")) {
    return error.message;
  }
  return "That could not be saved. Try again, and tell staff if it keeps happening.";
}

export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  (await cookies()).delete(SIGNED_IN_COOKIE);
  redirect("/");
}
