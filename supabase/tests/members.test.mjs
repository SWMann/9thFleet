// What members, staff, command and admins can change on a member's record,
// and who holds which role.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
let nextDiscordId = 100;
const fresh = (name, options) => fleet.person(String(nextDiscordId++), name, options);
const signIn = (name) => fleet.signIn(String(nextDiscordId++), name);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
});
after(() => fleet.close());

const status = async (id) => (await fleet.one("select status from public.members where id = $1", [id])).status;
const setStatus = (actor, id, to) => fleet.as(actor).changed("update public.members set status = $2 where id = $1", [id, to]);

test("an applicant sets their names and can change them until they join", async () => {
  const id = await signIn("Discord name");
  const me = fleet.as(id);
  assert.equal(await me.changed("update public.members set character_name = 'Ada Vance', rsi_handle = 'AdaV' where id = $1", [id]), 1);
  assert.equal(await me.changed("update public.members set character_name = 'Ada Vane', rsi_handle = 'Ada_Vane' where id = $1", [id]), 1);

  await fleet.sql("update public.members set status = 'recruit', service = 'navy' where id = $1", [id]);
  assert.equal(await me.changed("update public.members set rsi_handle = 'AdaVane' where id = $1", [id]), 1);
  await assert.rejects(
    me.query("update public.members set character_name = 'Someone Else' where id = $1", [id]),
    /fixed once you have joined/,
  );
});

test("a name cannot differ from another only by spaces", async () => {
  const id = await signIn("Spaces");
  const me = fleet.as(id);
  for (const name of ["Jo  Reyes", " Jo Reyes", "Jo Reyes "]) {
    await assert.rejects(
      me.query("update public.members set character_name = $2 where id = $1", [id, name]),
      /members_character_name_tidy/,
    );
  }
  await assert.rejects(me.query("update public.members set rsi_handle = 'Jo Reyes' where id = $1", [id]), /members_rsi_handle_tidy/);
});

test("two serving members cannot hold the same character name, whatever the capitals", async () => {
  await fresh("Kit Marlow");
  const second = await signIn("b");
  await fleet.sql("update public.members set status = 'recruit', service = 'navy' where id = $1", [second]);
  await assert.rejects(
    fleet.as(second).query("update public.members set character_name = 'KIT MARLOW' where id = $1", [second]),
    /duplicate key/,
  );
});

test("someone outside the fleet cannot find out which names are in use", async () => {
  const outsider = await signIn("c");
  // Taking a serving member's name raises nothing, so it tells them nothing.
  assert.equal(
    await fleet.as(outsider).changed("update public.members set character_name = 'Member', rsi_handle = 'Member' where id = $1", [outsider]),
    1,
  );
});

test("you cannot change your own status, service or joining date", async () => {
  const id = await signIn("d");
  const me = fleet.as(id);
  await assert.rejects(me.query("update public.members set status = 'member' where id = $1", [id]), /cannot change your own/);
  await assert.rejects(me.query("update public.members set service = 'navy' where id = $1", [id]), /cannot change your own/);
  await assert.rejects(me.query("update public.members set joined_on = '2020-01-01' where id = $1", [id]), /cannot change your own/);
  assert.equal(await status(id), "applicant");
});

test("holding the staff role does not let you change your own record", async () => {
  const id = await fresh("Keen clerk", { status: "recruit", roles: ["staff"] });
  await assert.rejects(fleet.as(id).query("update public.members set status = 'member' where id = $1", [id]), /cannot change your own/);
  await assert.rejects(fleet.as(id).query("update public.members set joined_on = '2001-01-01' where id = $1", [id]), /cannot change your own/);
  await assert.rejects(fleet.as(id).query("update public.members set character_name = 'Renamed' where id = $1", [id]), /fixed once you have joined/);
});

test("you cannot change someone else's record", async () => {
  const changed = await fleet.as(who.member).changed(
    "update public.members set rsi_handle = 'hijacked' where id = $1",
    [who.staff],
  );
  assert.equal(changed, 0);
});

