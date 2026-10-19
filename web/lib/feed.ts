import "server-only";
import { createClient } from "@/lib/supabase/server";

/** The signed-in member's own calendar feed key, if they have made one. */
export async function getFeedKey(memberId: string): Promise<{ key: string; madeAt: string } | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const found = await supabase.from("calendar_keys").select("key, made_at").eq("member_id", memberId).maybeSingle();
  if (found.error) throw new Error(`The calendar key could not be read: ${found.error.message}`);
  return found.data ? { key: found.data.key as string, madeAt: found.data.made_at as string } : null;
}
