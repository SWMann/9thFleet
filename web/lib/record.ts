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
  /** For a duty: the day it was last renewed. Its term runs three months from that day, or from the day it began. */
  renewedOn?: string | null;
};

/** How long a secondary duty's term runs, per Volume 2. */
export const DUTY_TERM_MONTHS = 3;

/** The day a duty's current term ends. */
export function dutyTermEnds(post: Pick<PostHeld, "startedOn" | "renewedOn">): string {
  const from = new Date(`${(post.renewedOn ?? post.startedOn).slice(0, 10)}T00:00:00Z`);
  const day = from.getUTCDate();
  from.setUTCMonth(from.getUTCMonth() + DUTY_TERM_MONTHS);
  // A term from the 31st ends on the last day the month has, as the calendar counts it, not in the month after.
  if (from.getUTCDate() !== day) from.setUTCDate(0);
  return from.toISOString().slice(0, 10);
}

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

/**
 * The time from one day to another, in the largest unit that fits: 6 days,
 * 3 weeks, 5 months, 1 year 2 months. Months and years are counted on the
 * calendar, so a year to the day is 1 year and not 11 months.
 */
export function lengthBetween(from: string, to: string): string {
  const days = daysBetween(from, to);
  if (days < 1) return "Under a day";
  if (days < 14) return count(days, "day", "days");
  if (days < 70) return count(Math.floor(days / 7), "week", "weeks");
  const [fromYear, fromMonth, fromDay] = from.slice(0, 10).split("-").map(Number);
  const [toYear, toMonth, toDay] = to.slice(0, 10).split("-").map(Number);
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth) - (toDay < fromDay ? 1 : 0);
  if (months < 12) return count(months, "month", "months");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? count(years, "year", "years") : `${count(years, "year", "years")} ${count(rest, "month", "months")}`;
}

/** The order posts were held in: by the day each was taken up, and of two taken up on one day, the one that was left first. */
const inOrderHeld = (a: PostHeld, b: PostHeld) =>
  a.startedOn.localeCompare(b.startedOn) || (a.endedOn ?? "9999-12-31").localeCompare(b.endedOn ?? "9999-12-31") || a.id.localeCompare(b.id);

/** Posts with the latest first. */
export function latestFirst<Post extends PostHeld>(posts: Post[]): Post[] {
  return [...posts].sort(inOrderHeld).reverse();
}

/** The primary post held now, if there is one. */
export const currentPost = (posts: PostHeld[]) => posts.find((post) => post.kind === "primary" && post.endedOn === null) ?? null;

/** A stretch of time at one grade, in one post. */
export type GradePeriod = { assignmentId: string; gradeCode: string; acting: boolean; from: string; to: string | null };

/** A post's own lines, in the order the database wrote them. That order is the truth, whatever day each is dated. */
const linesOf = (post: PostHeld, lines: GradeLine[]) => lines.filter((line) => line.assignmentId === post.id).sort((a, b) => a.id - b.id);

/**
 * Every stretch at a grade, in order. A post's first stretch starts the day the
 * post did. Each later one starts the day the grade changed, and the last runs
 * until the post was left, or is still running. No stretch starts before the
 * one before it, or outside the days the post was held.
 */
export function gradePeriods(posts: PostHeld[], lines: GradeLine[]): GradePeriod[] {
  const periods: GradePeriod[] = [];
  for (const post of posts.filter((entry) => entry.kind === "primary").sort(inOrderHeld)) {
    const mine = linesOf(post, lines);
    // A post with no line of its own is taken at the grade it holds now.
    const steps = mine.length > 0 ? mine : post.gradeCode ? [{ id: 0, assignmentId: post.id, gradeCode: post.gradeCode, acting: post.acting, since: post.startedOn }] : [];
    const starts: string[] = [];
    steps.forEach((step, index) => {
      const earliest = index === 0 ? post.startedOn : starts[index - 1];
      let from = index === 0 || step.since < earliest ? earliest : step.since;
      if (post.endedOn && from > post.endedOn) from = post.endedOn;
      starts.push(from);
    });
    steps.forEach((step, index) => {
      periods.push({ assignmentId: post.id, gradeCode: step.gradeCode, acting: step.acting, from: starts[index], to: index + 1 < steps.length ? starts[index + 1] : post.endedOn });
    });
  }
  return periods;
}

/** How many days a grade is kept after leaving a post. The database keeps it while fewer than this have passed. */
const KEPT_FOR = 30;

/**
 * Since when the member has held the grade they hold now. A move to another
 * post at the same grade, fewer than 30 days after leaving the last, does not
 * start the count again, because the database keeps the grade that long. An
 * acting grade is not kept between posts, and it and the same grade held
 * outright are counted apart.
 */
