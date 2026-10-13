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
  lengthOf,
  statusLabel,
  statusSteps,
  type EventLine,
  type GradeLine,
  type PostHeld,
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
  assert.equal(lengthOf(0), "Under a day");
  assert.equal(lengthOf(1), "1 day");
  assert.equal(lengthOf(13), "13 days");
  assert.equal(lengthOf(14), "2 weeks");
  assert.equal(lengthOf(69), "9 weeks");
  assert.equal(lengthOf(70), "2 months");
  assert.equal(lengthOf(364), "11 months");
  assert.equal(lengthOf(366), "1 year");
  assert.equal(lengthOf(440), "1 year 2 months");
  assert.equal(lengthOf(800), "2 years 2 months");
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

test("time at a grade carries across a move to another post at the same grade", () => {
  const posts = [post("a", "2026-01-10", "2026-04-01"), post("b", "2026-04-20", null, { gradeCode: "E3" })];
  const lines = [line("a", "E2", "2026-01-10"), line("a", "E3", "2026-02-20"), line("b", "E3", "2026-04-20")];
  assert.deepEqual(gradeSince(gradePeriods(posts, lines)), { gradeCode: "E3", acting: false, since: "2026-02-20" });
});

test("more than 30 days out of a post starts the count again", () => {
  const posts = [post("a", "2026-01-10", "2026-04-01", { gradeCode: "E3" }), post("b", "2026-05-02", null, { gradeCode: "E3" })];
  const lines = [line("a", "E3", "2026-01-10"), line("b", "E3", "2026-05-02")];
  assert.deepEqual(gradeSince(gradePeriods(posts, lines)), { gradeCode: "E3", acting: false, since: "2026-05-02" });
  // Thirty days exactly still carries.
  const close = [post("a", "2026-01-10", "2026-04-01", { gradeCode: "E3" }), post("b", "2026-05-01", null, { gradeCode: "E3" })];
  assert.equal(gradeSince(gradePeriods(close, [line("a", "E3", "2026-01-10"), line("b", "E3", "2026-05-01")]))?.since, "2026-01-10");
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
  assert.deepEqual(steps.map((step) => step.daysBefore), [null, 9, 22, 7, 113, 19, 73]);
});

test("two changes on one day stay in the order they were made", () => {
  const steps = statusSteps([
    { id: 2, status: "member", changedOn: "2026-01-01" },
    { id: 1, status: "applicant", changedOn: "2026-01-01" },
  ]);
  assert.deepEqual(steps.map((step) => step.status), ["applicant", "member"]);
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
