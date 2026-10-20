// The fleet board: ship roles are an admin's sheet, each model's roles are
// command's with one of them primary, and a hull in claim counts as not ready.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const model = {};
const role = {};

const rolesOf = (slug) =>
  fleet.rows(
    `select r.slug, mr.is_primary from public.ship_model_roles mr
     join public.ship_roles r on r.id = mr.role_id join public.ship_models m on m.id = mr.model_id
     where m.slug = $1 order by r.sort_order`,
    [slug],
  );
const give = (actor, modelSlug, roleSlug, primary = false) =>
  fleet.as(actor).query("insert into public.ship_model_roles (model_id, role_id, is_primary) values ($1, $2, $3)", [model[modelSlug], role[roleSlug], primary]);
const take = (actor, modelSlug, roleSlug) => fleet.as(actor).changed("delete from public.ship_model_roles where model_id = $1 and role_id = $2", [model[modelSlug], role[roleSlug]]);

const register = (actor, fields) => {
  const columns = Object.keys(fields);
  return fleet.as(actor).one(
    `insert into public.ships (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id, ready, in_claim`,
    Object.values(fields),
  );
};
const ship = (id) => fleet.one("select ready, in_claim, ready_as_of from public.ships where id = $1", [id]);
const change = (actor, id, set, params = []) => fleet.as(actor).changed(`update public.ships set ${set} where id = $1`, [id, ...params]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.owner = await fleet.person("4", "Owner");
  who.other = await fleet.person("5", "Other");
  who.applicant = await fleet.applicant("7", "Applicant");
  for (const row of await fleet.rows("select id, slug from public.ship_models")) model[row.slug] = row.id;
  for (const row of await fleet.rows("select id, slug from public.ship_roles")) role[row.slug] = row.id;
  await fleet.setStage(3);
});
after(() => fleet.close());

test("every model starts with at least one role and exactly one primary, read by the fleet and staff", async () => {
  const counts = await fleet.rows(
    `select m.slug, count(mr.role_id)::int as roles, count(*) filter (where mr.is_primary)::int as primaries
     from public.ship_models m left join public.ship_model_roles mr on mr.model_id = m.id group by m.slug`,
  );
  assert.ok(counts.length >= 60);
  for (const line of counts) {
    assert.ok(line.roles >= 1, `${line.slug} has a role`);
    assert.equal(line.primaries, 1, `${line.slug} has one primary role`);
  }
  assert.deepEqual(
    (await rolesOf("cutlass-black")).map((line) => `${line.slug}${line.is_primary ? "*" : ""}`),
    ["assault-transport*", "logistics"],
  );
  assert.equal((await fleet.as(who.owner).rows("select id from public.ship_roles")).length, 11);
  assert.ok((await fleet.as(who.staff).rows("select model_id from public.ship_model_roles")).length >= 60);
  assert.deepEqual(await fleet.as(who.applicant).rows("select id from public.ship_roles"), []);
  await assert.rejects(fleet.visitor().query("select id from public.ship_roles"), /permission denied/);
  await assert.rejects(fleet.visitor().query("select model_id from public.ship_model_roles"), /permission denied/);
});

test("an admin keeps the roles; one in use stays", async () => {
  for (const actor of [who.owner, who.staff, who.command]) {
    await assert.rejects(fleet.as(actor).query("insert into public.ship_roles (slug, name) values ('picket', 'Picket')"), /row-level security/);
    assert.equal(await fleet.as(actor).changed("update public.ship_roles set name = 'Screen' where slug = 'escort'"), 0);
    assert.equal(await fleet.as(actor).changed("delete from public.ship_roles where slug = 'industry'"), 0);
  }
  const made = await fleet.as(who.admin).one("insert into public.ship_roles (slug, name, description, sort_order) values ('picket', 'Picket', 'Stands watch on a flank.', 25) returning id");
  role.picket = made.id;
  await assert.rejects(fleet.as(who.admin).query("insert into public.ship_roles (slug, name) values ('Bad Slug', 'Bad')"), /slug_check/);
  await assert.rejects(fleet.as(who.admin).query("insert into public.ship_roles (slug, name) values ('escort', 'Twice')"), /duplicate key/);
  // A role some model holds is not removed: it is taken off the models first.
  await assert.rejects(fleet.as(who.admin).query("delete from public.ship_roles where slug = 'escort'"), /foreign key/);
  assert.equal(await fleet.as(who.admin).changed("delete from public.ship_roles where slug = 'picket'"), 1);
  delete role.picket;
});

