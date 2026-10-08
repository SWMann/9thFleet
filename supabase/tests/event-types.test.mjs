// Event types as records, copying an event, and the weekly repeat.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

/** Draft an event as someone, and return its id. */
const draft = async (as, fields = {}) => {
  const event = { kind: "patrol", title: "Patrol 001", starts_at: "3 days", commander_id: who.admin, ...fields };
  const names = Object.keys(event);
  const values = names.map((name, index) => (name === "starts_at" ? `now() + $${index + 1}::interval` : `$${index + 1}`));
  const row = await fleet.as(as).one(
    `insert into public.events (${names.join(", ")}) values (${values.join(", ")}) returning id`,
    Object.values(event),
  );
  return row.id;
};
const announce = (as, id) => fleet.as(as).query("update public.events set state = 'announced' where id = $1", [id]);
// Time cannot be wound on, so the database owner moves the event instead.
const start = (id) =>
  fleet.sql(
    "update public.events set starts_at = now() - interval '1 hour', announced_at = now() - interval '3 days' where id = $1",
    [id],
  );
const close = (as, id) => fleet.as(as).query("update public.events set state = 'done' where id = $1", [id]);
const followers = (id) => fleet.rows("select * from public.events where copied_from = $1", [id]);
const addType = (as, fields) => {
  const names = Object.keys(fields);
  return fleet.as(as).query(
    `insert into public.event_types (${names.join(", ")}) values (${names.map((_, index) => `$${index + 1}`).join(", ")})`,
    Object.values(fields),
  );
};

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.instructor = await fleet.person("2", "Instructor", { roles: ["instructor"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.staff = await fleet.person("4", "Staff", { roles: ["staff"] });
  who.gunner = await fleet.person("5", "Gunner");
  who.helm = await fleet.person("6", "Helm");
  who.applicant = await fleet.applicant("7", "Applicant");
});
after(() => fleet.close());

test("the roadmap's five types are there, and only training is open to instructors", async () => {
  const types = await fleet.rows("select key, name, instructors_may_draft from public.event_types order by sort_order");
  assert.deepEqual(types, [
    { key: "training", name: "Training evolution", instructors_may_draft: true },
    { key: "patrol", name: "Patrol", instructors_may_draft: false },
    { key: "response", name: "Response", instructors_may_draft: false },
    { key: "strike", name: "Strike", instructors_may_draft: false },
    { key: "tasked_pve", name: "Tasked PvE", instructors_may_draft: false },
  ]);
});

test("the serving fleet reads the event types, and nobody outside it does", async () => {
  const sees = async (actor) => (await actor.rows("select key from public.event_types")).length;
  assert.equal(await sees(fleet.as(who.gunner)), 5);
  assert.equal(await sees(fleet.as(who.applicant)), 0);
  await assert.rejects(fleet.visitor().query("select * from public.event_types"), /permission denied/);
});

test("only an admin adds, changes or removes an event type", async () => {
  const wargame = { key: "wargame", name: "Wargame" };
  for (const member of [who.command, who.staff, who.instructor, who.gunner]) {
    await assert.rejects(addType(member, wargame), /row-level security/);
    assert.equal(await fleet.as(member).changed("update public.event_types set name = 'Sortie' where key = 'patrol'"), 0);
    assert.equal(await fleet.as(member).changed("delete from public.event_types where key = 'response'"), 0);
  }
  await addType(who.admin, wargame);
  assert.equal(await fleet.as(who.admin).changed("update public.event_types set example = 'Two sides, one referee' where key = 'wargame'"), 1);
  assert.equal(await fleet.as(who.admin).changed("delete from public.event_types where key = 'wargame'"), 1);
});

test("an event type needs a tidy key, a name of its own and a sensible length", async () => {
  await assert.rejects(addType(who.admin, { key: "Night Ops", name: "Night operations" }), /check constraint/);
  await assert.rejects(addType(who.admin, { key: "patrol", name: "Another patrol" }), /duplicate key/);
  await assert.rejects(addType(who.admin, { key: "sortie", name: "Patrol" }), /duplicate key/);
  await assert.rejects(addType(who.admin, { key: "sortie", name: "Sortie", default_duration_minutes: 5 }), /check constraint/);
  await assert.rejects(addType(who.admin, { key: "sortie", name: "Sortie", mission_name: "x".repeat(61) }), /check constraint/);
});

test("a type of the fleet's own can be drafted, by command and by instructors if it is open to them", async () => {
  await addType(who.admin, { key: "boarding-drill", name: "Boarding drill", default_duration_minutes: 90, default_weapons_state: "hold" });
  const id = await draft(who.command, { kind: "boarding-drill", title: "Boarding drill 001", commander_id: who.command });
  assert.equal((await fleet.one("select kind from public.events where id = $1", [id])).kind, "boarding-drill");

  await assert.rejects(draft(who.instructor, { kind: "boarding-drill", commander_id: who.instructor }), /row-level security/);
  await fleet.as(who.admin).query("update public.event_types set instructors_may_draft = true where key = 'boarding-drill'");
  await draft(who.instructor, { kind: "boarding-drill", title: "Boarding drill 002", commander_id: who.instructor });
  await assert.rejects(draft(who.gunner, { kind: "boarding-drill" }), /row-level security/);

  // An instructor can turn a draft into another type that is open to them, and no other.
  const mine = await draft(who.instructor, { kind: "training", title: "Type change", commander_id: who.instructor });
  await fleet.as(who.instructor).query("update public.events set kind = 'boarding-drill' where id = $1", [mine]);
  await assert.rejects(
    fleet.as(who.instructor).query("update public.events set kind = 'strike' where id = $1", [mine]),
    /cannot turn this into that type/,
  );
});

test("an event cannot be of a type that does not exist, and a type with events cannot be removed", async () => {
  await assert.rejects(draft(who.command, { kind: "parade", commander_id: who.command }), /foreign key/);
  await draft(who.command, { kind: "response", title: "Response 001", commander_id: who.command });
  await assert.rejects(fleet.as(who.admin).query("delete from public.event_types where key = 'response'"), /foreign key/);
  // It can be renamed, and its events follow.
  await fleet.as(who.admin).query("update public.event_types set name = 'Quick response' where key = 'response'");
  assert.equal((await fleet.one("select count(*)::int as n from public.events where kind = 'response'")).n, 1);
});

test("a copy starts as a draft with the orders of the event it was copied from", async () => {
  const source = await draft(who.command, { title: "Strike 001", kind: "strike", commander_id: who.helm });
  await fleet.as(who.command).query(
    "update public.event_orders set warning_order = 'Strike at 1900.', mission = 'Destroy the outpost.' where event_id = $1",
    [source],
  );
  await announce(who.command, source);

  const copy = await draft(who.command, { title: "Strike 002", kind: "strike", commander_id: who.helm, copied_from: source });
  const event = await fleet.one("select state, copied_from, created_by from public.events where id = $1", [copy]);
  assert.deepEqual(event, { state: "draft", copied_from: source, created_by: who.command });
  const orders = await fleet.one("select warning_order, mission, situation, updated_by from public.event_orders where event_id = $1", [copy]);
  assert.deepEqual(orders, { warning_order: "Strike at 1900.", mission: "Destroy the outpost.", situation: "", updated_by: who.command });

  // The source's orders are its own: changing the copy's leaves them alone.
  await fleet.as(who.command).query("update public.event_orders set mission = 'Hold the outpost.' where event_id = $1", [copy]);
  assert.equal((await fleet.one("select mission from public.event_orders where event_id = $1", [source])).mission, "Destroy the outpost.");
});

test("a draft can only be copied by someone who can see it, and what an event was copied from is fixed", async () => {
  const hidden = await draft(who.command, { title: "Hidden strike", kind: "strike", commander_id: who.command });
  await fleet.as(who.command).query("update public.event_orders set mission = 'Not for instructors.' where event_id = $1", [hidden]);
  // The instructor may draft training, but cannot read command's draft, so cannot copy its orders out.
  await assert.rejects(
    draft(who.instructor, { kind: "training", title: "Borrowed", commander_id: who.instructor, copied_from: hidden }),
    /cannot copy that event/,
  );
  // Nor an event that does not exist.
  await assert.rejects(
    draft(who.instructor, { kind: "training", title: "Borrowed", commander_id: who.instructor, copied_from: "00000000-0000-4000-8000-000000000000" }),
    /cannot copy that event/,
  );

  const mine = await draft(who.instructor, { kind: "training", title: "Mine", commander_id: who.instructor });
  await assert.rejects(
    fleet.as(who.instructor).query("update public.events set copied_from = $2 where id = $1", [mine, hidden]),
    /permission denied/,
  );
  // Deleting the source leaves the copy standing.
  const source = await draft(who.instructor, { kind: "training", title: "Source", commander_id: who.instructor });
  const copy = await draft(who.instructor, { kind: "training", title: "Copy", commander_id: who.instructor, copied_from: source });
  await fleet.as(who.instructor).query("delete from public.events where id = $1", [source]);
  assert.equal((await fleet.one("select copied_from from public.events where id = $1", [copy])).copied_from, null);
});

test("closing a weekly event drafts next week's, with its details and orders, and announces nothing", async () => {
  const id = await draft(who.instructor, {
    kind: "training", title: "Training Night 009", summary: "Turret gunnery", commander_id: who.helm,
    second_id: who.gunner, duration_minutes: 90, weapons_state: "hold", repeats_weekly: true,
  });
  await fleet.as(who.instructor).query("update public.event_orders set warning_order = 'Gunnery at 1930.' where event_id = $1", [id]);
  await announce(who.instructor, id);
  assert.equal((await followers(id)).length, 0, "announcing drafts nothing");
  await start(id);
  await close(who.helm, id);

  const [next, ...others] = await followers(id);
  assert.equal(others.length, 0);
  assert.equal(next.state, "draft");
  assert.equal(next.title, "Training Night 010");
  assert.equal(next.kind, "training");
  assert.equal(next.summary, "Turret gunnery");
  assert.equal(next.duration_minutes, 90);
  assert.equal(next.weapons_state, "hold");
  assert.equal(next.commander_id, who.helm);
  assert.equal(next.second_id, who.gunner);
  assert.equal(next.repeats_weekly, true);
  assert.equal(next.created_by, who.helm, "whoever closed it drafted the next");
  assert.equal(next.announced_at, null);
  const gap = await fleet.one(
    "select (n.starts_at - e.starts_at) = interval '7 days' as a_week from public.events e, public.events n where e.id = $1 and n.id = $2",
    [id, next.id],
  );
  assert.equal(gap.a_week, true);
  assert.equal((await fleet.one("select warning_order from public.event_orders where event_id = $1", [next.id])).warning_order, "Gunnery at 1930.");

  // The fleet does not see it until someone announces it. The commander who closed the last one can.
  assert.equal((await fleet.as(who.gunner).rows("select 1 from public.events where id = $1", [next.id])).length, 0);
  await announce(who.helm, next.id);
  assert.equal((await fleet.as(who.gunner).rows("select 1 from public.events where id = $1", [next.id])).length, 1);
});

test("a weekly event cancelled after it was announced still leaves next week's draft, and a cancelled draft leaves none", async () => {
  const id = await draft(who.command, { title: "Weekly patrol", commander_id: who.command, repeats_weekly: true });
  await announce(who.command, id);
  await fleet.as(who.command).query("update public.events set state = 'cancelled' where id = $1", [id]);
  const [next] = await followers(id);
  assert.equal(next.title, "Weekly patrol", "a title with no number at its end is kept");
  assert.equal(next.state, "draft");

  const unannounced = await draft(who.command, { title: "Never ran", commander_id: who.command, repeats_weekly: true });
  await fleet.as(who.command).query("update public.events set state = 'cancelled' where id = $1", [unannounced]);
  assert.equal((await followers(unannounced)).length, 0);

  const oneOff = await draft(who.command, { title: "One night only", commander_id: who.command });
  await announce(who.command, oneOff);
  await start(oneOff);
  await close(who.command, oneOff);
  assert.equal((await followers(oneOff)).length, 0, "an event that does not repeat leaves nothing");
});

test("next week's draft is always in the future, and is not drafted twice", async () => {
  const id = await draft(who.command, { title: "Late close 041", commander_id: who.command, repeats_weekly: true });
  await announce(who.command, id);
  // Someone drafted next week's by hand, as a weekly event, before this one was closed.
  const byHand = await draft(who.command, { title: "Late close 042", commander_id: who.command, repeats_weekly: true, copied_from: id });
  await start(id);
  await close(who.command, id);
  assert.deepEqual((await followers(id)).map((event) => event.id), [byHand]);

  // Closed three weeks late, the next one is the first that has not already gone by.
  const late = await draft(who.command, { title: "Forgotten", commander_id: who.command, repeats_weekly: true });
  await announce(who.command, late);
  await fleet.sql("update public.events set starts_at = now() - interval '20 days', announced_at = now() - interval '25 days' where id = $1", [late]);
  await close(who.command, late);
  const [next] = await followers(late);
  const timing = await fleet.one(
    "select n.starts_at > now() as ahead, (n.starts_at - e.starts_at) = interval '21 days' as three_weeks from public.events e, public.events n where e.id = $1 and n.id = $2",
    [late, next.id],
  );
  assert.deepEqual(timing, { ahead: true, three_weeks: true });
});

test("an event closed from the SQL editor leaves next week's draft too", async () => {
  const id = await draft(who.command, { title: "Handover 001", commander_id: who.helm, second_id: who.gunner, repeats_weekly: true });
  await announce(who.command, id);
  await start(id);
  // The second-in-command has left the fleet since.
  await fleet.sql("update public.members set status = 'discharged' where id = $1", [who.gunner]);
  await fleet.sql("update public.events set state = 'done' where id = $1", [id]);
  const [next] = await followers(id);
  assert.equal(next.title, "Handover 002");
  assert.equal(next.commander_id, who.helm);
  assert.equal(next.second_id, null, "someone who has left is not carried over");
  assert.equal(next.created_by, who.command, "with nobody signed in, the draft is its author's");
  await fleet.sql("update public.members set status = 'member' where id = $1", [who.gunner]);
});

test("a title's number goes up by one and keeps its width", async () => {
  const next = async (title) => (await fleet.one("select app.next_title($1) as title", [title])).title;
  assert.equal(await next("Patrol 001"), "Patrol 002");
  assert.equal(await next("Patrol 099"), "Patrol 100");
  assert.equal(await next("Patrol 999"), "Patrol 1000");
  assert.equal(await next("Night 7"), "Night 8");
  assert.equal(await next("Training night"), "Training night");
  assert.equal(await next("2 Squadron drill"), "2 Squadron drill");
  // A title that would grow past 80 characters is kept as it is.
  const full = `${"x".repeat(77)}999`;
  assert.equal(await next(full), full);
});

test("event types and copies are logged", async () => {
  await addType(who.admin, { key: "logged", name: "Logged type" });
  const logged = await fleet.rows(
    "select action, actor from public.audit_log where table_name = 'event_types' and new_row ->> 'key' = 'logged'",
  );
  assert.deepEqual(logged, [{ action: "insert", actor: who.admin }]);
});
