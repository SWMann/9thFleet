import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activity,
  currentPost,
  daysBetween,
  gradeChanges,
  gradePeriods,
  gradeSince,
  latestFirst,
  lengthBetween,
  statusLabel,
  statusSteps,
  type EventLine,
  type GradeLine,
  type PostHeld,
  dutyTermEnds,
} from "./record";

const post = (id: string, startedOn: string, endedOn: string | null, more: Partial<PostHeld> = {}): PostHeld => ({
  id,
  title: `Post ${id}`,
  unit: "Training Ship",
  kind: "primary",
  acting: false,
  gradeCode: "E2",
  startedOn,
  endedOn,
  ...more,
});
let nextLine = 1;
const line = (assignmentId: string, gradeCode: string, since: string, acting = false): GradeLine => ({ id: nextLine++, assignmentId, gradeCode, acting, since });
const order = new Map([
  ["E1", 1],
  ["E2", 2],
  ["E3", 3],
  ["E4", 4],
  ["O1", 11],
  ["O2", 12],
]);

test("days are counted between two days, and never below nothing", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-01"), 0);
  assert.equal(daysBetween("2026-10-01", "2026-10-13"), 12);
  assert.equal(daysBetween("2026-02-27", "2026-03-01"), 2);
  assert.equal(daysBetween("2026-10-13", "2026-10-01"), 0);
});

test("a length of time is given in the largest unit that fits", () => {
  assert.equal(lengthBetween("2026-10-13", "2026-10-13"), "Under a day");
  assert.equal(lengthBetween("2026-10-12", "2026-10-13"), "1 day");
  assert.equal(lengthBetween("2026-09-30", "2026-10-13"), "13 days");
  assert.equal(lengthBetween("2026-09-29", "2026-10-13"), "2 weeks");
  assert.equal(lengthBetween("2026-08-05", "2026-10-13"), "9 weeks");
  assert.equal(lengthBetween("2026-08-04", "2026-10-13"), "2 months");
});

test("months and years are counted on the calendar, so a year to the day is a year", () => {
  assert.equal(lengthBetween("2026-01-01", "2026-04-01"), "3 months");
  assert.equal(lengthBetween("2026-01-13", "2026-07-13"), "6 months");
  assert.equal(lengthBetween("2026-01-13", "2026-07-12"), "5 months");
  assert.equal(lengthBetween("2025-10-14", "2026-10-13"), "11 months");
  assert.equal(lengthBetween("2025-10-13", "2026-10-13"), "1 year");
  assert.equal(lengthBetween("2024-10-13", "2026-10-13"), "2 years");
  assert.equal(lengthBetween("2025-08-10", "2026-10-13"), "1 year 2 months");
  // Leaving on the last day of a shorter month does not lose the month before it.
  assert.equal(lengthBetween("2026-01-31", "2026-04-30"), "2 months");
});

test("posts are listed latest first, and the one held now is found", () => {
  const posts = [post("a", "2026-01-01", "2026-03-01"), post("b", "2026-03-01", null), post("d", "2026-05-01", null, { kind: "duty", gradeCode: null })];
  assert.deepEqual(latestFirst(posts).map((entry) => entry.id), ["d", "b", "a"]);
  assert.equal(currentPost(posts)?.id, "b");
  assert.equal(currentPost([posts[0], posts[2]]), null);
});

test("a post's first stretch starts with the post, and each change of grade starts another", () => {
  const posts = [post("a", "2026-01-10", "2026-04-01"), post("b", "2026-04-05", null, { gradeCode: "E4" })];
  const lines = [line("a", "E2", "2026-01-10"), line("a", "E3", "2026-02-20"), line("b", "E3", "2026-04-05"), line("b", "E4", "2026-06-01")];
  assert.deepEqual(gradePeriods(posts, lines), [
    { assignmentId: "a", gradeCode: "E2", acting: false, from: "2026-01-10", to: "2026-02-20" },
    { assignmentId: "a", gradeCode: "E3", acting: false, from: "2026-02-20", to: "2026-04-01" },
    { assignmentId: "b", gradeCode: "E3", acting: false, from: "2026-04-05", to: "2026-06-01" },
    { assignmentId: "b", gradeCode: "E4", acting: false, from: "2026-06-01", to: null },
  ]);
});