test("command gives a model its roles; the first is primary, a new primary steps the old down, and the primary hands over when taken away", async () => {
  // Nobody else writes them.
  await assert.rejects(give(who.owner, "mustang-alpha", "escort"), /row-level security/);
  await assert.rejects(give(who.staff, "mustang-alpha", "escort"), /row-level security/);
  assert.equal(await take(who.owner, "mustang-alpha", "training"), 0);
  // A model with no roles: the first one given is the primary, whatever was asked.
  assert.equal(await take(who.command, "mustang-alpha", "training"), 1);
  assert.deepEqual(await rolesOf("mustang-alpha"), []);
  await give(who.command, "mustang-alpha", "escort");
  assert.deepEqual(await rolesOf("mustang-alpha"), [{ slug: "escort", is_primary: true }]);
  // Another, not primary, joins it.
  await give(who.command, "mustang-alpha", "training");
  assert.deepEqual(await rolesOf("mustang-alpha"), [{ slug: "escort", is_primary: true }, { slug: "training", is_primary: false }]);
  // Made the primary, it steps the other down.
  assert.equal(await fleet.as(who.command).changed("update public.ship_model_roles set is_primary = true where model_id = $1 and role_id = $2", [model["mustang-alpha"], role.training]), 1);
  assert.deepEqual(await rolesOf("mustang-alpha"), [{ slug: "escort", is_primary: false }, { slug: "training", is_primary: true }]);
  // The primary does not simply step down: another steps up instead.
  await assert.rejects(
    fleet.as(who.command).query("update public.ship_model_roles set is_primary = false where model_id = $1 and role_id = $2", [model["mustang-alpha"], role.training]),
    /Make another role the primary instead/,
  );
  // Given with the primary flag, a third takes over at once.
  await give(who.command, "mustang-alpha", "logistics", true);
  assert.deepEqual(
    (await rolesOf("mustang-alpha")).map((line) => `${line.slug}${line.is_primary ? "*" : ""}`),
    ["escort", "logistics*", "training"],
  );
  // Taking the primary away hands it to the first of the rest, in the roles' order.
  assert.equal(await take(who.command, "mustang-alpha", "logistics"), 1);
  assert.deepEqual(await rolesOf("mustang-alpha"), [{ slug: "escort", is_primary: true }, { slug: "training", is_primary: false }]);
  // A role is given or taken, not moved.
  await assert.rejects(
    fleet.as(who.command).query("update public.ship_model_roles set role_id = $3 where model_id = $1 and role_id = $2", [model["mustang-alpha"], role.training, role.medical]),
    /permission denied|not moved/,
  );
  // The same role twice is one.
  await assert.rejects(give(who.command, "mustang-alpha", "escort"), /duplicate key/);
  // Put back as it was: the primary hands over to the one left.
  assert.equal(await take(who.command, "mustang-alpha", "escort"), 1);
  assert.deepEqual(await rolesOf("mustang-alpha"), [{ slug: "training", is_primary: true }]);
});

test("a model's roles go with it", async () => {
  await fleet.as(who.admin).query("insert into public.ship_models (slug, name, kind, crew_min, crew_max, flyable) values ('perseus', 'Perseus', 'gunship', 2, 6, false)");
  for (const row of await fleet.rows("select id, slug from public.ship_models where slug = 'perseus'")) model[row.slug] = row.id;
  await give(who.command, "perseus", "fire-support");
  await give(who.command, "perseus", "strike");
  assert.equal(await fleet.as(who.admin).changed("delete from public.ship_models where slug = 'perseus'"), 1);
  assert.deepEqual(await fleet.rows("select role_id from public.ship_model_roles where model_id = $1", [model.perseus]), []);
});

