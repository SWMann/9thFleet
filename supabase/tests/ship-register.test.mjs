// The ship register: members register their own hulls, command any; owners
// mark them ready; an attending owner offers ready ships for an event; the
// plan says what it needs by model; crew templates are command's.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const model = {};
let nextDiscordId = 100;
const fresh = (name, options) => fleet.person(String(nextDiscordId++), name, options);

const register = (actor, fields) => {
  const columns = Object.keys(fields);
  return fleet.as(actor).one(
    `insert into public.ships (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})
     returning id, model_id, owner_id, name, ready, ready_as_of, registered_by, registered_at`,
    Object.values(fields),
  );
};
const ship = (id) => fleet.one("select * from public.ships where id = $1", [id]);
const change = (actor, id, set, params = []) => fleet.as(actor).changed(`update public.ships set ${set} where id = $1`, [id, ...params]);
const offer = (actor, eventId, shipId) => fleet.as(actor).query("insert into public.event_ship_offers (event_id, ship_id) values ($1, $2)", [eventId, shipId]);
const offers = (eventId) => fleet.rows("select ship_id, member_id from public.event_ship_offers where event_id = $1 order by offered_at", [eventId]);

const announced = async (fields = {}) => {
  const row = await fleet.as(who.command).one(
    "insert into public.events (kind, title, starts_at, commander_id) values ('patrol', $1, now() + interval '3 days', $2) returning id",
    [fields.title ?? "Patrol 001", who.command],
  );
  await fleet.as(who.command).query("update public.events set state = 'announced' where id = $1", [row.id]);
  return row.id;
};
const attend = (member, eventId, reply = "attending") =>
  fleet.as(member).query(
    "insert into public.attendance (event_id, member_id, reply) values ($1, $2, $3) on conflict (event_id, member_id) do update set reply = excluded.reply",
    [eventId, member, reply],
  );

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.owner = await fleet.person("4", "Owner");
  who.other = await fleet.person("5", "Other");
  who.recruit = await fleet.person("6", "Recruit", { status: "recruit" });
  who.applicant = await fleet.applicant("7", "Applicant");
  who.discharged = await fleet.person("8", "Discharged", { status: "discharged" });
  for (const row of await fleet.rows("select id, slug from public.ship_models")) model[row.slug] = row.id;
  await fleet.setStage(3);
});
after(() => fleet.close());

test("the models and their crew templates are the fleet's to read, with the Idris crewed as Volume 1 says", async () => {
  const idris = await fleet.as(who.recruit).rows(
    `select r.slug, s.count from public.crew_template_stations s
     join public.crew_templates t on t.id = s.template_id and t.is_default
     join public.fleet_roles r on r.id = s.role_id
     where t.model_id = $1 order by s.sort_order`,
    [model["idris-m"]],
  );
  assert.equal(idris.reduce((sum, station) => sum + station.count, 0), 25);
  assert.deepEqual(idris.filter((station) => station.slug === "gunner").map((station) => station.count), [9]);
  assert.ok((await fleet.as(who.staff).rows("select id from public.ship_models")).length >= 60);
  assert.deepEqual(await fleet.as(who.applicant).rows("select id from public.ship_models"), []);
  await assert.rejects(fleet.visitor().query("select id from public.ship_models"), /permission denied/);
  await assert.rejects(fleet.visitor().query("select id from public.crew_templates"), /permission denied/);
});

