// Applying to join, and how staff handle applications.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
let nextDiscordId = 100;
const applicant = (name) => fleet.applicant(String(nextDiscordId++), name);
const apply = (id, route = "recruit") =>
  fleet.as(id).one(
    `insert into public.applications (member_id, preferred_service, answers, route)
     values ($1, 'navy', '{"why": "To serve."}', $2) returning id`,
    [id, route],
  );
const setStage = (actor, applicationId, stage) =>
  fleet.as(actor).changed("update public.applications set stage = $2 where id = $1", [applicationId, stage]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.otherStaff = await fleet.person("3", "Other staff", { roles: ["staff"] });
  who.member = await fleet.person("4", "Member");
});
after(() => fleet.close());

const memberLine = (id) => fleet.one("select status, service from public.members where id = $1", [id]);

test("nobody can apply while recruitment is closed", async () => {
  const id = await applicant("Early");
  await assert.rejects(apply(id), /row-level security/);
});

test("the admin opens recruitment and an applicant applies", async () => {
  assert.equal(await fleet.as(who.admin).changed("update public.fleet_settings set recruitment_open = true"), 1);
  const id = await applicant("On time");
  const application = await apply(id);
  const row = await fleet.one("select stage, route, decided_at from public.applications where id = $1", [application.id]);
  assert.deepEqual(row, { stage: "submitted", route: "recruit", decided_at: null });
});

test("you need a character name and an RSI handle before you can apply", async () => {
  const id = await fleet.signIn(String(nextDiscordId++), "No names yet");
  await assert.rejects(apply(id), /row-level security/);
  await fleet.as(id).query("update public.members set character_name = 'Now Named' where id = $1", [id]);
  await assert.rejects(apply(id), /row-level security/);
  await fleet.as(id).query("update public.members set rsi_handle = 'NowNamed' where id = $1", [id]);
  await apply(id);
});

test("you apply only for yourself, only once at a time, and cannot decide your own application", async () => {
  const id = await applicant("Keen");
  const someone = await applicant("Someone");
  const me = fleet.as(id);

  await assert.rejects(me.query("insert into public.applications (member_id) values ($1)", [someone]), /row-level security/);
  // The stage, the decision and the date are not yours to send.
  await assert.rejects(me.query("insert into public.applications (member_id, stage) values ($1, 'accepted')", [id]), /permission denied/);
  await assert.rejects(me.query("insert into public.applications (member_id, decided_by) values ($1, $1)", [id]), /permission denied/);
  await assert.rejects(me.query("insert into public.applications (member_id, submitted_at) values ($1, '1999-01-01')", [id]), /permission denied/);

  await apply(id);
  await assert.rejects(apply(id), /duplicate key/);

  await assert.rejects(me.query("update public.applications set stage = 'accepted' where member_id = $1", [id]), /withdraw your application/);
  await assert.rejects(me.query(`update public.applications set answers = '{"why": "changed"}' where member_id = $1`, [id]), /permission denied/);
  assert.equal((await memberLine(id)).status, "applicant");
});

test("an applicant can withdraw, and a withdrawn application stays closed", async () => {
  const id = await applicant("Second thoughts");
  const application = await apply(id);
  assert.equal(await setStage(id, application.id, "withdrawn"), 1);
  await assert.rejects(fleet.as(id).query("update public.applications set stage = 'submitted' where id = $1", [application.id]), /closed/);
  await assert.rejects(fleet.as(who.staff).query("update public.applications set stage = 'accepted' where id = $1", [application.id]), /closed/);
  // They are free to apply again.
  await apply(id);
});

test("three applications in 30 days is the limit", async () => {
  const id = await applicant("Persistent");
  for (let round = 0; round < 3; round += 1) {
    const application = await apply(id);
    await setStage(id, application.id, "withdrawn");
  }
  await assert.rejects(apply(id), /row-level security/);
});

test("an applicant cannot see or touch anyone else's application", async () => {
  const mine = await applicant("Mine");
  const theirs = await applicant("Theirs");
  await apply(mine);
  const other = await apply(theirs);
  const seen = await fleet.as(mine).rows("select member_id from public.applications");
  assert.deepEqual(seen, [{ member_id: mine }]);
  assert.equal(await setStage(mine, other.id, "withdrawn"), 0);
  assert.equal(await setStage(who.member, other.id, "accepted"), 0);
});