export function gradeSince(periods: GradePeriod[]): { gradeCode: string; acting: boolean; since: string } | null {
  const last = periods.findLastIndex((period) => period.to === null);
  if (last < 0) return null;
  const current = periods[last];
  let since = current.from;
  for (let index = last - 1; index >= 0; index -= 1) {
    const before = periods[index];
    const after = periods[index + 1];
    if (before.gradeCode !== current.gradeCode || before.acting !== current.acting || before.to === null) break;
    if (before.assignmentId !== after.assignmentId && (current.acting || daysBetween(before.to, since) >= KEPT_FOR)) break;
    since = before.from;
  }
  return { gradeCode: current.gradeCode, acting: current.acting, since };
}

export type GradeChange = {
  /** The line the database wrote for it. */
  id: number;
  on: string;
  assignmentId: string;
  gradeCode: string;
  /** Whether the grade is an acting one after the change. */
  acting: boolean;
  kind: "promoted" | "reduced" | "confirmed" | "made-acting";
};

/**
 * Each change of grade made while a post was held, in order. Taking up a post
 * is not one: that is the post's own line. `order` gives each grade's place on
 * the ladder.
 */
export function gradeChanges(posts: PostHeld[], lines: GradeLine[], order: Map<string, number>): GradeChange[] {
  const periods = gradePeriods(posts, lines);
  const changes: GradeChange[] = [];
  for (const post of posts.filter((entry) => entry.kind === "primary").sort(inOrderHeld)) {
    const mine = linesOf(post, lines);
    // The days are the stretches' own, so a change is never dated outside its post or before the one before it.
    const starts = periods.filter((period) => period.assignmentId === post.id).map((period) => period.from);
    for (let index = 1; index < mine.length; index += 1) {
      const before = mine[index - 1];
      const after = mine[index];
      const moved = (order.get(after.gradeCode) ?? 0) - (order.get(before.gradeCode) ?? 0);
      const kind = moved > 0 ? "promoted" : moved < 0 ? "reduced" : before.acting && !after.acting ? "confirmed" : !before.acting && after.acting ? "made-acting" : null;
      if (kind) changes.push({ id: after.id, on: starts[index] ?? after.since, assignmentId: post.id, gradeCode: after.gradeCode, acting: after.acting, kind });
    }
  }
  return changes.sort((a, b) => a.on.localeCompare(b.on) || a.id - b.id);
}

/** A change of status, with what it was before and the day that began. */
export type StatusStep = { id: number; on: string; status: RecordStatus; before: RecordStatus | null; beforeSince: string | null };

/**
 * Each change of status in the order it was made, the first being the day the
 * member first signed in. The order is the database's, whatever day each is
 * dated, and no change is shown before the one it followed.
 */
export function statusSteps(lines: StatusLine[]): StatusStep[] {
  const ordered = [...lines].sort((a, b) => a.id - b.id);
  const days: string[] = [];
  ordered.forEach((line, index) => days.push(index > 0 && line.changedOn < days[index - 1] ? days[index - 1] : line.changedOn));
  return ordered.map((line, index) => ({
    id: line.id,
    on: days[index],
    status: line.status,
    before: ordered[index - 1]?.status ?? null,
    beforeSince: index > 0 ? days[index - 1] : null,
  }));
}

const statusNames: Record<RecordStatus, string> = {
  applicant: "applicant",
  recruit: "recruit",
  auxiliary: "auxiliary",
  member: "full member",
  reserve: "reserve",
  discharged: "discharged",
};
/** The way in: each step is further on than the one before. */
const ROUTE: RecordStatus[] = ["applicant", "recruit", "auxiliary", "member"];

/** What a change of status is called on the record. Staff can move a member either way, so a step back is named as one. */
export function statusLabel(step: StatusStep): string {
  const { status, before } = step;
  if (status === "discharged") return "Discharged";
  if (status === "applicant") return before === null ? "First signed in" : "Sent back to applicant";
  if (before === "discharged") return status === "reserve" ? "Reinstated, to reserve" : `Reinstated: ${statusNames[status]}`;
  if (status === "reserve") return "Moved to reserve";
  if (before === "reserve") return `Back from reserve: ${statusNames[status]}`;
  if (before !== null && ROUTE.indexOf(before) > ROUTE.indexOf(status)) return `Moved back to ${statusNames[status]}`;
  if (status === "recruit") return "Accepted as a recruit";
  if (status === "auxiliary") return before === "recruit" ? "Finished training: auxiliary" : "Auxiliary";
  return "Full member";
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