test("an admin keeps the models; command keeps the templates and their stations", async () => {
  for (const actor of [who.owner, who.staff, who.command]) {
    await assert.rejects(fleet.as(actor).query("insert into public.ship_models (slug, name, kind, crew_min, crew_max) values ('made-up', 'Made Up', 'fighter', 1, 1)"), /row-level security/);
    assert.equal(await fleet.as(actor).changed("update public.ship_models set flyable = false where slug = 'gladius'"), 0);
  }
  const made = await fleet.as(who.admin).one("insert into public.ship_models (slug, name, kind, crew_min, crew_max, flyable) values ('perseus', 'Perseus', 'gunship', 2, 6, false) returning id");
  await assert.rejects(fleet.as(who.admin).query("insert into public.ship_models (slug, name, kind, crew_min, crew_max) values ('bad', 'Bad', 'fighter', 3, 2)"), /crew_max_check|ship_models_check/);

  const gunner = (await fleet.one("select id from public.fleet_roles where slug = 'gunner'")).id;
  for (const actor of [who.owner, who.staff]) {
    await assert.rejects(fleet.as(actor).query("insert into public.crew_templates (model_id, name) values ($1, 'Theirs')", [made.id]), /row-level security/);
  }
  const variant = await fleet.as(who.command).one("insert into public.crew_templates (model_id, name) values ($1, 'Army support') returning id", [made.id]);
  await fleet.as(who.command).query("insert into public.crew_template_stations (template_id, role_id, count) values ($1, $2, 4)", [variant.id, gunner]);
  assert.equal(await fleet.as(who.owner).changed("update public.crew_template_stations set count = 9 where template_id = $1", [variant.id]), 0);
  // One standard template for a model.
  await fleet.as(who.command).query("update public.crew_templates set is_default = true where id = $1", [variant.id]);
  await assert.rejects(
    fleet.as(who.command).query("insert into public.crew_templates (model_id, name, is_default) values ($1, 'Another', true)", [made.id]),
    /crew_templates_one_default/,
  );
  // A station stays with its template.
  const standard = (await fleet.one("select id from public.crew_templates where model_id = $1 and name = 'Standard'", [model.gladius])).id;
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_stations set template_id = $2 where template_id = $1", [variant.id, standard]), /permission denied|cannot be moved/);
  // The standard template stays while its model does; a variant can go.
  await assert.rejects(fleet.as(who.command).query("delete from public.crew_templates where id = $1", [variant.id]), /The standard template stays/);
  await fleet.as(who.command).query("update public.crew_templates set is_default = false where id = $1", [variant.id]);
  await fleet.as(who.command).query("update public.crew_templates set is_default = true where model_id = $1 and name = 'Standard'", [made.id]);
  assert.equal(await fleet.as(who.command).changed("delete from public.crew_templates where id = $1", [variant.id]), 1);
  await fleet.sql("delete from public.ship_models where id = $1", [made.id]);
  assert.deepEqual(await fleet.rows("select id from public.crew_templates where model_id = $1", [made.id]), []);
});

test("a serving member registers their own ship, names it and marks it ready; the database keeps the rest", async () => {
  const made = await register(who.owner, { model_id: model.gladius, name: "Kestrel" });
  assert.equal(made.owner_id, who.owner);
  assert.equal(made.registered_by, who.owner);
  assert.equal(made.ready, true);
  assert.ok(Date.now() - new Date(made.registered_at).getTime() < 60_000);
  // Registered as someone else's, it is still their own.
  const mine = await register(who.owner, { model_id: model.arrow, owner_id: who.other });
  assert.equal(mine.owner_id, who.owner);
  // Not a model that cannot be flown, and nobody outside the serving fleet.
  await fleet.sql("update public.ship_models set flyable = false where slug = 'nomad'");
  await assert.rejects(register(who.owner, { model_id: model.nomad }), /That model cannot be flown yet/);
  await fleet.sql("update public.ship_models set flyable = true where slug = 'nomad'");
  await assert.rejects(register(who.applicant, { model_id: model.gladius }), /row-level security|serving fleet/);
  await assert.rejects(register(who.discharged, { model_id: model.gladius }), /row-level security|serving fleet/);
  // A tidy name, with nothing hidden in it.
  await assert.rejects(register(who.owner, { model_id: model.gladius, name: " Untidy" }), /ships_name_check/);
  await assert.rejects(register(who.owner, { model_id: model.gladius, name: `Hid${String.fromCharCode(8203)}den` }), /ships_name_check/);
  // The owner changes the name and the mark, and the database dates the mark.
  const was = await ship(made.id);
  assert.equal(await change(who.owner, made.id, "name = 'Kestrel II', ready = false"), 1);
  const now = await ship(made.id);
  assert.equal(now.name, "Kestrel II");
  assert.equal(now.ready, false);
  assert.ok(now.ready_as_of > was.ready_as_of);
  assert.equal(await change(who.owner, made.id, "name = 'Kestrel III'"), 1);
  assert.equal((await ship(made.id)).ready_as_of.toISOString(), now.ready_as_of.toISOString(), "a rename does not move the mark");
  // Not its model or owner, and not by anyone else.
  assert.equal(await change(who.owner, made.id, "model_id = $2", [model.arrow]), 1);
  assert.equal((await ship(made.id)).model_id, model.gladius);
  assert.equal(await change(who.other, made.id, "name = 'Theirs'"), 0);
  assert.equal(await change(who.staff, made.id, "name = 'Theirs'"), 0);
  assert.equal(await fleet.as(who.other).changed("delete from public.ships where id = $1", [made.id]), 0);
  for (const column of ["registered_by", "registered_at", "ready_as_of", "updated_at"]) {
    await assert.rejects(change(who.owner, made.id, `${column} = null`), /permission denied/, column);
  }
  // The serving fleet reads the register; nobody else does.
  assert.equal((await fleet.as(who.recruit).rows("select id from public.ships")).length, 2);
  assert.deepEqual(await fleet.as(who.applicant).rows("select id from public.ships"), []);
  await assert.rejects(fleet.visitor().query("select id from public.ships"), /permission denied/);
  assert.equal(await fleet.as(who.owner).changed("delete from public.ships where id = $1", [mine.id]), 1);
});