test("a post whose first line is dated otherwise still starts the day the post did", () => {
  // The line was written when the post was recorded. The post's own start is what counts.
  const periods = gradePeriods([post("a", "2026-01-10", null)], [line("a", "E2", "2026-03-01")]);
  assert.deepEqual(periods, [{ assignmentId: "a", gradeCode: "E2", acting: false, from: "2026-01-10", to: null }]);
});

test("a post with no line of its own is taken at the grade it holds", () => {
  assert.deepEqual(gradePeriods([post("a", "2026-01-10", null, { gradeCode: "E3" })], []), [
    { assignmentId: "a", gradeCode: "E3", acting: false, from: "2026-01-10", to: null },
  ]);
  // A duty carries no grade and makes no stretch.
  assert.deepEqual(gradePeriods([post("d", "2026-01-10", null, { kind: "duty", gradeCode: null })], []), []);
});

test("a line dated out of step is taken in the order it was written", () => {
  // The second line was written later and dated a day earlier. The grade held now is the later line's.
  const posts = [post("a", "2026-10-01", null, { gradeCode: "E3" })];
  const lines = [line("a", "E2", "2026-10-01"), line("a", "E2", "2026-10-14", true), line("a", "E3", "2026-10-13")];
  const periods = gradePeriods(posts, lines);
  assert.deepEqual(periods.map((period) => [period.gradeCode, period.acting, period.from, period.to]), [
    ["E2", false, "2026-10-01", "2026-10-14"],
    ["E2", true, "2026-10-14", "2026-10-14"],
    ["E3", false, "2026-10-14", null],
  ]);
  assert.deepEqual(gradeSince(periods), { gradeCode: "E3", acting: false, since: "2026-10-14" });
  assert.deepEqual(gradeChanges(posts, lines, order).map((change) => [change.on, change.kind, change.gradeCode]), [
    ["2026-10-14", "made-acting", "E2"],
    ["2026-10-14", "promoted", "E3"],
  ]);
});

test("a line dated after its post was left is kept inside the post", () => {
  const posts = [post("a", "2026-01-10", "2026-04-01", { gradeCode: "E3" }), post("b", "2026-04-05", null, { gradeCode: "E3" })];
  const lines = [line("a", "E2", "2026-01-10"), line("a", "E3", "2026-10-13"), line("b", "E3", "2026-04-05")];
  const periods = gradePeriods(posts, lines);
  assert.deepEqual(periods[1], { assignmentId: "a", gradeCode: "E3", acting: false, from: "2026-04-01", to: "2026-04-01" });
  // The rank held now is counted from the post held now, not from the day history was put right.
  assert.equal(gradeSince(periods)?.since, "2026-04-01");
  assert.deepEqual(gradeChanges(posts, lines, order).map((change) => change.on), ["2026-04-01"]);
});

test("two posts taken up on one day are taken in the order they were held", () => {
  // Moved the same day: the post that was left comes first, whichever id sorts first.
  for (const [left, held] of [["a", "b"], ["z", "b"]]) {
    const posts = [post(held, "2026-03-02", null, { gradeCode: "E3" }), post(left, "2026-03-02", "2026-03-02", { gradeCode: "E3" }), post("0", "2026-01-01", "2026-03-02", { gradeCode: "E3" })];
    const lines = [line("0", "E3", "2026-01-01"), line(left, "E3", "2026-03-02"), line(held, "E3", "2026-03-02")];
    assert.equal(gradeSince(gradePeriods(posts, lines))?.since, "2026-01-01", `${left} then ${held}`);
    assert.deepEqual(latestFirst(posts).map((entry) => entry.id), [held, left, "0"]);
  }
});

test("time at a grade carries across a move to another post at the same grade", () => {
  const posts = [post("a", "2026-01-10", "2026-04-01"), post("b", "2026-04-20", null, { gradeCode: "E3" })];
  const lines = [line("a", "E2", "2026-01-10"), line("a", "E3", "2026-02-20"), line("b", "E3", "2026-04-20")];
  assert.deepEqual(gradeSince(gradePeriods(posts, lines)), { gradeCode: "E3", acting: false, since: "2026-02-20" });
});

