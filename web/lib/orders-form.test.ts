// Routine orders: the draft the site writes from the fleet's record reads as
// it should, and nothing written into it is taken for formatting.

import assert from "node:assert/strict";
import { test } from "node:test";
import { composeRoutineOrders, dayOf, mention, orderName, readOrders, sinceIssue, whenOf, words, type OrderParts } from "./orders-form";
import { plainOf, type Block } from "./rich/format";
import { parseRich } from "./rich/markdown";

const ADA = { id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "Ada Vance" };
const KIT = { id: "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "Kit *Marlow*" };

const empty: OrderParts = {
  period: { from: "2026-10-06T00:00:00Z", to: "2026-10-13T20:00:00Z" },
  appointments: [],
  grades: [],
  qualifications: [],
  statuses: [],
  held: [],
  ahead: [],
  hostiles: [],
  strength: { serving: 1, members: 1, auxiliaries: 0, recruits: 0, reserve: 0, stage: 1 },
};

const headings = (blocks: Block[]) => blocks.filter((block) => block.type === "heading").map((block) => plainOf([block]));
const mentionsIn = (blocks: Block[]): string[] =>
  blocks.flatMap((block) =>
    block.type === "paragraph" || block.type === "heading"
      ? block.children.filter((node) => node.type === "mention").map((node) => (node.type === "mention" ? node.id : ""))
      : block.type === "list"
        ? block.items.flatMap((item) => mentionsIn(item))
        : [],
  );

test("an empty week drafts every section, each saying there is nothing in it", () => {
  const blocks = parseRich(composeRoutineOrders(empty));
  assert.deepEqual(headings(blocks), [
    "From the Fleet Commander",
    "Decisions",
    "Standing orders",
    "Appointments",
    "Promotions",
    "Qualifications",
    "Joined and left",
    "Operations",
    "Hostile list",
    "Strength",
    "Notices",
  ]);
  const text = plainOf(blocks);
  assert.match(text, /This issue records 6 October 2026 to 13 October 2026\./);
  assert.match(text, /Appointments\nNone\./);
  assert.match(text, /Joined and left\nNobody\./);
  assert.match(text, /Nothing held since the last issue\./);
  assert.match(text, /Nothing announced for the fortnight ahead\./);
  assert.match(text, /1 serving: 1 full member, 0 auxiliaries, 0 recruits and 0 reservists\. Stage 1\./);
});

test("the week's record is written as lists, naming each member the way the editor does", () => {
  const blocks = parseRich(
    composeRoutineOrders({
      ...empty,
      appointments: [
        { member: ADA, post: "Helmsman", unit: "Training Ship", acting: true, on: "2026-10-10", what: "appointed" },
        { member: KIT, post: "Gunner 2", unit: "Training Ship", acting: false, on: "2026-10-11", what: "left" },
      ],
      grades: [
        { member: ADA, rank: "Able Starman", grade: "E3", acting: false, on: "2026-10-12", what: "promoted" },
        { member: KIT, rank: "Starman", grade: "E2", acting: false, on: "2026-10-12", what: "stepped down" },
      ],
      qualifications: [{ member: ADA, qualification: "Instructor", on: "2026-10-09" }],
      statuses: [
        { member: KIT, status: "recruit", on: "2026-10-08" },
        { member: ADA, status: "member", on: "2026-10-13" },
      ],
      held: [{ title: "Patrol 003", type: "Patrol", startsAt: "2026-10-11T19:00:00Z", attended: 6, href: "/operations/abc" }],
      ahead: [{ title: "Drills [night]", type: "Training evolution", startsAt: "2026-10-17T19:00:00Z", href: "/operations/def" }],
      hostiles: [
        { handle: "BLACKSUN", kind: "organisation", what: "hostile", on: "2026-10-13" },
        { handle: "Red_Raider", kind: "individual", what: "watch", on: "2026-10-12" },
        { handle: "SCRUBS", kind: "organisation", what: "lifted", on: "2026-10-12" },
      ],
      strength: { serving: 14, members: 9, auxiliaries: 3, recruits: 2, reserve: 0, stage: 2 },
    }),
  );
  const text = plainOf(blocks);
  assert.match(text, /@Ada Vance appointed Helmsman, Training Ship, acting, from 10 October 2026\./);
  assert.match(text, /@Kit \*Marlow\* left Gunner 2, Training Ship, on 11 October 2026\./);
  assert.match(text, /@Ada Vance promoted to Able Starman \(E3\) from 12 October 2026\./);
  assert.match(text, /@Kit \*Marlow\* now Starman \(E2\) from 12 October 2026\./);
  assert.match(text, /@Ada Vance awarded Instructor, 9 October 2026\./);
  assert.match(text, /@Kit \*Marlow\* joined the fleet as a recruit, 8 October 2026\./);
  assert.match(text, /@Ada Vance became a full member, 13 October 2026\./);
  assert.match(text, /Patrol 003, Patrol, 11 October 2026: 6 attended\./);
  assert.match(text, /Drills \[night\], Training evolution, Saturday 17 October, 1900Z\./);
  assert.match(text, /The organisation BLACKSUN declared hostile, 13 October 2026\./);
  assert.match(text, /Red_Raider placed on watch, 12 October 2026\./);
  assert.match(text, /The organisation SCRUBS lifted from the list, 12 October 2026\./);
  assert.match(text, /14 serving: 9 full members, 3 auxiliaries, 2 recruits and 0 reservists\. Stage 2\./);
  // Each member is a mention, so the name is kept by id. A name with marks in it is still only a name.
  assert.deepEqual(mentionsIn(blocks).sort(), [ADA.id, ADA.id, ADA.id, ADA.id, KIT.id, KIT.id, KIT.id].sort());
  // The events are links to their pages, and nothing else is.
  const linksIn = (list: Block[]): string[] =>
    list.flatMap((block) =>
      block.type === "paragraph" || block.type === "heading"
        ? block.children.filter((node) => node.type === "link").map((node) => (node.type === "link" ? node.href : ""))
        : block.type === "list"
          ? block.items.flatMap((item) => linksIn(item))
          : [],
    );
  assert.deepEqual(linksIn(blocks), ["/operations/abc", "/operations/def"]);
});

test("words written into an issue are never read as formatting", () => {
  for (const typed of ["*Not bold*", "[Not a link](https://example.com)", "# Not a heading", "`not code`", "a_b_c", "<b>no</b>", "~~no~~"]) {
    const blocks = parseRich(`Said: ${words(typed)}`);
    assert.deepEqual(blocks.map((block) => block.type), ["paragraph"]);
    assert.equal(plainOf(blocks), `Said: ${typed}`);
    assert.ok(blocks[0].type === "paragraph" && blocks[0].children.every((node) => node.type === "text"), typed);
  }
  assert.equal(mention(ADA), `[@Ada Vance](member:${ADA.id})`);
});

test("the days and times are written the fleet's way", () => {
  assert.equal(dayOf("2026-10-06"), "6 October 2026");
  assert.equal(dayOf("2026-10-13T20:15:00Z"), "13 October 2026");
  assert.equal(whenOf("2026-10-17T19:00:00Z"), "Saturday 17 October, 1900Z");
  assert.equal(whenOf("2026-10-17T00:05:00Z"), "Saturday 17 October, 0005Z");
  assert.equal(orderName(3), "Routine Orders 3");
});

test("the form's checks: a short title, and the orders within their limit", () => {
  const read = (fields: Record<string, string>) => readOrders((name) => fields[name] ?? "");
  assert.deepEqual(read({ title: "  The  first ", body: " ## Notices\n\nHello. " }), { fields: { title: "The first", body: "## Notices\n\nHello." } });
  assert.match((read({ title: "x".repeat(81), body: "" }) as { problem: string }).problem, /under 80/);
  assert.match((read({ title: "", body: "x".repeat(12001) }) as { problem: string }).problem, /12,000 characters/);
});

test("the next issue is due a week after the last", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  assert.deepEqual(sinceIssue(null, now), { days: null, due: false });
  assert.deepEqual(sinceIssue("2026-10-10T10:00:00Z", now), { days: 4, due: false });
  assert.deepEqual(sinceIssue("2026-10-07T09:00:00Z", now), { days: 7, due: true });
  assert.deepEqual(sinceIssue("2026-09-01T09:00:00Z", now), { days: 43, due: true });
});