test("command registers a hull for anyone or as the fleet's, and corrects any entry", async () => {
  const theirs = await register(who.command, { model_id: model.redeemer, owner_id: who.other, name: "Lent" });
  assert.equal(theirs.owner_id, who.other);
  assert.equal(theirs.registered_by, who.command);
  const fleets = await register(who.command, { model_id: model["idris-m"], name: "UEES Nexus" });
  assert.equal(fleets.owner_id, null);
  await assert.rejects(register(who.command, { model_id: model.gladius, owner_id: who.applicant }), /registered to a serving member, or to the fleet/);
  assert.equal(await change(who.command, theirs.id, "owner_id = $2, model_id = $3", [who.owner, model.valkyrie]), 1);
  const now = await ship(theirs.id);
  assert.deepEqual([now.owner_id, now.model_id], [who.owner, model.valkyrie]);
  assert.equal(await change(who.other, fleets.id, "name = 'Mine'"), 0);
  assert.equal(await change(who.command, fleets.id, "name = 'UEES Nexus (flag)'"), 1);
  await fleet.sql("delete from public.ships where id in ($1, $2)", [theirs.id, fleets.id]);
});

test("a note on a ship is the owner's and command's", async () => {
  const made = await register(who.owner, { model_id: model.gladius, name: "Noted" });
  await fleet.as(who.owner).query("insert into public.ship_notes (ship_id, note) values ($1, 'Kept at Area18. Missing a shield.')", [made.id]);
  for (const reader of [who.owner, who.command, who.admin]) {
    assert.equal((await fleet.as(reader).rows("select note from public.ship_notes where ship_id = $1", [made.id])).length, 1);
  }
  for (const reader of [who.other, who.staff, who.recruit]) {
    assert.deepEqual(await fleet.as(reader).rows("select note from public.ship_notes where ship_id = $1", [made.id]), []);
  }
  // Someone else's note is not theirs to change, and nobody writes one on another's ship.
  assert.equal(await fleet.as(who.other).changed("update public.ship_notes set note = 'x' where ship_id = $1", [made.id]), 0);
  const unowned = await register(who.other, { model_id: model.arrow });
  await fleet.as(who.other).query("insert into public.ship_notes (ship_id, note) values ($1, 'Theirs')", [unowned.id]);
  await assert.rejects(fleet.as(who.other).query("update public.ship_notes set ship_id = $2 where ship_id = $1", [unowned.id, made.id]), /A note stays with its ship/);
  await assert.rejects(fleet.as(who.recruit).query("insert into public.ship_notes (ship_id, note) values ($1, 'Not mine')", [made.id]), /Only the owner or command writes a note/);
  assert.equal(await fleet.as(who.command).changed("update public.ship_notes set note = 'Command says: fit the shield.' where ship_id = $1", [made.id]), 1);
  // The log records that a note was written, not what it said, under the owner.
  const logged = await fleet.rows("select subject, new_row from public.audit_log where table_name = 'ship_notes' and coalesce(new_row ->> 'ship_id', old_row ->> 'ship_id') = $1 order by id", [made.id]);
  assert.ok(logged.length >= 2);
  for (const line of logged) {
    assert.equal(line.subject, who.owner);
    assert.equal(line.new_row?.note, undefined);
  }
  // The note goes with the ship.
  await fleet.as(who.owner).query("delete from public.ships where id = $1", [made.id]);
  assert.deepEqual(await fleet.rows("select note from public.ship_notes where ship_id = $1", [made.id]), []);
});