test("thirty days out of a post starts the count again, as the database stops keeping the grade", () => {
  const sinceWhen = (taken: string) => {
    const posts = [post("a", "2026-01-10", "2026-04-01", { gradeCode: "E3" }), post("b", taken, null, { gradeCode: "E3" })];
    return gradeSince(gradePeriods(posts, [line("a", "E3", "2026-01-10"), line("b", "E3", taken)]))?.since;
  };
  assert.equal(sinceWhen("2026-05-02"), "2026-05-02", "31 days");
  assert.equal(sinceWhen("2026-05-01"), "2026-05-01", "30 days");
  assert.equal(sinceWhen("2026-04-30"), "2026-01-10", "29 days");
});

test("an acting grade is not kept between posts", () => {
  const posts = [post("a", "2026-01-10", "2026-04-01", { gradeCode: "O2", acting: true }), post("b", "2026-04-03", null, { gradeCode: "O2", acting: true })];
  const lines = [line("a", "O2", "2026-01-10", true), line("b", "O2", "2026-04-03", true)];
  assert.deepEqual(gradeSince(gradePeriods(posts, lines)), { gradeCode: "O2", acting: true, since: "2026-04-03" });
});

test("an acting grade and the same grade held outright are counted apart", () => {
  const posts = [post("a", "2026-01-10", null, { gradeCode: "O2" })];
  const lines = [line("a", "O2", "2026-01-10", true), line("a", "O2", "2026-03-01", false)];
  assert.deepEqual(gradeSince(gradePeriods(posts, lines)), { gradeCode: "O2", acting: false, since: "2026-03-01" });
});

test("someone who holds no post has no time at a grade", () => {
  assert.equal(gradeSince(gradePeriods([post("a", "2026-01-10", "2026-04-01")], [line("a", "E2", "2026-01-10")])), null);
  assert.equal(gradeSince([]), null);
});

test("each change of grade in a post is named for what it was", () => {
  const posts = [post("a", "2026-01-10", null, { gradeCode: "O2" })];
  const lines = [
    line("a", "E2", "2026-01-10"),
    line("a", "E3", "2026-02-01"),
    line("a", "E2", "2026-03-01"),
    line("a", "E2", "2026-04-01", true),
    line("a", "E2", "2026-05-01", false),
  ];
  assert.deepEqual(
    gradeChanges(posts, lines, order).map((change) => [change.on, change.kind, change.gradeCode]),
    [
      ["2026-02-01", "promoted", "E3"],
      ["2026-03-01", "reduced", "E2"],
      ["2026-04-01", "made-acting", "E2"],
      ["2026-05-01", "confirmed", "E2"],
    ],
  );
  // Taking up a post is not a change of grade.
  assert.deepEqual(gradeChanges(posts, [line("a", "E2", "2026-01-10")], order), []);
});

test("a promotion to an acting grade says that the new grade is acting", () => {
  const posts = [post("a", "2026-01-10", null, { gradeCode: "E4", acting: true })];
  const changes = gradeChanges(posts, [line("a", "E3", "2026-01-10"), line("a", "E4", "2026-02-01", true)], order);
  assert.deepEqual(changes.map((change) => [change.kind, change.gradeCode, change.acting]), [["promoted", "E4", true]]);
});

test("each change of status says what it was and how long the last one lasted", () => {
  const steps = statusSteps([
    { id: 3, status: "auxiliary", changedOn: "2026-02-01" },
    { id: 1, status: "applicant", changedOn: "2026-01-01" },
    { id: 2, status: "recruit", changedOn: "2026-01-10" },
    { id: 4, status: "member", changedOn: "2026-02-08" },
    { id: 5, status: "reserve", changedOn: "2026-06-01" },
    { id: 6, status: "member", changedOn: "2026-06-20" },
    { id: 7, status: "discharged", changedOn: "2026-09-01" },
  ]);
  assert.deepEqual(steps.map(statusLabel), [
    "First signed in",
    "Accepted as a recruit",
    "Finished training: auxiliary",
    "Full member",
    "Moved to reserve",
    "Back from reserve: full member",
    "Discharged",
  ]);
  assert.deepEqual(steps.map((step) => step.beforeSince), [null, "2026-01-01", "2026-01-10", "2026-02-01", "2026-02-08", "2026-06-01", "2026-06-20"]);
});

