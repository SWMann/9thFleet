/**
 * A member's service record, worked out from what the database keeps.
 *
 * Nothing here reads the database, so each rule can be tested on its own. Dates
 * are days in UTC, written 2026-10-13, as the database keeps them.
 */

export type RecordStatus = "applicant" | "recruit" | "auxiliary" | "member" | "reserve" | "discharged";

/** A post the member holds or held. */
export type PostHeld = {
  id: string;
  title: string;
  unit: string;
  kind: "primary" | "duty";
  acting: boolean;
  /** The grade the post is held at now, or was when it was left. A duty has none. */
  gradeCode: string | null;
  startedOn: string;
  endedOn: string | null;
};

/** One line the database wrote when a post was taken up at a grade, or the grade changed in post. */
export type GradeLine = { id: number; assignmentId: string; gradeCode: string; acting: boolean; since: string };

export type StatusLine = { id: number; status: RecordStatus; changedOn: string };

export type Returned = "present" | "absent_with_notice" | "absent_without_notice";

/** An event the member was on the return of. */
export type EventLine = { id: string; title: string; startsAt: string; type: string; returned: Returned };

const DAY = 24 * 60 * 60 * 1000;

const dayOf = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);

/** Whole days from one day to another. Never less than nothing. */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((dayOf(to) - dayOf(from)) / DAY));
}

/** Today, as a day in UTC. */
export const today = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 10);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A length of time in the largest unit that fits: 6 days, 3 weeks, 5 months, 1 year 2 months. */
export function lengthOf(days: number): string {
  if (days < 1) return "Under a day";
  if (days < 14) return count(days, "day", "days");
  if (days < 70) return count(Math.floor(days / 7), "week", "weeks");
  const months = Math.floor(days / 30.4375);
  if (months < 12) return count(months, "month", "months");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? count(years, "year", "years") : `${count(years, "year", "years")} ${count(rest, "month", "months")}`;
}

/** Posts in the order they were taken up, the latest first. */
export function latestFirst<Post extends PostHeld>(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => b.startedOn.localeCompare(a.startedOn) || Number(a.endedOn !== null) - Number(b.endedOn !== null) || a.title.localeCompare(b.title));
}

/** The primary post held now, if there is one. */
export const currentPost = (posts: PostHeld[]) => posts.find((post) => post.kind === "primary" && post.endedOn === null) ?? null;

/** A stretch of time at one grade, in one post. */
export type GradePeriod = { assignmentId: string; gradeCode: string; acting: boolean; from: string; to: string | null };

/**
 * Every stretch at a grade, in order. A post's first stretch starts the day the
 * post did. Each later one starts the day the grade changed, and the last runs
 * until the post was left, or is still running.
 */
export function gradePeriods(posts: PostHeld[], lines: GradeLine[]): GradePeriod[] {
  const periods: GradePeriod[] = [];
  const primaries = posts.filter((post) => post.kind === "primary").sort((a, b) => a.startedOn.localeCompare(b.startedOn) || a.id.localeCompare(b.id));
  for (const post of primaries) {
    const mine = lines.filter((line) => line.assignmentId === post.id).sort((a, b) => a.since.localeCompare(b.since) || a.id - b.id);
    // A post with no line of its own is taken at the grade it holds now.
    const steps = mine.length > 0 ? mine : post.gradeCode ? [{ id: 0, assignmentId: post.id, gradeCode: post.gradeCode, acting: post.acting, since: post.startedOn }] : [];
    steps.forEach((step, index) => {
      const from = index === 0 || step.since < post.startedOn ? post.startedOn : step.since;
      const next = steps[index + 1];
      periods.push({ assignmentId: post.id, gradeCode: step.gradeCode, acting: step.acting, from, to: next ? (next.since < post.startedOn ? post.startedOn : next.since) : post.endedOn });
    });
  }
  return periods;
}

/** How long a grade is kept after leaving a post, which is the database's rule too. */
const KEPT_FOR = 30;

/**
 * Since when the member has held the grade they hold now. A move to another
 * post at the same grade, with no more than 30 days between, does not start the
 * count again. An acting grade and the same grade held in their own right are
 * counted apart.
 */
