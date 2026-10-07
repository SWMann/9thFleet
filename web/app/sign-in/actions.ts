"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { originOf } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/** Send the visitor to Discord. Discord sends them back to /auth/callback. */
export async function signInWithDiscord() {
  const supabase = await createClient();
  if (!supabase) redirect("/sign-in?problem=setup");

  const origin = originOf(await headers());
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) redirect("/sign-in?problem=discord");

  redirect(data.url);
}
