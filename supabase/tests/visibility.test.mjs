// Who can read what.

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
  who.member = await fleet.person("3", "Member");
  who.recruit = await fleet.person("4", "Recruit", { status: "recruit" });
  who.reserve = await fleet.person("5", "Reserve", { status: "reserve" });
  who.applicant = await fleet.applicant("7", "Applicant");
  who.otherApplicant = await fleet.applicant("8", "Other applicant");

  // Someone who served, held a position and was then discharged.
  who.discharged = await fleet.person("6", "Discharged");
  await fleet.qualify(who.discharged, "radio-user", "navy-crew");
  await fleet.sql(
    "insert into public.assignments (member_id, position_id, kind, note) values ($1, $2, 'primary', 'Left under a cloud.')",
    [who.discharged, await fleet.positionId("Training Ship", "Gunner 1")],
  );
  await fleet.sql("update public.members set status = 'discharged' where id = $1", [who.discharged]);

  await fleet.openRecruitment();
  await fleet.as(who.applicant).query(
    `insert into public.applications (member_id, answers) values ($1, '{"why": "To serve."}')`,
    [who.applicant],
  );
  await fleet.as(who.otherApplicant).query("insert into public.applications (member_id) values ($1)", [who.otherApplicant]);
  await fleet.as(who.staff).query(
    `insert into public.application_notes (application_id, author_id, body)
     select id, $1, 'Good interview.' from public.applications where member_id = $2`,
    [who.staff, who.applicant],
  );
});
after(() => fleet.close());

const count = async (actor, table, where = "true", params = []) =>
  (await actor.rows(`select count(*)::int as n from public.${table} where ${where}`, params))[0].n;

test("a visitor reads the settings, grades and ranks", async () => {
  const visitor = fleet.visitor();
  assert.equal(await count(visitor, "fleet_settings"), 1);
  assert.equal(await count(visitor, "grades"), 18);
  assert.equal(await count(visitor, "ranks"), 54);
});

// The public site lists the fleet's roles, so the structure is open to read.
// It names no one: who holds a post is in the tables the next test covers.
test("a visitor reads the structure: units, positions and what each requires", async () => {
  const visitor = fleet.visitor();
  assert.equal(await count(visitor, "units"), 14);
  assert.equal(await count(visitor, "positions"), 52);
  assert.equal(await count(visitor, "qualifications"), 6);
  assert.ok((await count(visitor, "position_qualifications")) > 0);
});

test("a visitor cannot change the structure", async () => {
  const visitor = fleet.visitor();
  for (const change of [
    "update public.units set opens_at_stage = 1",
    "update public.positions set opens_at_stage = 1",
    "delete from public.position_qualifications",
    "update public.qualifications set name = 'Anything'",
    "insert into public.units (name, kind) values ('Shadow Fleet', 'ship')",
  ]) {
    await assert.rejects(visitor.query(change), /permission denied/, change);
  }
});

test("a visitor is refused everything about people", async () => {
  const visitor = fleet.visitor();
  const closed = [
    "members", "member_accounts", "member_roles", "qualification_awards", "assignments", "applications",
    "application_notes", "audit_log", "roster",
  ];
  for (const table of closed) {
    await assert.rejects(visitor.query(`select * from public.${table}`), /permission denied/, table);
  }
  await assert.rejects(visitor.query("update public.fleet_settings set recruitment_open = true"), /permission denied/);
});

test("an applicant sees themselves and their own application, and no more", async () => {
  const applicant = fleet.as(who.applicant);
  const members = await applicant.rows("select id from public.members");
  assert.deepEqual(members, [{ id: who.applicant }]);
  assert.equal(await count(applicant, "roster"), 1);
  assert.equal(await count(applicant, "member_accounts"), 1);
  assert.equal(await count(applicant, "applications"), 1);
  for (const table of ["assignments", "qualification_awards", "member_roles", "application_notes", "audit_log"]) {
    assert.equal(await count(applicant, table), 0, table);
  }
  // The structure is public, so an applicant reads it like anyone else. It shows no holders.
  assert.equal(await count(applicant, "units"), 14);
  assert.equal(await count(applicant, "positions"), 52);
});

test("a member sees the serving fleet and its order of battle", async () => {
  const member = fleet.as(who.member);
  const seen = (await member.rows("select id from public.members")).map((row) => row.id).sort();
  assert.deepEqual(seen, [who.admin, who.staff, who.member, who.recruit, who.reserve].sort());
  assert.equal(await count(member, "units"), 14);
  assert.equal(await count(member, "positions"), 52);
  assert.equal(await count(member, "qualifications"), 6);
  assert.equal(await count(member, "roster"), 5);
  assert.ok((await count(member, "member_roles")) >= 5, "who holds which role is visible inside the fleet");
  assert.equal(await count(member, "assignments", "member_id = $1", [who.admin]), 1, "who holds which position");
});

test("a member cannot see applicants, applications, interview notes, other accounts or the audit log", async () => {
  const member = fleet.as(who.member);
  assert.equal(await count(member, "applications"), 0);
  assert.equal(await count(member, "application_notes"), 0);
  assert.equal(await count(member, "audit_log"), 0);
  const accounts = await member.rows("select member_id from public.member_accounts");
  assert.deepEqual(accounts, [{ member_id: who.member }]);
});

test("a member cannot see the record of someone who has been discharged", async () => {
  for (const reader of [who.member, who.recruit]) {
    const actor = fleet.as(reader);
    assert.equal(await count(actor, "assignments", "member_id = $1", [who.discharged]), 0);
    assert.equal(await count(actor, "qualification_awards", "member_id = $1", [who.discharged]), 0);
  }
  assert.equal(await count(fleet.as(who.staff), "assignments", "member_id = $1", [who.discharged]), 1);
});

test("a recruit and a reservist see the fleet too", async () => {
  assert.equal(await count(fleet.as(who.recruit), "units"), 14);
  assert.equal(await count(fleet.as(who.reserve), "roster"), 5);
});

test("a discharged member sees only themselves and their own record", async () => {
  const discharged = fleet.as(who.discharged);
  assert.deepEqual(await discharged.rows("select id from public.members"), [{ id: who.discharged }]);
  assert.equal(await count(discharged, "units"), 14, "the structure is public");
  assert.equal(await count(discharged, "roster"), 1);
  assert.equal(await count(discharged, "member_roles"), 0);
  assert.equal(await count(discharged, "assignments"), 1);
  assert.equal(await count(discharged, "qualification_awards"), 2);
});

test("an applicant cannot read the interview notes written about them", async () => {
  assert.equal(await count(fleet.as(who.applicant), "application_notes"), 0);
});

test("staff see everyone, every application and the notes, but not the audit log", async () => {
  const staff = fleet.as(who.staff);
  assert.equal(await count(staff, "members"), 8);
  assert.equal(await count(staff, "member_accounts"), 8);
  assert.equal(await count(staff, "applications"), 2);
  assert.equal(await count(staff, "application_notes"), 1);
  assert.equal(await count(staff, "audit_log"), 0);
});

test("an admin reads the audit log", async () => {
  assert.ok((await count(fleet.as(who.admin), "audit_log")) > 0);
});
