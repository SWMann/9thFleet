/**
 * Which pages have their views counted: the public ones. A member's pages
 * never are. The database keeps the same list and has the last word, in
 * `app.count_page_view`. Keep the two in step.
 */
const SECTIONS = ["standards", "ranks", "joining", "manual", "roles", "credits", "privacy", "menu", "sign-in"];

/** The address to count a view under, or null if this page is not counted. */
export function countedPath(pathname: string): string | null {
  const path = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (path.length > 120 || !/^\/[a-z0-9/-]*$/.test(path) || path.includes("//")) return null;
  const first = path.split("/")[1] ?? "";
  return first === "" || SECTIONS.includes(first) ? path : null;
}

/** Why a sign-in came back without a session. Counted under /sign-in/, so the Logs page can show them. */
export const SIGN_IN_PROBLEMS = ["cancelled", "service", "callback", "discord"];