test("nobody can add or delete a member, or write the columns the database keeps", async () => {
  const admin = fleet.as(who.admin);
  await assert.rejects(admin.query("insert into public.members (id) values (gen_random_uuid())"), /permission denied/);
  await assert.rejects(admin.query("delete from public.members where id = $1", [who.member]), /permission denied/);
  await assert.rejects(admin.query("update public.members set updated_at = now() where id = $1", [who.member]), /permission denied/);
  await assert.rejects(admin.query("update public.member_accounts set discord_id = '1' where member_id = $1", [who.member]), /permission denied/);
});

test("staff move a member through the statuses", async () => {
  const id = await fresh("Mover", { status: "recruit" });
  assert.equal(await setStatus(who.staff, id, "auxiliary"), 1);
  assert.equal(await setStatus(who.staff, id, "member"), 1);
  assert.equal((await fleet.rosterLine(id)).rank_name, "Starman");
  assert.equal(await setStatus(who.staff, id, "reserve"), 1);
  assert.equal(await setStatus(who.staff, id, "member"), 1);
});

test("staff can move someone only into a service that is open", async () => {
  const id = await fresh("Would-be soldier");
  await assert.rejects(
    fleet.as(who.staff).query("update public.members set service = 'army' where id = $1", [id]),
    /The Army is not open yet/,
  );
  await fleet.as(who.admin).query("update public.fleet_settings set open_services = '{navy,army}'");
  assert.equal(await fleet.as(who.staff).changed("update public.members set service = 'army' where id = $1", [id]), 1);
  assert.equal((await fleet.rosterLine(id)).rank_name, "Private First Class");
  await fleet.as(who.admin).query("update public.fleet_settings set open_services = '{navy}'");
});

test("discharging someone, sending them back out, or undoing a discharge is a command decision", async () => {
  const id = await fresh("Leaver");
  await assert.rejects(fleet.as(who.staff).query("update public.members set status = 'discharged' where id = $1", [id]), /command decision/);
  await assert.rejects(fleet.as(who.staff).query("update public.members set status = 'applicant' where id = $1", [id]), /command decision/);

  assert.equal(await setStatus(who.command, id, "discharged"), 1);
  await assert.rejects(fleet.as(who.staff).query("update public.members set status = 'member' where id = $1", [id]), /command decision/);
  assert.equal(await status(id), "discharged");
  assert.equal(await setStatus(who.command, id, "member"), 1);
});

test("staff and command cannot touch an admin's record", async () => {
  await assert.rejects(fleet.as(who.staff).query("update public.members set status = 'reserve' where id = $1", [who.admin]), /Only an admin/);
  await assert.rejects(fleet.as(who.command).query("update public.members set status = 'discharged' where id = $1", [who.admin]), /Only an admin/);
  await assert.rejects(fleet.as(who.staff).query("update public.members set character_name = 'Renamed' where id = $1", [who.admin]), /Only an admin/);
  assert.equal(await status(who.admin), "member");
});

test("a discharge ends every assignment and removes every role", async () => {
  const id = await fresh("Gunner", { roles: ["instructor"] });
  await fleet.qualify(id, "radio-user", "navy-crew");
  await fleet.sql(
    "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')",
    [id, await fleet.positionId("Training Ship", "Gunner 1")],
  );
  await setStatus(who.command, id, "discharged");

  const open = await fleet.rows("select id from public.assignments where member_id = $1 and ended_on is null", [id]);
  assert.deepEqual(open, []);
  assert.deepEqual(await fleet.rows("select role from public.member_roles where member_id = $1", [id]), []);
  const line = await fleet.rosterLine(id);
  assert.equal(line.grade_code, null);
  assert.equal(line.position_title, null);
});

test("any status but full member ends assignments, and the service record stays", async () => {
  for (const [name, to, post] of [["Reservist", "reserve", "Gunner 2"], ["Set back", "recruit", "Gunner 3"]]) {
    const id = await fresh(name);
    await fleet.qualify(id, "radio-user", "navy-crew");
    await fleet.sql(
      "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')",
      [id, await fleet.positionId("Training Ship", post)],
    );
    await setStatus(who.staff, id, to);

    const record = await fleet.rows("select ended_on = current_date as ended_today from public.assignments where member_id = $1", [id]);
    assert.deepEqual(record, [{ ended_today: true }], to);
    assert.equal((await fleet.rosterLine(id)).position_title, null);
    const awards = await fleet.rows("select id from public.qualification_awards where member_id = $1", [id]);
    assert.equal(awards.length, 2, "qualifications stay");
  }
});

