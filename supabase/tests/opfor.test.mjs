// Command's approval of a draft, and an event's opposing force.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

const draft = async (fields = {}, as = who.command) => {
  const event = { kind: "training", title: "Wargame 001", starts_at: "3 days", commander_id: who.helm, ...fields };
  const names = Object.keys(event);
  const values = names.map((name, index) => (name === "starts_at" ? `now() + $${index + 1}::interval` : `$${index + 1}`));
  const row = await fleet.as(as).one(
    `insert into public.events (${names.join(", ")}) values (${values.join(", ")}) returning id`,
    Object.values(event),
  );
  return row.id;
};
const set = (as, id, fields) => {
  const names = Object.keys(fields);
  return fleet.as(as).query(
    `update public.events set ${names.map((name, index) => `${name} = $${index + 2}`).join(", ")} where id = $1`,
    [id, ...Object.values(fields)],
  );
};
const announce = (id, as = who.command) => set(as, id, { state: "announced" });
const start = (id) =>
  fleet.sql(
    "update public.events set starts_at = now() - interval '1 hour', announced_at = now() - interval '3 days' where id = $1",
    [id],
  );
const reply = (member, id, answer = "attending") =>
  fleet.as(member).query(
    `insert into public.attendance (event_id, member_id, reply) values ($1, $2, $3)
     on conflict (event_id, member_id) do update set reply = excluded.reply`,
    [id, member, answer],
  );
const name = (as, id, member, leads = false) =>
  fleet.as(as).query("insert into public.event_opfor_members (event_id, member_id, leads) values ($1, $2, $3)", [id, member, leads]);
const plan = (as, id, text) =>
  fleet.as(as).query(
    "insert into public.event_opfor (event_id, plan) values ($1, $2) on conflict (event_id) do update set plan = excluded.plan",
    [id, text],
  );
const approval = async (id) => fleet.one("select approval, approved_by, approved_at is not null as dated from public.events where id = $1", [id]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.command = await fleet.person("2", "Command", { roles: ["command"] });
  who.instructor = await fleet.person("3", "Instructor", { roles: ["instructor"] });
  who.helm = await fleet.person("4", "Helm");
  who.gunner = await fleet.person("5", "Gunner");
  who.spare = await fleet.person("6", "Spare");
  who.raider = await fleet.person("7", "Raider");
  who.applicant = await fleet.applicant("8", "Applicant");
});
after(() => fleet.close());

test("no type of event needs approval until an admin says so", async () => {
  const types = await fleet.rows("select key, needs_approval from public.event_types where needs_approval");
  assert.deepEqual(types, []);
  const id = await draft({ commander_id: who.instructor }, who.instructor);
  await announce(id, who.instructor);
  assert.equal((await fleet.one("select state from public.events where id = $1", [id])).state, "announced");
});