test("an attending owner offers ready ships until the roll closes, and command the fleet's", async () => {
  const eventId = await announced({ title: "Patrol 002" });
  const own = await register(who.owner, { model_id: model.gladius, name: "Offered" });
  const theirs = await register(who.other, { model_id: model.arrow });
  const fleets = await register(who.command, { model_id: model.hammerhead, name: "The fleet's" });
  await assert.rejects(offer(who.owner, eventId, own.id), /Reply that you are attending before offering a ship/);
  await attend(who.owner, eventId);
  await offer(who.owner, eventId, own.id);
  await assert.rejects(offer(who.owner, eventId, own.id), /duplicate key/);
  await assert.rejects(offer(who.owner, eventId, theirs.id), /You offer your own ships/);
  await assert.rejects(offer(who.owner, eventId, fleets.id), /You offer your own ships/);
  // The fleet's hull is offered by command, attending or not, and stays when that officer is not coming.
  await offer(who.command, eventId, fleets.id);
  await attend(who.command, eventId, "not_attending");
  assert.ok((await offers(eventId)).some((line) => line.ship_id === fleets.id));
  // Not a ship that is not ready, and nobody outside the roll.
  await fleet.sql("update public.ships set ready = false where id = $1", [theirs.id]);
  await attend(who.other, eventId);
  await assert.rejects(offer(who.other, eventId, theirs.id), /That ship is not marked ready/);
  await assert.rejects(offer(who.applicant, eventId, own.id), /The roll is for serving members/);
  // Who offered, and when, is the database's.
  await assert.rejects(fleet.as(who.owner).query("insert into public.event_ship_offers (event_id, ship_id, member_id) values ($1, $2, $3)", [eventId, own.id, who.other]), /permission denied/);
  await assert.rejects(fleet.as(who.owner).query("update public.event_ship_offers set offered_at = now() where ship_id = $1", [own.id]), /permission denied/);
  assert.deepEqual(
    (await offers(eventId)).map((line) => [line.ship_id, line.member_id]),
    [
      [own.id, who.owner],
      [fleets.id, who.command],
    ],
  );
  // The fleet reads what is offered. An applicant does not.
  assert.equal((await fleet.as(who.recruit).rows("select ship_id from public.event_ship_offers where event_id = $1", [eventId])).length, 2);
  assert.deepEqual(await fleet.as(who.applicant).rows("select ship_id from public.event_ship_offers where event_id = $1", [eventId]), []);
  // Whoever offered withdraws, or command does; nobody else.
  assert.equal(await fleet.as(who.other).changed("delete from public.event_ship_offers where event_id = $1 and ship_id = $2", [eventId, own.id]), 0);
  assert.equal(await fleet.as(who.owner).changed("delete from public.event_ship_offers where event_id = $1 and ship_id = $2", [eventId, own.id]), 1);
  await offer(who.owner, eventId, own.id);
  assert.equal(await fleet.as(who.command).changed("delete from public.event_ship_offers where event_id = $1 and ship_id = $2", [eventId, own.id]), 1);
  await offer(who.owner, eventId, own.id);
  // Once the roll closes, nothing is offered or withdrawn by a member. The closing time follows the start.
  await fleet.sql("update public.events set starts_at = now() - interval '1 minute' where id = $1", [eventId]);
  assert.ok((await fleet.one("select roll_closes_at < now() as closed from public.events where id = $1", [eventId])).closed);
  await assert.rejects(offer(who.command, eventId, fleets.id), /The roll has closed/);
  await assert.rejects(fleet.as(who.owner).query("delete from public.event_ship_offers where event_id = $1 and ship_id = $2", [eventId, own.id]), /The roll has closed/);
  assert.equal(await fleet.as(who.command).changed("delete from public.event_ship_offers where event_id = $1 and ship_id = $2", [eventId, fleets.id]), 1);
});