test("only an admin grants or removes a role, and the grant is stamped with who made it", async () => {
  const id = await fresh("Promoted");
  const grant = (actor, target, role) =>
    fleet.as(actor).query("insert into public.member_roles (member_id, role) values ($1, $2)", [target, role]);
  for (const actor of [who.member, who.staff, who.command]) {
    await assert.rejects(grant(actor, id, "staff"), /row-level security/);
  }
  await assert.rejects(grant(who.member, who.member, "admin"), /row-level security/);

  // The stamp cannot be sent from outside at all.
  await assert.rejects(
    fleet.as(who.admin).query("insert into public.member_roles (member_id, role, granted_by) values ($1, 'staff', $2)", [id, who.member]),
    /permission denied/,
  );
  await grant(who.admin, id, "staff");
  const row = await fleet.one("select granted_by from public.member_roles where member_id = $1", [id]);
  assert.equal(row.granted_by, who.admin);

  assert.equal(await fleet.as(who.staff).changed("delete from public.member_roles where member_id = $1", [id]), 0);
  assert.equal(await fleet.as(who.admin).changed("delete from public.member_roles where member_id = $1", [id]), 1);
});

test("a role goes only to a serving member, and stops counting when they leave", async () => {
  const outsider = await signIn("e");
  await assert.rejects(
    fleet.as(who.admin).query("insert into public.member_roles (member_id, role) values ($1, 'staff')", [outsider]),
    /Only a serving member/,
  );

  const clerk = await fresh("Clerk", { roles: ["staff"] });
  assert.equal((await fleet.as(clerk).rows("select id from public.members")).length > 5, true);
  await setStatus(who.command, clerk, "applicant");
  assert.deepEqual(await fleet.rows("select role from public.member_roles where member_id = $1", [clerk]), []);
  assert.deepEqual(await fleet.as(clerk).rows("select id from public.members"), [{ id: clerk }]);
});

test("the last admin cannot lose the role or leave", async () => {
  const admin = fleet.as(who.admin);
  await assert.rejects(
    admin.query("delete from public.member_roles where member_id = $1 and role = 'admin'", [who.admin]),
    /last admin/,
  );
  for (const to of ["discharged", "applicant"]) {
    await assert.rejects(admin.query("update public.members set status = $2 where id = $1", [who.admin, to]), /last admin/);
  }
  assert.equal(await status(who.admin), "member");

  // With a second admin in place, the first can step down.
  const second = await fresh("Second admin");
  await admin.query("insert into public.member_roles (member_id, role) values ($1, 'admin')", [second]);
  assert.equal(await admin.changed("delete from public.member_roles where member_id = $1 and role = 'admin'", [who.admin]), 1);
  await fleet.as(second).query("insert into public.member_roles (member_id, role) values ($1, 'admin')", [who.admin]);

  // An admin who is not the last can leave. Their roles and position go with them.
  await fleet.qualify(second, "radio-user", "navy-crew");
  await fleet.sql(
    "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')",
    [second, await fleet.positionId("Training Ship", "Gunner 4")],
  );
  assert.equal(await fleet.as(second).changed("update public.members set status = 'discharged' where id = $1", [second]), 1);
  assert.equal(await status(second), "discharged");
  assert.deepEqual(await fleet.rows("select id from public.assignments where member_id = $1 and ended_on is null", [second]), []);
  assert.equal((await fleet.rosterLine(who.admin)).position_title, "Fleet Commander");
});

test("only an admin opens recruitment, opens a service or moves the fleet to a new stage", async () => {
  for (const actor of [who.member, who.staff, who.command]) {
    assert.equal(await fleet.as(actor).changed("update public.fleet_settings set recruitment_open = true"), 0);
    assert.equal(await fleet.as(actor).changed("update public.fleet_settings set open_services = '{navy,army,marines}'"), 0);
    assert.equal(await fleet.as(actor).changed("update public.fleet_settings set current_stage = 9"), 0);
  }
  assert.equal(await fleet.as(who.admin).changed("update public.fleet_settings set current_stage = 2"), 1);
  const settings = await fleet.one("select recruitment_open, open_services::text[], current_stage from public.fleet_settings");
  assert.deepEqual(settings, { recruitment_open: false, open_services: ["navy"], current_stage: 2 });
});