test("staff interview, note and accept, and the applicant becomes a recruit", async () => {
  const id = await applicant("Good candidate");
  const application = await apply(id);
  const staff = fleet.as(who.staff);
  const note = (actor, author, body) =>
    fleet.as(actor).query(
      "insert into public.application_notes (application_id, author_id, body) values ($1, $2, $3)",
      [application.id, author, body],
    );

  assert.equal(await setStage(who.staff, application.id, "interview"), 1);
  await note(who.staff, who.staff, "Clear on the radio.");
  await assert.rejects(note(who.staff, who.otherStaff, "Signed as someone else."), /row-level security/);
  await assert.rejects(note(who.member, who.member, "Not staff."), /row-level security/);
  await assert.rejects(
    staff.query(
      "insert into public.application_notes (application_id, author_id, body, created_at) values ($1, $2, 'Backdated.', '2001-01-01')",
      [application.id, who.staff],
    ),
    /permission denied/,
  );
  await assert.rejects(
    staff.query("update public.applications set preferred_service = 'marines' where id = $1", [application.id]),
    /permission denied/,
  );

  assert.equal(await setStage(who.staff, application.id, "accepted"), 1);
  const decided = await fleet.one("select stage, decided_by, decided_at is not null as stamped from public.applications where id = $1", [application.id]);
  assert.deepEqual(decided, { stage: "accepted", decided_by: who.staff, stamped: true });
  assert.deepEqual(await memberLine(id), { status: "recruit", service: "navy" });
  assert.equal((await fleet.rosterLine(id)).rank_name, "Starman Recruit");
});

test("an applicant whose name is already taken in the fleet is accepted only once they change it", async () => {
  const id = await fleet.signIn(String(nextDiscordId++), "Clash");
  await fleet.as(id).query("update public.members set character_name = 'MEMBER', rsi_handle = 'Clash' where id = $1", [id]);
  const application = await apply(id);

  await assert.rejects(
    fleet.as(who.staff).query("update public.applications set stage = 'accepted' where id = $1", [application.id]),
    /already has this character name or RSI handle/,
  );
  assert.equal((await memberLine(id)).status, "applicant");

  await fleet.as(id).query("update public.members set character_name = 'Not Member' where id = $1", [id]);
  assert.equal(await setStage(who.staff, application.id, "accepted"), 1);
  assert.equal((await memberLine(id)).status, "recruit");
});

test("a declined applicant stays an applicant and can apply again", async () => {
  const id = await applicant("Not yet");
  const application = await apply(id);
  await setStage(who.staff, application.id, "declined");
  assert.equal((await memberLine(id)).status, "applicant");
  await apply(id);
});

test("staff cannot withdraw an application for someone, decide their own, or read the notes about themselves", async () => {
  const id = await applicant("Still keen");
  const application = await apply(id);
  await assert.rejects(
    fleet.as(who.staff).query("update public.applications set stage = 'withdrawn' where id = $1", [application.id]),
    /Only the applicant/,
  );

  // A full member may apply for the cadet course at any time.
  const own = await apply(who.staff, "cadet");
  await assert.rejects(
    fleet.as(who.staff).query("update public.applications set stage = 'accepted' where id = $1", [own.id]),
    /withdraw your application/,
  );
  await fleet.as(who.otherStaff).query(
    "insert into public.application_notes (application_id, author_id, body) values ($1, $2, 'Not ready for command.')",
    [own.id, who.otherStaff],
  );
  assert.deepEqual(
    await fleet.as(who.staff).rows("select body from public.application_notes where application_id = $1", [own.id]),
    [],
  );
  await assert.rejects(
    fleet.as(who.staff).query(
      "insert into public.application_notes (application_id, author_id, body) values ($1, $2, 'I am excellent.')",
      [own.id, who.staff],
    ),
    /row-level security/,
  );

  assert.equal(await setStage(who.otherStaff, own.id, "accepted"), 1);
  assert.equal((await memberLine(who.staff)).status, "member", "a serving member keeps their status");
});

test("you can apply only for a service that is open", async () => {
  const id = await applicant("Soldier");
  const forArmy = () =>
    fleet.as(id).query("insert into public.applications (member_id, preferred_service) values ($1, 'army')", [id]);
  await assert.rejects(forArmy(), /row-level security/);

  assert.equal(await fleet.as(who.staff).changed("update public.fleet_settings set open_services = '{navy,army}'"), 0);
  assert.equal(await fleet.as(who.admin).changed("update public.fleet_settings set open_services = '{navy,army}'"), 1);
  await forArmy();
  await fleet.as(who.otherStaff).query("update public.applications set stage = 'accepted' where member_id = $1", [id]);
  assert.deepEqual(await memberLine(id), { status: "recruit", service: "army" });
  assert.equal((await fleet.rosterLine(id)).rank_name, "Private");
});

test("a serving member cannot use the recruit route, and a recruit cannot apply for the cadet course", async () => {
  await assert.rejects(apply(who.member, "recruit"), /row-level security/);
  const recruit = await fleet.person(String(nextDiscordId++), "Too soon", { status: "recruit" });
  await assert.rejects(apply(recruit, "cadet"), /row-level security/);
});

test("only an admin deletes an application", async () => {
  const id = await applicant("Deleted");
  const application = await apply(id);
  assert.equal(await fleet.as(id).changed("delete from public.applications where id = $1", [application.id]), 0);
  assert.equal(await fleet.as(who.staff).changed("delete from public.applications where id = $1", [application.id]), 0);
  assert.equal(await fleet.as(who.admin).changed("delete from public.applications where id = $1", [application.id]), 1);
});
