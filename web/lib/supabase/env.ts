/**
 * Where the database is, and the key that identifies this site to it.
 *
 * The Supabase integration on Vercel sets these. The key is the public one:
 * it is safe in a browser, because what a person may see or change is decided
 * by the database's own rules, not by this key. No secret key is used here.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY;

/** Null when the site has not been connected to a database yet. */
export const supabaseEnv = url && key ? { url, key } : null;
