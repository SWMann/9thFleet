// Routine orders: command drafts and issues them, the fleet reads them, and
// each member marks an issue as read for themselves.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

const BODY = "## From the Fleet Commander\n\nThe fleet sails on Saturday. Be at the gate by 1900Z.";
const draft = (actor, fields = {}) => {
  const row = { body: BODY, ...fields };
  const columns = Object.keys(row);
  return fleet.as(actor).one(
    `insert into public.routine_orders (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
};
const order = (id) => fleet.one("select * from public.routine_orders where id = $1", [id]);
const change = (actor, id, set, params = []) => fleet.as(actor).changed(`update public.routine_orders set ${set} where id = $1`, [id, ...params]);
const issue = (actor, id) => change(actor, id, "state = 'issued'");
const markRead = (actor, id, member = actor) =>
  fleet.as(actor).query("insert into public.routine_order_reads (order_id, member_id) values ($1, $2)", [id, member]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.recruit = await fleet.person("5", "Recruit", { status: "recruit" });
  who.applicant = await fleet.applicant("6", "Applicant");
  who.discharged = await fleet.person("7", "Discharged", { status: "discharged" });
});
after(() => fleet.close());
// One draft at a time, so each test starts with none.
beforeEach(() => fleet.sql("delete from public.routine_orders where state = 'draft'"));

test("command drafts an issue, and the database dates it and sets the period it covers", async () => {
  const made = await draft(who.command, { title: "The first" });
  assert.equal(made.state, "draft");
  assert.equal(made.number, null);
  assert.equal(made.issued_at, null);
  assert.equal(made.drafted_by, who.command);
  assert.ok(Date.now() - new Date(made.drafted_at).getTime() < 60_000);
  assert.ok(Date.now() - new Date(made.covers_to).getTime() < 60_000);
  // With no issue before it, the record runs from the day the fleet's record began.
  const first = await fleet.one("select min(joined_on)::text as day from public.members");
  assert.equal(new Date(made.covers_from).toISOString().slice(0, 10), first.day);
  // An admin holds every role, so may too, once this draft is gone.
  await fleet.sql("delete from public.routine_orders where id = $1", [made.id]);
  assert.equal((await draft(who.admin)).drafted_by, who.admin);
});

test("there is one draft at a time", async () => {
  await draft(who.command);
  await assert.rejects(draft(who.command), /routine_orders_one_draft/);
});

test("nobody but command drafts, and nobody but command is sent a draft", async () => {
  for (const actor of [who.member, who.staff, who.recruit, who.applicant, who.discharged]) {
    await assert.rejects(draft(actor), /row-level security|Command issues routine orders/);
  }
  const made = await draft(who.command);
  for (const actor of [who.member, who.staff, who.recruit, who.applicant, who.discharged]) {
    assert.deepEqual(await fleet.as(actor).rows("select id from public.routine_orders where id = $1", [made.id]), []);
    assert.equal(await change(actor, made.id, "body = 'Changed by someone else, which is long enough.'"), 0);
    assert.equal(await fleet.as(actor).changed("delete from public.routine_orders where id = $1", [made.id]), 0);
  }
  assert.equal((await fleet.as(who.command).rows("select id from public.routine_orders where id = $1", [made.id])).length, 1);
  await assert.rejects(fleet.visitor().query("select id from public.routine_orders"), /permission denied/);
});

test("what the database set cannot be sent or changed", async () => {
  const made = await draft(who.command);
  for (const [column, value] of [
    ["number", "7"],
    ["issued_at", new Date().toISOString()],
    ["issued_by", who.command],
    ["drafted_by", who.member],
    ["covers_from", "2020-01-01T00:00:00Z"],
    ["covers_to", "2020-01-02T00:00:00Z"],
  ]) {
    await assert.rejects(draft(who.command, { [column]: value }), /permission denied|routine_orders_one_draft/, column);
    await assert.rejects(change(who.command, made.id, `${column} = $2`, [value]), /permission denied/, column);
  }
});

test("issuing numbers the issue in order, signs it, and runs the next period on from it", async () => {
  await fleet.sql("delete from public.routine_orders");
  const one = await draft(who.command, { title: "One" });
  await fleet.sql("update public.routine_orders set covers_to = now() - interval '1 day', covers_from = now() - interval '8 days' where id = $1", [one.id]);
  assert.equal(await issue(who.command, one.id), 1);
  let issued = await order(one.id);
  assert.equal(issued.state, "issued");
  assert.equal(issued.number, 1);
  assert.equal(issued.issued_by, who.command);
  assert.ok(Date.now() - new Date(issued.issued_at).getTime() < 60_000);

  const two = await draft(who.admin, { title: "Two" });
  assert.equal(new Date(two.covers_from).toISOString(), new Date(issued.covers_to).toISOString());
  assert.equal(await issue(who.admin, two.id), 1);
  assert.equal((await order(two.id)).number, 2);

  // The fleet reads what was issued, in the state it was issued.
  for (const actor of [who.member, who.staff, who.recruit]) {
    assert.deepEqual(
      (await fleet.as(actor).rows("select number, title from public.routine_orders order by number")).map((row) => [row.number, row.title]),
      [[1, "One"], [2, "Two"]],
    );
  }
  for (const actor of [who.applicant, who.discharged]) {
    assert.deepEqual(await fleet.as(actor).rows("select id from public.routine_orders"), []);
  }
});

test("an issue needs words, and once issued it stands", async () => {
  const empty = await draft(who.command, { body: "" });
  await assert.rejects(issue(who.command, empty.id), /Write the orders before issuing them\./);
  await fleet.sql("delete from public.routine_orders where id = $1", [empty.id]);

  const made = await draft(who.command);
  assert.equal(await issue(who.command, made.id), 1);
  const was = await order(made.id);
  await assert.rejects(change(who.command, made.id, "state = 'draft'"), /An issue, once issued, stands\./);
  // Its words can be corrected. Its number, date and period cannot.
  assert.equal(await change(who.command, made.id, "body = $2, title = $3", ["Corrected: the gate is at 1930Z, not 1900Z.", "Corrected"]), 1);
  const now = await order(made.id);
  assert.equal(now.title, "Corrected");
  assert.equal(now.number, was.number);
  assert.equal(now.issued_at.toISOString(), was.issued_at.toISOString());
  assert.equal(now.covers_to.toISOString(), was.covers_to.toISOString());
  assert.ok(now.updated_at > was.updated_at);
  // An issued order is not deleted through the API.
  assert.equal(await fleet.as(who.command).changed("delete from public.routine_orders where id = $1", [made.id]), 0);
  assert.equal(await fleet.as(who.admin).changed("delete from public.routine_orders where id = $1", [made.id]), 0);
});

test("command deletes a draft, and only a draft", async () => {
  const made = await draft(who.command);
  assert.equal(await fleet.as(who.command).changed("delete from public.routine_orders where id = $1", [made.id]), 1);
  assert.equal(await order(made.id), undefined);
});

test("a serving member marks an issue as read, for themselves, once it is issued", async () => {
  const made = await draft(who.command);
  // Nobody marks a draft as read, not even command.
  await assert.rejects(markRead(who.command, made.id), /That issue has not been issued\./);
  await issue(who.command, made.id);

  await markRead(who.member, made.id);
  await markRead(who.recruit, made.id);
  await assert.rejects(markRead(who.member, made.id), /duplicate key/);
  await assert.rejects(markRead(who.member, made.id, who.staff), /row-level security|for themselves/);
  await assert.rejects(markRead(who.applicant, made.id), /row-level security|serving fleet/);
  await assert.rejects(markRead(who.discharged, made.id), /row-level security|serving fleet/);

  // A member sees their own line. Command sees everyone's.
  assert.deepEqual(
    (await fleet.as(who.member).rows("select member_id from public.routine_order_reads where order_id = $1", [made.id])).map((row) => row.member_id),
    [who.member],
  );
  assert.deepEqual(await fleet.as(who.staff).rows("select member_id from public.routine_order_reads where order_id = $1", [made.id]), []);
  assert.equal((await fleet.as(who.command).rows("select member_id from public.routine_order_reads where order_id = $1", [made.id])).length, 2);
  // The time is the database's.
  await assert.rejects(
    fleet.as(who.staff).query("insert into public.routine_order_reads (order_id, member_id, read_at) values ($1, $2, '2020-01-01')", [made.id, who.staff]),
    /permission denied/,
  );
  // Nothing is changed or taken back.
  await assert.rejects(fleet.as(who.member).query("delete from public.routine_order_reads where order_id = $1", [made.id]), /permission denied/);
  await assert.rejects(fleet.as(who.member).query("update public.routine_order_reads set read_at = now() where order_id = $1", [made.id]), /permission denied/);
});

test("deleting a member who issued an order clears their name and nothing else", async () => {
  const leaver = await fleet.person("20", "Leaver", { roles: ["command"] });
  const made = await draft(leaver);
  await issue(leaver, made.id);
  await markRead(leaver, made.id);
  const was = await order(made.id);
  await fleet.sql("delete from auth.users where id = $1", [leaver]);
  const now = await order(made.id);
  assert.equal(now.issued_by, null);
  assert.equal(now.drafted_by, null);
  assert.equal(now.number, was.number);
  assert.equal(now.body, was.body);
  assert.equal(now.state, "issued");
  assert.deepEqual(await fleet.rows("select member_id from public.routine_order_reads where member_id = $1", [leaver]), []);
});

test("every change is in the log of changes, under who made it", async () => {
  const made = await draft(who.command, { title: "Logged" });
  await issue(who.command, made.id);
  const lines = await fleet.rows(
    "select actor, action, new_row ->> 'state' as state from public.audit_log where table_name = 'routine_orders' and coalesce(new_row ->> 'id', old_row ->> 'id') = $1 order by id",
    [made.id],
  );
  assert.deepEqual(
    lines.map((line) => [line.actor, line.action, line.state]),
    [
      [who.command, "insert", "draft"],
      [who.command, "update", "issued"],
    ],
  );
});
