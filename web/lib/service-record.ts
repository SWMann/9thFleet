import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * What a member has earned: the qualifications they hold, and the times they
 * were mentioned in an after-action report. Read as the member, so the
 * database returns only what they may see.
 */

export type ServiceRecord = {
  qualifications: { name: string; awardedOn: string; event: { id: string; title: string } | null }[];
  mentions: { citation: string; mentionedAt: string; event: { id: string; title: string } }[];
};

export async function getServiceRecord(memberId: string): Promise<ServiceRecord> {
  const supabase = await createClient();
  if (!supabase) return { qualifications: [], mentions: [] };

  const [awards, qualifications, mentions] = await Promise.all([
    supabase.from("qualification_awards").select("qualification_id, awarded_on, event_id").eq("member_id", memberId),
    supabase.from("qualifications").select("id, name"),
    supabase.from("event_mentions").select("event_id, citation, mentioned_at").eq("member_id", memberId),
  ]);
  for (const result of [awards, qualifications, mentions]) {
    if (result.error) throw new Error(`Your record could not be read: ${result.error.message}`);
  }
  const awardRows = (awards.data ?? []) as { qualification_id: string; awarded_on: string; event_id: string | null }[];
  const mentionRows = (mentions.data ?? []) as { event_id: string; citation: string; mentioned_at: string }[];

  // The events these point at, for their titles. One the member can no longer see is left without a link.
  const eventIds = [...new Set([...awardRows.map((row) => row.event_id), ...mentionRows.map((row) => row.event_id)].filter((id): id is string => Boolean(id)))];
  const events = eventIds.length > 0 ? await supabase.from("events").select("id, title").in("id", eventIds) : { data: [], error: null };
  if (events.error) throw new Error(`Your record could not be read: ${events.error.message}`);
  const title = new Map(((events.data ?? []) as { id: string; title: string }[]).map((event) => [event.id, event.title]));
  const name = new Map(((qualifications.data ?? []) as { id: string; name: string }[]).map((entry) => [entry.id, entry.name]));

  return {
    qualifications: awardRows
      .map((row) => ({
        name: name.get(row.qualification_id) ?? "A qualification",
        awardedOn: row.awarded_on,
        event: row.event_id && title.has(row.event_id) ? { id: row.event_id, title: title.get(row.event_id)! } : null,
      }))
      .sort((a, b) => a.awardedOn.localeCompare(b.awardedOn) || a.name.localeCompare(b.name)),
    mentions: mentionRows
      .filter((row) => title.has(row.event_id))
      .map((row) => ({ citation: row.citation, mentionedAt: row.mentioned_at, event: { id: row.event_id, title: title.get(row.event_id)! } }))
      // The latest first.
      .sort((a, b) => b.mentionedAt.localeCompare(a.mentionedAt)),
  };
}