test("an offer goes when the owner is no longer attending, or the ship no longer ready while the roll is open", async () => {
  const eventId = await announced({ title: "Patrol 003" });
  const later = await announced({ title: "Patrol 004" });
  const own = await register(who.owner, { model_id: model.gladius, name: "Fickle" });
  await attend(who.owner, eventId);
  await attend(who.owner, later);
  await offer(who.owner, eventId, own.id);
  await offer(who.owner, later, own.id);
  await attend(who.owner, eventId, "not_attending");
  assert.deepEqual(await offers(eventId), []);
  assert.equal((await offers(later)).length, 1);
  // The ship is marked not ready: it is withdrawn from what is still to come.
  await change(who.owner, own.id, "ready = false");
  assert.deepEqual(await offers(later), []);
  // Marked ready again, it is not offered again by itself.
  await change(who.owner, own.id, "ready = true");
  assert.deepEqual(await offers(later), []);
  // The owner's line on the roll removed (as when they are named to the opposing force) withdraws it too.
  await attend(who.owner, later);
  await offer(who.owner, later, own.id);
  await fleet.sql("delete from public.attendance where event_id = $1 and member_id = $2", [later, who.owner]);
  assert.deepEqual(await offers(later), []);
  // Given to another owner, it is withdrawn: the new owner offers it themselves.
  await attend(who.owner, later);
  await offer(who.owner, later, own.id);
  await change(who.command, own.id, "owner_id = $2", [who.other]);
  assert.deepEqual(await offers(later), []);
  await change(who.command, own.id, "owner_id = $2", [who.owner]);
  // Once the roll has closed the offer stands: the ship is counted on, and shown as not ready.
  const soon = await announced({ title: "Patrol 005" });
  await attend(who.owner, soon);
  await offer(who.owner, soon, own.id);
  await fleet.sql("update public.events set starts_at = now() + interval '20 hours', announced_at = now() - interval '2 days' where id = $1", [soon]);
  assert.ok((await fleet.one("select now() >= roll_closes_at as closed from public.events where id = $1", [soon])).closed);
  await change(who.owner, own.id, "ready = false");
  assert.equal((await offers(soon)).length, 1);
  await assert.rejects(fleet.as(who.owner).query("delete from public.ships where id = $1", [own.id]), /It is offered for Patrol 005, whose roll has closed/);
  // Command may still take it off, and the offer goes with it.
  assert.equal(await fleet.as(who.command).changed("delete from public.ships where id = $1", [own.id]), 1);
  assert.deepEqual(await offers(soon), []);
  // A past event keeps its record. The ship was there.
  const past = await announced({ title: "Patrol 009" });
  const kept = await register(who.owner, { model_id: model.gladius, name: "Was there" });
  await attend(who.owner, past);
  await offer(who.owner, past, kept.id);
  await fleet.sql("update public.events set starts_at = now() - interval '1 day' where id = $1", [past]);
  await change(who.owner, kept.id, "ready = false");
  assert.equal((await offers(past)).length, 1);
  assert.equal(await fleet.as(who.owner).changed("delete from public.ships where id = $1", [kept.id]), 1);
});

test("a member who leaves the serving fleet brings nothing: their ships stand down and their offers go", async () => {
  const leaver = await fresh("Leaver Two");
  const made = await register(leaver, { model_id: model.gladius, name: "Standing down" });
  const eventId = await announced({ title: "Patrol 010" });
  await attend(leaver, eventId);
  await offer(leaver, eventId, made.id);
  await fleet.sql("update public.members set status = 'discharged' where id = $1", [leaver]);
  assert.deepEqual(await offers(eventId), []);
  assert.equal((await ship(made.id)).ready, false);
  // Back in the fleet, the ship is still theirs to mark ready again.
  await fleet.sql("update public.members set status = 'member' where id = $1", [leaver]);
  assert.equal(await change(leaver, made.id, "ready = true"), 1);
});

