// The audit log, and removing someone's data.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.leaver = await fleet.person("5", "Leaver");
  await fleet.qualify(who.member, "radio-user", "navy-crew");
  await fleet.qualify(who.leaver, "radio-user", "navy-crew");
});
after(() => fleet.close());

test("a change is logged with who made it, who it was about, and the before and after", async () => {
  await fleet.as(who.staff).query("update public.members set status = 'reserve' where id = $1", [who.member]);
  await fleet.as(who.staff).query("update public.members set status = 'member' where id = $1", [who.member]);

  const entry = await fleet.one(
    `select actor, subject, action, old_row ->> 'status' as was, new_row ->> 'status' as now
     from public.audit_log
     where table_name = 'members' and subject = $1 and new_row ->> 'status' = 'reserve'`,
    [who.member],
  );
  assert.deepEqual(entry, { actor: who.staff, subject: who.member, action: "update", was: "member", now: "reserve" });
});

test("appointments and role grants are logged", async () => {
  await fleet.as(who.command).query(
    "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')",
    [who.member, await fleet.positionId("Training Ship", "Gunner 1")],
  );
  await fleet.as(who.admin).query("insert into public.member_roles (member_id, role) values ($1, 'instructor')", [who.member]);

  const logged = await fleet.rows(
    `select table_name, actor from public.audit_log
     where subject = $1 and action = 'insert' and table_name in ('assignments', 'member_roles')
     order by table_name`,
    [who.member],
  );
  assert.deepEqual(logged, [
    { table_name: "assignments", actor: who.command },
    { table_name: "member_roles", actor: who.admin },
  ]);
});

test("changes to the order of battle and to what a position requires are logged", async () => {
  const admin = fleet.as(who.admin);
  const post = await fleet.positionId("Bridge", "Executive Officer");
  await admin.query("update public.positions set opens_at_stage = 1 where id = $1", [post]);
  await admin.query("delete from public.position_qualifications where position_id = $1", [post]);
  await admin.query("update public.qualifications set name = 'Radio operator' where code = 'radio-user'");
  await admin.query("update public.fleet_settings set current_stage = 2");

  const logged = await fleet.rows(
    `select table_name, action from public.audit_log
     where actor = $1 and table_name in ('positions', 'position_qualifications', 'qualifications', 'fleet_settings')
     order by table_name`,
    [who.admin],
  );
  assert.deepEqual(logged, [
    { table_name: "fleet_settings", action: "update" },
    { table_name: "position_qualifications", action: "delete" },
    { table_name: "positions", action: "update" },
    { table_name: "qualifications", action: "update" },
  ]);
});

test("writing or removing an interview note is logged, without what it said", async () => {
  await fleet.openRecruitment();
  const applicant = await fleet.applicant("60", "Interviewee");
  const application = await fleet.as(applicant).one(
    "insert into public.applications (member_id) values ($1) returning id",
    [applicant],
  );
  const staff = fleet.as(who.staff);
  await staff.query(
    "insert into public.application_notes (application_id, author_id, body) values ($1, $2, 'Private remarks.')",
    [application.id, who.staff],
  );
  assert.equal(await staff.changed("delete from public.application_notes where application_id = $1", [application.id]), 1);

  const logged = await fleet.rows(
    `select action, actor, subject, coalesce(new_row, old_row) ? 'body' as has_body
     from public.audit_log where table_name = 'application_notes' order by id`,
  );
  assert.deepEqual(logged, [
    { action: "insert", actor: who.staff, subject: applicant, has_body: false },
    { action: "delete", actor: who.staff, subject: applicant, has_body: false },
  ]);
});

test("nobody can write to the audit log, not even the admin", async () => {
  const admin = fleet.as(who.admin);
  await assert.rejects(
    admin.query("insert into public.audit_log (table_name, action) values ('members', 'update')"),
    /permission denied/,
  );
  await assert.rejects(admin.query("update public.audit_log set actor = null"), /permission denied/);
  await assert.rejects(admin.query("delete from public.audit_log"), /permission denied/);
});

test("only an admin reads the audit log", async () => {
  for (const actor of [who.member, who.staff, who.command]) {
    assert.deepEqual(await fleet.as(actor).rows("select id from public.audit_log"), []);
  }
  assert.ok((await fleet.as(who.admin).rows("select id from public.audit_log")).length > 0);
});

test("deleting an account removes the member and blanks what the log held about them", async () => {
  // The leaver holds a position, has applied for the cadet course and has an
  // interview note written about them.
  await fleet.as(who.command).query(
    "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')",
    [who.leaver, await fleet.positionId("Training Ship", "Gunner 2")],
  );
  const application = await fleet.as(who.leaver).one(
    "insert into public.applications (member_id, route) values ($1, 'cadet') returning id",
    [who.leaver],
  );
  await fleet.as(who.staff).query(
    "insert into public.application_notes (application_id, author_id, body) values ($1, $2, 'Keen.')",
    [application.id, who.staff],
  );

  await fleet.sql("delete from auth.users where id = $1", [who.leaver]);

  for (const table of ["members", "member_accounts", "assignments", "qualification_awards", "applications"]) {
    const column = table === "members" ? "id" : "member_id";
    const left = await fleet.rows(`select 1 from public.${table} where ${column} = $1`, [who.leaver]);
    assert.deepEqual(left, [], table);
  }
  assert.deepEqual(await fleet.rows("select 1 from public.application_notes where application_id = $1", [application.id]), []);

  const kept = await fleet.rows("select old_row, new_row from public.audit_log where subject = $1", [who.leaver]);
  assert.ok(kept.length > 0, "the log still shows that something happened");
  for (const entry of kept) {
    assert.equal(entry.old_row, null);
    assert.equal(entry.new_row, null);
  }
  const mentions = await fleet.rows(
    "select id from public.audit_log where old_row::text like $1 or new_row::text like $1",
    [`%${who.leaver}%`],
  );
  assert.deepEqual(mentions, [], "nothing in the log still names them");
});

test("deleting the account of someone who made appointments leaves those appointments standing", async () => {
  await fleet.sql("delete from auth.users where id = $1", [who.command]);
  const row = await fleet.one(
    "select appointed_by, ended_on from public.assignments where member_id = $1 and kind = 'primary'",
    [who.member],
  );
  assert.deepEqual(row, { appointed_by: null, ended_on: null });
});