export function gradeSince(periods: GradePeriod[]): { gradeCode: string; acting: boolean; since: string } | null {
  const last = periods.findLastIndex((period) => period.to === null);
  if (last < 0) return null;
  const current = periods[last];
  let since = current.from;
  for (let index = last - 1; index >= 0; index -= 1) {
    const before = periods[index];
    if (before.gradeCode !== current.gradeCode || before.acting !== current.acting || before.to === null) break;
    if (daysBetween(before.to, since) > KEPT_FOR) break;
    since = before.from;
  }
  return { gradeCode: current.gradeCode, acting: current.acting, since };
}

export type GradeChange = {
  on: string;
  assignmentId: string;
  gradeCode: string;
  kind: "promoted" | "reduced" | "confirmed" | "made-acting";
};

/**
 * Each change of grade made while a post was held, in order. Taking up a post
 * is not one: that is the post's own line. `order` gives each grade's place on
 * the ladder.
 */
export function gradeChanges(posts: PostHeld[], lines: GradeLine[], order: Map<string, number>): GradeChange[] {
  const changes: GradeChange[] = [];
  for (const post of posts.filter((entry) => entry.kind === "primary")) {
    const mine = lines.filter((line) => line.assignmentId === post.id).sort((a, b) => a.since.localeCompare(b.since) || a.id - b.id);
    for (let index = 1; index < mine.length; index += 1) {
      const before = mine[index - 1];
      const after = mine[index];
      const moved = (order.get(after.gradeCode) ?? 0) - (order.get(before.gradeCode) ?? 0);
      const kind = moved > 0 ? "promoted" : moved < 0 ? "reduced" : before.acting && !after.acting ? "confirmed" : !before.acting && after.acting ? "made-acting" : null;
      if (kind) changes.push({ on: after.since, assignmentId: post.id, gradeCode: after.gradeCode, kind });
    }
  }
  return changes.sort((a, b) => a.on.localeCompare(b.on));
}

/** A change of status, with what it was before and how long that lasted. */
export type StatusStep = { on: string; status: RecordStatus; before: RecordStatus | null; daysBefore: number | null };

/** Each change of status in order, the first being the day the member first signed in. */
export function statusSteps(lines: StatusLine[]): StatusStep[] {
  const ordered = [...lines].sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.id - b.id);
  return ordered.map((line, index) => {
    const before = ordered[index - 1];
    return { on: line.changedOn, status: line.status, before: before?.status ?? null, daysBefore: before ? daysBetween(before.changedOn, line.changedOn) : null };
  });
}

/** What a change of status is called on the record. */
export function statusLabel(step: StatusStep): string {
  switch (step.status) {
    case "applicant":
      return step.before === null ? "First signed in" : "Sent back to applicant";
    case "recruit":
      return "Accepted as a recruit";
    case "auxiliary":
      return "Finished training: auxiliary";
    case "member":
      return step.before === "reserve" ? "Back from reserve: full member" : step.before === "discharged" ? "Reinstated: full member" : "Full member";
    case "reserve":
      return "Moved to reserve";
    case "discharged":
      return "Discharged";
  }
}

export type Activity = { in30: number; in90: number; all: number; absent: number; absentWithoutNotice90: number; last: string | null };

/** How often the member was returned present. An event counts from the time it started. */
export function activity(events: EventLine[], now: number = Date.now()): Activity {
  const present = events.filter((event) => event.returned === "present");
  const within = (list: EventLine[], days: number) => list.filter((event) => now - Date.parse(event.startsAt) <= days * DAY).length;
  const last = present.map((event) => event.startsAt).sort().at(-1) ?? null;
  return {
    in30: within(present, 30),
    in90: within(present, 90),
    all: present.length,
    absent: events.length - present.length,
    absentWithoutNotice90: within(events.filter((event) => event.returned === "absent_without_notice"), 90),
    last,
  };
}

export const returnedNames: Record<Returned, string> = {
  present: "Present",
  absent_with_notice: "Absent with notice",
  absent_without_notice: "Absent without notice",
};