test("the plan names what it needs by model and count, and a copy carries it", async () => {
  const eventId = (await fleet.as(who.command).one("insert into public.events (kind, title, starts_at, commander_id) values ('patrol', 'Patrol 006', now() + interval '3 days', $1) returning id", [who.command])).id;
  const wanted = await fleet.as(who.command).one(
    "insert into public.event_ships (event_id, model_id, count, note) values ($1, $2, 2, 'Top cover') returning id, ship, model_id, count",
    [eventId, model.gladius],
  );
  assert.deepEqual([wanted.ship, wanted.count], ["Gladius", 2]);
  // Changing the model renames it. Free text still works for what the list lacks.
  await fleet.as(who.command).query("update public.event_ships set model_id = $2 where id = $1", [wanted.id, model.arrow]);
  assert.equal((await fleet.one("select ship from public.event_ships where id = $1", [wanted.id])).ship, "Arrow");
  const typed = await fleet.as(who.command).one("insert into public.event_ships (event_id, ship) values ($1, 'A borrowed Javelin') returning ship, model_id, count", [eventId]);
  assert.deepEqual([typed.ship, typed.model_id, typed.count], ["A borrowed Javelin", null, 1]);
  await assert.rejects(fleet.as(who.command).query("insert into public.event_ships (event_id, model_id, count) values ($1, $2, 0)", [eventId, model.gladius]), /event_ships_count_check/);
  // A model renamed renames the plan lines that picked it.
  await fleet.as(who.admin).query("update public.ship_models set name = 'Arrow Mk II' where id = $1", [model.arrow]);
  assert.equal((await fleet.one("select ship from public.event_ships where id = $1", [wanted.id])).ship, "Arrow Mk II");
  await fleet.as(who.admin).query("update public.ship_models set name = 'Arrow' where id = $1", [model.arrow]);
  await assert.rejects(fleet.as(who.command).query("insert into public.event_ships (event_id, model_id) values ($1, $2)", [eventId, who.owner]), /There is no such model|foreign key/);

  const copy = await fleet.as(who.command).one(
    "insert into public.events (kind, title, starts_at, commander_id, copied_from) values ('patrol', 'Patrol 007', now() + interval '10 days', $1, $2) returning id",
    [who.command, eventId],
  );
  const carried = await fleet.rows("select ship, model_id, count from public.event_ships where event_id = $1 order by sort_order, ship", [copy.id]);
  assert.deepEqual(
    carried.map((row) => [row.ship, row.model_id, row.count]),
    [
      ["A borrowed Javelin", null, 1],
      ["Arrow", model.arrow, 2],
    ],
  );
});

test("deleting a member takes their ships and offers with them, and the log keeps nothing of them", async () => {
  const leaver = await fresh("Leaver");
  const made = await register(leaver, { model_id: model.gladius, name: "Gone" });
  await fleet.as(leaver).query("insert into public.ship_notes (ship_id, note) values ($1, 'Mine')", [made.id]);
  const eventId = await announced({ title: "Patrol 008" });
  await attend(leaver, eventId);
  await offer(leaver, eventId, made.id);
  await fleet.sql("delete from auth.users where id = $1", [leaver]);
  assert.deepEqual(await fleet.rows("select id from public.ships where id = $1", [made.id]), []);
  assert.deepEqual(await offers(eventId), []);
  const kept = await fleet.rows("select old_row, new_row from public.audit_log where subject = $1", [leaver]);
  assert.ok(kept.length > 0);
  assert.ok(kept.every((line) => line.old_row === null && line.new_row === null));
  // A model in use cannot be removed; one nobody has registered can.
  await assert.rejects(fleet.sql("delete from public.ship_models where slug = 'gladius'"), /foreign key/);
});