test("a hull in claim is not ready; marking it ready ends the claim; it is withdrawn from events as a hull marked not ready is", async () => {
  const own = await register(who.owner, { model_id: model.gladius, name: "Claimed" });
  assert.deepEqual([own.ready, own.in_claim], [true, false]);
  // Nobody registers a hull already in claim: the mark is made on a hull that was lost.
  await assert.rejects(register(who.owner, { model_id: model.gladius, name: "Lost already", in_claim: true }), /permission denied/);
  // Only the owner or command marks it.
  assert.equal(await change(who.other, own.id, "in_claim = true"), 0);
  // The owner marks it in claim: it is not ready from that moment.
  const before = (await ship(own.id)).ready_as_of;
  assert.equal(await change(who.owner, own.id, "in_claim = true"), 1);
  let now = await ship(own.id);
  assert.deepEqual([now.ready, now.in_claim], [false, true]);
  assert.ok(now.ready_as_of >= before);
  // A statement that changes only ready to false leaves the claim standing: a change to the hull's details does not end it.
  assert.equal(await change(who.owner, own.id, "ready = false"), 1);
  assert.deepEqual((await ship(own.id)).in_claim, true);
  // The site's "not ready" mark sends both, and ends it.
  assert.equal(await change(who.owner, own.id, "ready = false, in_claim = false"), 1);
  assert.deepEqual((await ship(own.id)).in_claim, false);
  assert.equal(await change(who.owner, own.id, "in_claim = true"), 1);
  // Marked ready, the claim is over.
  assert.equal(await change(who.owner, own.id, "ready = true"), 1);
  now = await ship(own.id);
  assert.deepEqual([now.ready, now.in_claim], [true, false]);
  // The claim ended by command's hand, from the hull's record.
  assert.equal(await change(who.command, own.id, "in_claim = true"), 1);
  assert.equal(await change(who.command, own.id, "in_claim = false"), 1);
  now = await ship(own.id);
  assert.deepEqual([now.ready, now.in_claim], [false, false]);
  // Never both at once, whatever is asked: the claim wins.
  assert.equal(await change(who.owner, own.id, "ready = true, in_claim = true"), 1);
  now = await ship(own.id);
  assert.deepEqual([now.ready, now.in_claim], [false, true]);
  assert.equal(await change(who.owner, own.id, "in_claim = false"), 1);
  // Offered for an event, then lost: the offer goes while the roll is open.
  const eventId = (
    await fleet.as(who.command).one(
      "insert into public.events (kind, title, starts_at, commander_id) values ('patrol', 'Patrol 101', now() + interval '3 days', $1) returning id",
      [who.command],
    )
  ).id;
  await fleet.as(who.command).query("update public.events set state = 'announced' where id = $1", [eventId]);
  await change(who.owner, own.id, "ready = true");
  await fleet.as(who.owner).query("insert into public.attendance (event_id, member_id, reply) values ($1, $2, 'attending')", [eventId, who.owner]);
  await fleet.as(who.owner).query("insert into public.event_ship_offers (event_id, ship_id) values ($1, $2)", [eventId, own.id]);
  assert.equal((await fleet.rows("select ship_id from public.event_ship_offers where event_id = $1", [eventId])).length, 1);
  await change(who.owner, own.id, "in_claim = true");
  assert.deepEqual(await fleet.rows("select ship_id from public.event_ship_offers where event_id = $1", [eventId]), []);
  // The log has the claim, under the owner.
  const logged = await fleet.rows(
    "select new_row ->> 'in_claim' as in_claim, subject from public.audit_log where table_name = 'ships' and action = 'update' and (new_row ->> 'id')::uuid = $1 order by at desc limit 1",
    [own.id],
  );
  assert.deepEqual(logged, [{ in_claim: "true", subject: who.owner }]);
});

test("a discharge by command stands the leaver's ships down, in claim or not, and is not refused by the register", async () => {
  const leaver = await fleet.person("8", "Leaver");
  const ready = await register(leaver, { model_id: model.gladius, name: "Leaving ready" });
  const claimed = await register(leaver, { model_id: model["pisces-c8x"], name: "Leaving in claim" });
  assert.equal(await change(leaver, claimed.id, "in_claim = true"), 1);
  const eventId = (
    await fleet.as(who.command).one(
      "insert into public.events (kind, title, starts_at, commander_id) values ('patrol', 'Patrol 102', now() + interval '3 days', $1) returning id",
      [who.command],
    )
  ).id;
  await fleet.as(who.command).query("update public.events set state = 'announced' where id = $1", [eventId]);
  await fleet.as(leaver).query("insert into public.attendance (event_id, member_id, reply) values ($1, $2, 'attending')", [eventId, leaver]);
  await fleet.as(leaver).query("insert into public.event_ship_offers (event_id, ship_id) values ($1, $2)", [eventId, ready.id]);
  // Command, through the API rather than the database's own hand: the stand-down runs inside the status change.
  assert.equal(await fleet.as(who.command).changed("update public.members set status = 'discharged' where id = $1", [leaver]), 1);
  assert.deepEqual(await fleet.rows("select ship_id from public.event_ship_offers where event_id = $1", [eventId]), []);
  const stood = await ship(ready.id);
  assert.deepEqual([stood.ready, stood.in_claim], [false, false]);
  const kept = await ship(claimed.id);
  assert.deepEqual([kept.ready, kept.in_claim], [false, true]);
  // Command still corrects the leaver's entry without changing its owner: the owner is checked only when it changes.
  assert.equal(await change(who.command, ready.id, "name = 'Left behind'"), 1);
  await assert.rejects(change(who.command, ready.id, "owner_id = $2", [who.applicant]), /serving member/);
});