test("changes of status stay in the order they were made, whatever day each is dated", () => {
  const sameDay = statusSteps([
    { id: 2, status: "member", changedOn: "2026-01-01" },
    { id: 1, status: "applicant", changedOn: "2026-01-01" },
  ]);
  assert.deepEqual(sameDay.map((step) => step.status), ["applicant", "member"]);
  // Written second and dated a day earlier: it still comes second, and is not shown before the first.
  const outOfStep = statusSteps([
    { id: 1, status: "applicant", changedOn: "2026-01-02" },
    { id: 2, status: "recruit", changedOn: "2026-01-01" },
  ]);
  assert.deepEqual(outOfStep.map((step) => [step.status, step.on]), [["applicant", "2026-01-02"], ["recruit", "2026-01-02"]]);
});

test("a step back, a return and a reinstatement are each named for what they are", () => {
  const label = (before: Parameters<typeof statusLabel>[0]["before"], status: Parameters<typeof statusLabel>[0]["status"]) =>
    statusLabel({ id: 1, on: "2026-01-01", status, before, beforeSince: before ? "2026-01-01" : null });
  assert.equal(label("member", "auxiliary"), "Moved back to auxiliary");
  assert.equal(label("member", "recruit"), "Moved back to recruit");
  assert.equal(label("auxiliary", "recruit"), "Moved back to recruit");
  assert.equal(label("recruit", "applicant"), "Sent back to applicant");
  assert.equal(label("reserve", "auxiliary"), "Back from reserve: auxiliary");
  assert.equal(label("discharged", "recruit"), "Reinstated: recruit");
  assert.equal(label("discharged", "member"), "Reinstated: full member");
  assert.equal(label("discharged", "reserve"), "Reinstated, to reserve");
  // The founder is made a full member as they sign in, and staff may skip a step.
  assert.equal(label("applicant", "member"), "Full member");
  assert.equal(label("applicant", "auxiliary"), "Auxiliary");
  assert.equal(label("member", "discharged"), "Discharged");
  assert.equal(label("member", "reserve"), "Moved to reserve");
});

test("activity counts the events a member was returned present at", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const event = (id: string, startsAt: string, returned: EventLine["returned"]): EventLine => ({ id, title: id, startsAt, type: "Patrol", returned });
  const events = [
    event("a", "2026-10-10T19:00:00Z", "present"),
    event("b", "2026-09-20T19:00:00Z", "present"),
    event("c", "2026-08-01T19:00:00Z", "present"),
    event("d", "2026-05-01T19:00:00Z", "present"),
    event("e", "2026-10-01T19:00:00Z", "absent_without_notice"),
    event("f", "2026-10-02T19:00:00Z", "absent_with_notice"),
    event("g", "2026-01-02T19:00:00Z", "absent_without_notice"),
  ];
  assert.deepEqual(activity(events, now), { in30: 2, in90: 3, all: 4, absent: 3, absentWithoutNotice90: 1, last: "2026-10-10T19:00:00Z" });
  assert.deepEqual(activity([], now), { in30: 0, in90: 0, all: 0, absent: 0, absentWithoutNotice90: 0, last: null });
});

test("a secondary duty's term runs three calendar months, and from the end of a month ends in a month that has that day", () => {
  assert.equal(dutyTermEnds({ startedOn: "2026-08-01", renewedOn: null }), "2026-11-01");
  assert.equal(dutyTermEnds({ startedOn: "2026-08-01", renewedOn: "2026-10-19" }), "2027-01-19");
  assert.equal(dutyTermEnds({ startedOn: "2026-11-30", renewedOn: null }), "2027-02-28");
  assert.equal(dutyTermEnds({ startedOn: "2026-08-31", renewedOn: null }), "2026-11-30");
  assert.equal(dutyTermEnds({ startedOn: "2026-01-31", renewedOn: null }), "2026-04-30");
});