test("a type that needs approval is not announced without it, except by command", async () => {
  await fleet.as(who.admin).query("update public.event_types set needs_approval = true where key = 'training'");
  const id = await draft({ commander_id: who.instructor, title: "Course 001" }, who.instructor);
  assert.deepEqual(await approval(id), { approval: "not_asked", approved_by: null, dated: false });
  await assert.rejects(announce(id, who.instructor), /needs command's approval/);

  // Whoever is drafting asks. Only command gives it, and the database signs and dates it.
  await set(who.instructor, id, { approval: "asked" });
  await assert.rejects(set(who.instructor, id, { approval: "approved" }), /Only command approves/);
  await assert.rejects(announce(id, who.instructor), /needs command's approval/);
  await set(who.command, id, { approval: "approved" });
  assert.deepEqual(await approval(id), { approval: "approved", approved_by: who.command, dated: true });
  await assert.rejects(set(who.instructor, id, { approved_by: who.instructor }), /permission denied/);
  await announce(id, who.instructor);

  // Command announces a draft of its own, or anyone's, without asking anyone.
  const own = await draft({ title: "Course 002" });
  await announce(own);
  const theirs = await draft({ commander_id: who.instructor, title: "Course 003" }, who.instructor);
  await announce(theirs, who.command);
});

test("approval cannot be given by the one asking, set from the start, or taken back by anyone but command", async () => {
  await assert.rejects(
    fleet.as(who.instructor).query(
      "insert into public.events (kind, title, starts_at, commander_id, approval) values ('training', 'Forged', now() + interval '3 days', $1, 'approved')",
      [who.instructor],
    ),
    /permission denied/,
  );
  const id = await draft({ commander_id: who.instructor, title: "Course 010" }, who.instructor);
  await set(who.instructor, id, { approval: "asked" });
  await set(who.instructor, id, { approval: "not_asked" });
  await set(who.instructor, id, { approval: "asked" });
  await set(who.command, id, { approval: "approved" });
  await assert.rejects(set(who.instructor, id, { approval: "asked" }), /Only command takes that back/);
  await set(who.command, id, { approval: "not_asked" });
  assert.deepEqual(await approval(id), { approval: "not_asked", approved_by: null, dated: false });

  // Once it is announced there is nothing left to approve.
  await set(who.command, id, { approval: "approved" });
  await announce(id, who.instructor);
  await assert.rejects(set(who.command, id, { approval: "not_asked" }), /Approval is for a draft/);
});

test("turning an approved draft into another type takes the approval away", async () => {
  await fleet.as(who.admin).query(
    "insert into public.event_types (key, name, instructors_may_draft, needs_approval) values ('range-day', 'Range day', true, true)",
  );
  const id = await draft({ commander_id: who.instructor, title: "Course 020" }, who.instructor);
  await set(who.command, id, { approval: "approved" });
  await set(who.instructor, id, { kind: "range-day" });
  assert.deepEqual(await approval(id), { approval: "not_asked", approved_by: null, dated: false });
  await assert.rejects(announce(id, who.instructor), /needs command's approval/);
});

test("next week's draft of a weekly event needs approval like any other", async () => {
  const id = await draft({ title: "Weekly drill 001", repeats_weekly: true });
  await announce(id);
  await start(id);
  await set(who.helm, id, { state: "done" });
  const next = await fleet.one("select id, approval, created_by from public.events where copied_from = $1", [id]);
  assert.equal(next.approval, "not_asked");
  assert.equal(next.created_by, who.helm);
  await assert.rejects(announce(next.id, who.helm), /needs command's approval/);
  await set(who.command, next.id, { approval: "approved" });
  await announce(next.id, who.helm);
  await fleet.as(who.admin).query("update public.event_types set needs_approval = false where key = 'training'");
});

test("a visitor is refused the opposing force, and an applicant sees none of it", async () => {
  const id = await draft();
  await plan(who.command, id, "Ambush at the second waypoint.");
  await name(who.command, id, who.raider);
  for (const table of ["event_opfor", "event_opfor_members"]) {
    await assert.rejects(fleet.visitor().query(`select * from public.${table}`), /permission denied/, table);
    assert.equal((await fleet.as(who.applicant).rows(`select * from public.${table}`)).length, 0, table);
  }
});

test("command sets up the opposing force, and nobody on the other side can see it", async () => {
  // The instructor drafts the exercise and the helm commands it. Neither is command.
  const id = await draft({ commander_id: who.helm, second_id: who.gunner, title: "Wargame 010" }, who.instructor);
  for (const member of [who.instructor, who.helm, who.gunner, who.spare]) {
    await assert.rejects(name(member, id, who.raider), /row-level security/);
    await assert.rejects(plan(member, id, "A plan of my own."), /row-level security/);
  }
  await plan(who.command, id, "Ambush at the second waypoint.");
  await name(who.command, id, who.raider, true);
  await name(who.command, id, who.spare);
  await announce(id);

  const sees = async (member) => ({
    plan: (await fleet.as(member).rows("select plan from public.event_opfor where event_id = $1", [id])).length,
    roll: (await fleet.as(member).rows("select member_id from public.event_opfor_members where event_id = $1", [id])).length,
  });
  assert.deepEqual(await sees(who.command), { plan: 1, roll: 2 }, "command");
  assert.deepEqual(await sees(who.admin), { plan: 1, roll: 2 }, "an admin");
  assert.deepEqual(await sees(who.raider), { plan: 1, roll: 2 }, "whoever leads it");
  assert.deepEqual(await sees(who.spare), { plan: 1, roll: 2 }, "a member of it");
  assert.deepEqual(await sees(who.helm), { plan: 0, roll: 0 }, "the event's commander");
  assert.deepEqual(await sees(who.gunner), { plan: 0, roll: 0 }, "its second-in-command");
  assert.deepEqual(await sees(who.instructor), { plan: 0, roll: 0 }, "its author");

  // Whoever leads it writes its plan. Another member of it reads it and does not.
  await plan(who.raider, id, "Ambush at the third waypoint instead.");
  const written = await fleet.one("select plan, updated_by from public.event_opfor where event_id = $1", [id]);
  assert.deepEqual(written, { plan: "Ambush at the third waypoint instead.", updated_by: who.raider });
  assert.equal(await fleet.as(who.spare).changed("update public.event_opfor set plan = 'Mine now.' where event_id = $1", [id]), 0);
  // Who is on it is command's to say, and not its leader's.
  await assert.rejects(name(who.raider, id, who.instructor), /row-level security/);
  assert.equal(await fleet.as(who.raider).changed("delete from public.event_opfor_members where event_id = $1 and member_id = $2", [id, who.spare]), 0);
});

test("the opposing force is made up of serving members who are not running the event", async () => {
  const id = await draft({ commander_id: who.helm, second_id: who.gunner });
  await assert.rejects(name(who.command, id, who.helm), /not on its opposing force/);
  await assert.rejects(name(who.command, id, who.gunner), /not on its opposing force/);
  await assert.rejects(name(who.command, id, who.applicant), /serving members/);
  await name(who.command, id, who.raider);
  await assert.rejects(name(who.command, id, who.raider), /duplicate key/);
  const named = await fleet.one("select added_by, added_at is not null as dated from public.event_opfor_members where event_id = $1", [id]);
  assert.deepEqual(named, { added_by: who.command, dated: true });
  await assert.rejects(
    fleet.as(who.command).query("update public.event_opfor_members set added_by = $2 where event_id = $1", [id, who.raider]),
    /permission denied/,
  );
});

test("someone named to the opposing force comes off the roll, and only they are told why", async () => {
  const id = await draft({ places: 1 });
  await announce(id);
  await reply(who.raider, id);
  await reply(who.spare, id);
  assert.equal((await fleet.one("select place from public.attendance where event_id = $1 and member_id = $2", [id, who.spare])).place, "reserve");

  await name(who.command, id, who.raider);
  assert.equal((await fleet.rows("select 1 from public.attendance where event_id = $1 and member_id = $2", [id, who.raider])).length, 0);
  // The place they held goes to the first on the reserve list.
  assert.equal((await fleet.one("select place from public.attendance where event_id = $1 and member_id = $2", [id, who.spare])).place, "in");

  await assert.rejects(reply(who.raider, id), /on the opposing force for this event/);
  await assert.rejects(reply(who.raider, id, "not_attending"), /on the opposing force for this event/);
  // The event's commander, trying to place them, learns nothing from the answer.
  await assert.rejects(
    fleet.as(who.helm).query(
      "insert into public.attendance (event_id, member_id, stand_in_position_id) values ($1, $2, $3)",
      [id, who.raider, await fleet.positionId("Training Ship", "Gunner 2")],
    ),
    /Only a member who is attending can stand in/,
  );

  // Taken off the opposing force, they can reply again.
  assert.equal(await fleet.as(who.command).changed("delete from public.event_opfor_members where event_id = $1 and member_id = $2", [id, who.raider]), 1);
  await reply(who.raider, id);
});

test("the opposing force is fixed once the event is closed", async () => {
  const id = await draft();
  await plan(who.command, id, "Ambush.");
  await name(who.command, id, who.raider);
  await announce(id);
  await start(id);
  await set(who.helm, id, { state: "done" });
  await assert.rejects(plan(who.command, id, "Rewritten."), /This event is closed/);
  await assert.rejects(name(who.command, id, who.spare), /This event is closed/);
  await assert.rejects(
    fleet.as(who.command).query("delete from public.event_opfor_members where event_id = $1", [id]),
    /This event is closed/,
  );
  // It goes with the event if an admin deletes that.
  assert.equal(await fleet.as(who.admin).changed("delete from public.events where id = $1", [id]), 1);
  assert.equal((await fleet.rows("select 1 from public.event_opfor_members where event_id = $1", [id])).length, 0);
});

test("a copy brings the opposing force only for someone who may see it", async () => {
  const source = await draft({ title: "Wargame 030", commander_id: who.instructor }, who.instructor);
  await plan(who.command, source, "Ambush at the second waypoint.");
  await name(who.command, source, who.raider, true);
  const count = async (id) => ({
    plan: (await fleet.rows("select 1 from public.event_opfor where event_id = $1", [id])).length,
    roll: (await fleet.rows("select 1 from public.event_opfor_members where event_id = $1", [id])).length,
  });

  const byAuthor = await draft({ title: "Wargame 031", commander_id: who.instructor, copied_from: source }, who.instructor);
  assert.deepEqual(await count(byAuthor), { plan: 0, roll: 0 });
  const byCommand = await draft({ title: "Wargame 032", copied_from: source });
  assert.deepEqual(await count(byCommand), { plan: 1, roll: 1 });
  const copied = await fleet.one("select leads, added_by from public.event_opfor_members where event_id = $1", [byCommand]);
  assert.deepEqual(copied, { leads: true, added_by: who.command });
});

test("approval and the opposing force are logged", async () => {
  const id = await draft({ title: "Wargame 040" });
  await name(who.command, id, who.raider);
  const logged = await fleet.rows(
    `select table_name, action, actor, subject from public.audit_log
     where table_name = 'event_opfor_members' and (new_row ->> 'event_id')::uuid = $1`,
    [id],
  );
  assert.deepEqual(logged, [{ table_name: "event_opfor_members", action: "insert", actor: who.command, subject: who.raider }]);
});
