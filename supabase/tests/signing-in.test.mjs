// Signing in with Discord, and how the first admin comes to exist.

import assert from "node:assert/strict";
import { test } from "node:test";
import { newFleet } from "./helpers.mjs";

const rolesOf = async (fleet, id) =>
  (await fleet.rows("select role from public.member_roles where member_id = $1 order by role", [id])).map((row) => row.role);

test("a first Discord sign-in creates an applicant with nothing else", async () => {
  const fleet = await newFleet();
  const id = await fleet.signIn("1001", "Newcomer");

  const member = await fleet.one("select status, service, character_name from public.members where id = $1", [id]);
  assert.deepEqual(member, { status: "applicant", service: null, character_name: null });

  const account = await fleet.one("select discord_id, discord_name from public.member_accounts where member_id = $1", [id]);
  assert.deepEqual(account, { discord_id: "1001", discord_name: "Newcomer" });
  assert.deepEqual(await rolesOf(fleet, id), []);
  await fleet.close();
});

test("the founder's Discord account becomes Fleet Commander with every role", async () => {
  const fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '42'");
  const founder = await fleet.signIn("42", "Tom");
  const other = await fleet.signIn("43", "Someone else");

  const line = await fleet.rosterLine(founder);
  assert.equal(line.status, "member");
  assert.equal(line.service, "navy");
  assert.equal(line.position_title, "Fleet Commander");
  assert.equal(line.grade_code, "O4");
  assert.equal(line.rank_name, "Lt. Commander");
  assert.deepEqual(await rolesOf(fleet, founder), ["instructor", "staff", "command", "admin"]);

  assert.equal((await fleet.rosterLine(other)).status, "applicant");
  await fleet.close();
});

test("naming the founder after they have signed in promotes them then", async () => {
  const fleet = await newFleet();
  const founder = await fleet.signIn("42", "Tom");
  assert.equal((await fleet.rosterLine(founder)).status, "applicant");

  await fleet.sql("update app.bootstrap set founder_discord_id = '42'");
  const line = await fleet.rosterLine(founder);
  assert.equal(line.position_title, "Fleet Commander");
  assert.equal(line.rank_name, "Lt. Commander");
  await fleet.close();
});

test("claiming the founder's Discord ID in your own details gets you nothing", async () => {
  const fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '42'");

  // An account made with an email address, with the founder's ID typed into
  // the details a user controls.
  const forged = await fleet.signIn("42", "Impostor", {
    provider: "email",
    userData: { provider_id: "42", sub: "42", full_name: "Impostor" },
  });
  assert.equal(await fleet.one("select 1 as found from public.members where id = $1", [forged]), undefined);
  assert.deepEqual(await rolesOf(fleet, forged), []);

  // With no member row the account can see and do nothing.
  await fleet.openRecruitment();
  const actor = fleet.as(forged);
  assert.deepEqual(await actor.rows("select id from public.members"), []);
  assert.deepEqual(await actor.rows("select id from public.units"), []);
  await assert.rejects(
    actor.query("insert into public.applications (member_id) values ($1)", [forged]),
    /row-level security/,
  );

  // The real founder still gets in afterwards.
  const founder = await fleet.signIn("42", "Tom");
  assert.equal((await fleet.rosterLine(founder)).position_title, "Fleet Commander");
  await fleet.close();
});

test("once the fleet has an admin, the founder's Discord ID carries no power", async () => {
  const fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '42'");
  const founder = await fleet.signIn("42", "Tom");
  const deputy = await fleet.person("43", "Deputy");
  await fleet.as(founder).query("insert into public.member_roles (member_id, role) values ($1, 'admin')", [deputy]);

  // The founder hands over and their account is deleted. Whoever signs in
  // with that Discord account later is an ordinary applicant.
  await fleet.sql("delete from auth.users where id = $1", [founder]);
  const again = await fleet.signIn("42", "Tom");
  assert.equal((await fleet.rosterLine(again)).status, "applicant");
  assert.deepEqual(await rolesOf(fleet, again), []);

  // Naming them again changes nothing either, while an admin exists.
  await fleet.sql("update app.bootstrap set founder_discord_id = '42'");
  assert.deepEqual(await rolesOf(fleet, again), []);
  await fleet.close();
});

test("a later sign-in refreshes the Discord name and nothing else", async () => {
  const fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '42'");
  const founder = await fleet.signIn("42", "Tom");
  const other = await fleet.signIn("43", "Old name");
  await fleet.sql("update public.members set status = 'discharged' where id = $1", [other]);

  // The sign-in service updates the identity row on every sign-in.
  const signInAgain = (userId, data) =>
    fleet.db.transaction(async (tx) => {
      await tx.query("set local role supabase_auth_admin");
      await tx.query(
        "update auth.identities set identity_data = $2, last_sign_in_at = now() where user_id = $1",
        [userId, JSON.stringify(data)],
      );
    });
  await signInAgain(other, { full_name: "New name" });
  const account = await fleet.one("select discord_id, discord_name from public.member_accounts where member_id = $1", [other]);
  assert.deepEqual(account, { discord_id: "43", discord_name: "New name" });
  assert.equal((await fleet.rosterLine(other)).status, "discharged", "signing in again does not undo a discharge");

  // Odd details from Discord must never stop a sign-in.
  await signInAgain(other, {});
  await signInAgain(other, { full_name: "x".repeat(5000), custom_claims: null });
  await signInAgain(founder, { name: "Tom" });
  assert.equal((await fleet.rosterLine(founder)).position_title, "Fleet Commander");
  await fleet.close();
});

test("a Discord account whose old records were left behind can still sign in", async () => {
  const fleet = await newFleet();
  const old = await fleet.signIn("77", "Returning");
  // The old account's sign-in was removed but its records were not.
  await fleet.sql("delete from auth.identities where user_id = $1", [old]);

  const fresh = await fleet.signIn("77", "Returning");
  assert.equal((await fleet.one("select discord_id from public.member_accounts where member_id = $1", [fresh])).discord_id, "77");
  assert.equal((await fleet.one("select discord_id from public.member_accounts where member_id = $1", [old])).discord_id, null);
  await fleet.close();
});

test("a signed-in user cannot read or change who the founder is", async () => {
  const fleet = await newFleet();
  const id = await fleet.signIn("1001", "Newcomer");
  await assert.rejects(fleet.as(id).query("select * from app.bootstrap"), /permission denied/);
  await assert.rejects(
    fleet.as(id).query("update app.bootstrap set founder_discord_id = '1001'"),
    /permission denied/,
  );
  await assert.rejects(fleet.as(id).query("select app.promote_founder($1)", [id]), /permission denied/);
  await fleet.close();
});
