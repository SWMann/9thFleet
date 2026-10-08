// Who takes part in an event: who it is open to, places and the reserve list,
// the units that take part, extra posts for the night and posts that must be filled.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const post = {};
const unit = {};

/** Draft an event as command, and return its id. */
const draft = async (fields = {}, as = who.command) => {
  const event = { kind: "training", title: "Drill", starts_at: "3 days", commander_id: who.command, ...fields };
  const names = Object.keys(event);
  const values = names.map((name, index) => (name === "starts_at" ? `now() + $${index + 1}::interval` : `$${index + 1}`));
  const row = await fleet.as(as).one(
    `insert into public.events (${names.join(", ")}) values (${values.join(", ")}) returning id`,
    Object.values(event),
  );
  return row.id;
};
const announce = (id, as = who.command) => fleet.as(as).query("update public.events set state = 'announced' where id = $1", [id]);
const announced = async (fields) => {
  const id = await draft(fields);
  await announce(id);
  return id;
};
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
const line = (id, member) =>
  fleet.one("select * from public.attendance where event_id = $1 and member_id = $2", [id, member]);
const placeOf = async (id, member) => (await line(id, member)).place;
const set = (as, id, member, fields) => {
  const names = Object.keys(fields);
  return fleet.as(as).query(
    `update public.attendance set ${names.map((name, index) => `${name} = $${index + 3}`).join(", ")} where event_id = $1 and member_id = $2`,
    [id, member, ...Object.values(fields)],
  );
};
const addPost = async (as, id, fields) => {
  const names = ["event_id", ...Object.keys(fields)];
  const row = await fleet.as(as).one(
    `insert into public.event_posts (${names.join(", ")}) values (${names.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    [id, ...Object.values(fields)],
  );
  return row.id;
};

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.command = await fleet.person("2", "Command", { roles: ["command"] });
  who.gunner = await fleet.person("3", "Gunner");
  who.helm = await fleet.person("4", "Helm");
  who.spare = await fleet.person("5", "Spare");
  who.other = await fleet.person("6", "Other");
  who.recruit = await fleet.person("7", "Recruit", { status: "recruit" });
  who.soldier = await fleet.person("8", "Soldier", { service: "army" });
  who.applicant = await fleet.applicant("9", "Applicant");

  post.gunner1 = await fleet.positionId("Training Ship", "Gunner 1");
  post.gunner2 = await fleet.positionId("Training Ship", "Gunner 2");
  post.helm = await fleet.positionId("Training Ship", "Helmsman");
  post.commander = await fleet.positionId("Fleet Command", "Fleet Commander");
  for (const name of ["Training Ship", "Fleet Command", "Task Force Jericho"]) {
    unit[name] = (await fleet.one("select id from public.units where name = $1", [name])).id;
  }
  for (const [member, position] of [[who.gunner, post.gunner1], [who.helm, post.helm]]) {
    await fleet.qualify(member, "radio-user", "navy-crew");
    await fleet.sql("insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')", [member, position]);
  }
});
after(() => fleet.close());

test("a visitor is refused the new tables, and an applicant sees nothing in them", async () => {
  const id = await announced();
  await fleet.as(who.command).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [id, unit["Training Ship"]]);
  for (const table of ["event_units", "event_key_posts", "event_posts"]) {
    await assert.rejects(fleet.visitor().query(`select * from public.${table}`), /permission denied/, table);
    assert.equal((await fleet.as(who.applicant).rows(`select * from public.${table}`)).length, 0, table);
  }
  assert.equal((await fleet.as(who.spare).rows("select 1 from public.event_units where event_id = $1", [id])).length, 1);
});

test("an event that is not open to recruits turns a recruit's reply down, and takes their apology", async () => {
  const id = await announced({ open_to_recruits: false });
  await assert.rejects(reply(who.recruit, id), /not open to recruits/);
  await reply(who.recruit, id, "not_attending");
  await reply(who.spare, id);
  assert.equal(await placeOf(id, who.spare), "in");
});

test("an event for one service turns the others down", async () => {
  const id = await announced({ open_to_service: "army" });
  await assert.rejects(reply(who.spare, id), /This event is for the Army\./);
  await reply(who.soldier, id);
  // Whoever is named to run it is always welcome, whatever they wear.
  await reply(who.command, id);
  assert.equal(await placeOf(id, who.command), "in");
});

test("an event that needs a qualification turns down a member without it", async () => {
  const crew = (await fleet.one("select id from public.qualifications where code = 'navy-crew'")).id;
  const id = await announced({ requires_qualification_id: crew });
  await assert.rejects(reply(who.spare, id), /This event needs the Navy crew qualification\./);
  await reply(who.gunner, id);
  // An observer who is named does not need it.
  await fleet.as(who.command).query("update public.events set observer_id = $2 where id = $1", [id, who.spare]);
  await reply(who.spare, id);
});

test("replies past the number of places go on the reserve list, in the order they arrive", async () => {
  const id = await announced({ places: 2 });
  for (const member of [who.gunner, who.helm, who.spare, who.other]) await reply(member, id);
  assert.deepEqual(
    await Promise.all([who.gunner, who.helm, who.spare, who.other].map((member) => placeOf(id, member))),
    ["in", "in", "reserve", "reserve"],
  );
  // Whoever is named to run the event always has a place, however late they reply.
  await reply(who.command, id);
  assert.equal(await placeOf(id, who.command), "in");
  // A member cannot give themselves a place, on the way in or afterwards.
  await assert.rejects(
    fleet.as(who.soldier).query("insert into public.attendance (event_id, member_id, reply, place) values ($1, $2, 'attending', 'in')", [id, who.soldier]),
    /permission denied/,
  );
  await assert.rejects(set(who.spare, id, who.spare, { place: "in" }), /Only the operation commander moves someone/);
  // Someone on the reserve list has no post for the night.
  await assert.rejects(set(who.spare, id, who.spare, { stand_in_position_id: post.gunner2 }), /no post until a place opens/);
});

test("a place that opens goes to the first on the reserve list, and coming back means the end of the list", async () => {
  const id = await announced({ places: 2 });
  for (const member of [who.gunner, who.helm, who.spare, who.other]) await reply(member, id);
  await reply(who.helm, id, "not_attending");
  assert.equal(await placeOf(id, who.helm), null);
  assert.equal(await placeOf(id, who.spare), "in", "the first on the list moves up");
  assert.equal(await placeOf(id, who.other), "reserve");

  await reply(who.helm, id);
  assert.equal(await placeOf(id, who.helm), "reserve");
  await reply(who.gunner, id, "not_attending");
  assert.equal(await placeOf(id, who.other), "in", "the one who has waited longest goes first");
  assert.equal(await placeOf(id, who.helm), "reserve");

  const logged = await fleet.rows(
    `select subject, new_row ->> 'place' as place from public.audit_log
     where table_name = 'attendance' and action = 'update' and (new_row ->> 'event_id')::uuid = $1
       and old_row ->> 'place' = 'reserve' order by id`,
    [id],
  );
  assert.deepEqual(logged, [{ subject: who.spare, place: "in" }, { subject: who.other, place: "in" }]);
});

test("whoever runs the event moves someone on or off the reserve list, and nobody else does", async () => {
  const id = await announced({ places: 1, commander_id: who.helm });
  for (const member of [who.gunner, who.spare, who.other]) await reply(member, id);
  // The commander makes room first. Nobody is moved up by that: who takes the place is theirs to say.
  await set(who.helm, id, who.gunner, { place: "reserve" });
  assert.deepEqual(
    await Promise.all([who.gunner, who.spare, who.other].map((member) => placeOf(id, member))),
    ["reserve", "reserve", "reserve"],
  );
  await set(who.helm, id, who.other, { place: "in" });
  // They may go past the number of places. That is their decision.
  await set(who.helm, id, who.spare, { place: "in" });
  assert.equal(await placeOf(id, who.spare), "in");
  assert.equal(await fleet.as(who.gunner).changed("update public.attendance set place = 'in' where event_id = $1 and member_id = $2", [id, who.other]), 0);
  await assert.rejects(set(who.helm, id, who.other, { place: null }), /Only a member who is attending has a place|check constraint/);
});

test("someone moved to the reserve list gives up the post they were in", async () => {
  const id = await announced();
  await reply(who.spare, id);
  await set(who.spare, id, who.spare, { stand_in_position_id: post.gunner2 });
  await set(who.command, id, who.spare, { place: "reserve" });
  const moved = await line(id, who.spare);
  assert.equal(moved.place, "reserve");
  assert.equal(moved.stand_in_position_id, null);
});

test("more places, or no limit, lets the reserve list in, and fewer takes no place away", async () => {
  const id = await announced({ places: 1 });
  for (const member of [who.gunner, who.helm, who.spare, who.other]) await reply(member, id);
  const places = () => Promise.all([who.gunner, who.helm, who.spare, who.other].map((member) => placeOf(id, member)));
  await fleet.as(who.command).query("update public.events set places = 2 where id = $1", [id]);
  assert.deepEqual(await places(), ["in", "in", "reserve", "reserve"]);
  await fleet.as(who.command).query("update public.events set places = 1 where id = $1", [id]);
  assert.deepEqual(await places(), ["in", "in", "reserve", "reserve"]);
  await fleet.as(who.command).query("update public.events set places = null where id = $1", [id]);
  assert.deepEqual(await places(), ["in", "in", "in", "in"]);
  await assert.rejects(fleet.as(who.command).query("update public.events set places = 0 where id = $1", [id]), /check constraint/);
});

test("with its units named, an event takes only their posts", async () => {
  const id = await draft();
  const add = (as, name) => fleet.as(as).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [id, unit[name]]);
  await assert.rejects(add(who.spare, "Fleet Command"), /row-level security/);
  await add(who.command, "Fleet Command");
  // A draft's units are seen only by the people working on it.
  assert.equal((await fleet.as(who.spare).rows("select 1 from public.event_units where event_id = $1", [id])).length, 0);
  await announce(id);
  for (const member of [who.gunner, who.spare]) await reply(member, id);

  await assert.rejects(set(who.spare, id, who.spare, { stand_in_position_id: post.gunner2 }), /not part of this event/);
  await assert.rejects(set(who.command, id, who.spare, { stand_in_position_id: post.gunner2 }), /not part of this event/);
  await set(who.command, id, who.spare, { stand_in_position_id: post.commander });

  // A unit brings everything under it.
  assert.equal((await fleet.one("select app.event_includes_position($1, $2) as yes", [id, post.gunner1])).yes, false);
  await add(who.command, "Task Force Jericho");
  assert.equal((await fleet.one("select app.event_includes_position($1, $2) as yes", [id, post.gunner1])).yes, true);
  assert.equal(await fleet.as(who.spare).changed("delete from public.event_units where event_id = $1", [id]), 0);
  assert.equal(await fleet.as(who.command).changed("delete from public.event_units where event_id = $1 and unit_id = $2", [id, unit["Task Force Jericho"]]), 1);
});

test("an extra post is filled by whoever runs the event, or taken by a volunteer if it is open to them", async () => {
  const id = await draft();
  const umpire = await addPost(who.command, id, { title: "Umpire", role_id: await fleet.roleId("gunner"), must_fill: true });
  const trainee = await addPost(who.command, id, { title: "Trainee 1", open_to_volunteers: true });
  await assert.rejects(addPost(who.spare, id, { title: "Hanger-on" }), /row-level security/);
  await assert.rejects(addPost(who.command, id, { title: "Umpire" }), /duplicate key/);
  await announce(id);
  for (const member of [who.gunner, who.spare, who.other]) await reply(member, id);

  await assert.rejects(set(who.spare, id, who.spare, { event_post_id: umpire }), /operation commander fills this post/);
  await set(who.spare, id, who.spare, { event_post_id: trainee });
  const taken = await line(id, who.spare);
  assert.equal(taken.event_post_id, trainee);
  assert.equal(taken.stand_in_set_by, who.spare);
  // One member for each post, and one post for each member.
  await assert.rejects(set(who.other, id, who.other, { event_post_id: trainee }), /duplicate key/);
  await assert.rejects(set(who.command, id, who.spare, { stand_in_position_id: post.gunner2 }), /attendance_one_post/);
  // Someone with a post of their own on the night keeps to it, unless they are moved.
  await set(who.spare, id, who.spare, { event_post_id: null });
  await assert.rejects(set(who.gunner, id, who.gunner, { event_post_id: trainee }), /post of your own/);
  await set(who.command, id, who.gunner, { event_post_id: umpire });
  assert.equal((await line(id, who.gunner)).stand_in_set_by, who.command);
  // Moved to the extra post, the gunner has left Gunner 1 empty for someone else.
  await set(who.command, id, who.other, { stand_in_position_id: post.gunner1 });

  // A post from another event cannot be used.
  const elsewhere = await announced();
  await reply(who.spare, elsewhere);
  await assert.rejects(set(who.command, elsewhere, who.spare, { event_post_id: trainee }), /not part of this event/);

  // Dropping out gives the post up, and removing the post takes its holder out of it.
  await reply(who.gunner, id, "not_attending");
  assert.equal((await line(id, who.gunner)).event_post_id, null);
  await set(who.spare, id, who.spare, { event_post_id: trainee });
  assert.equal(await fleet.as(who.spare).changed("delete from public.event_posts where id = $1", [trainee]), 0);
  assert.equal(await fleet.as(who.command).changed("delete from public.event_posts where id = $1", [trainee]), 1);
  assert.equal((await line(id, who.spare)).event_post_id, null);
});

test("a member whose own post is not part of the event is a spare hand", async () => {
  const id = await draft();
  await fleet.as(who.command).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [id, unit["Fleet Command"]]);
  const trainee = await addPost(who.command, id, { title: "Trainee 1", open_to_volunteers: true });
  await announce(id);
  await reply(who.gunner, id);
  await set(who.gunner, id, who.gunner, { event_post_id: trainee });
  assert.equal((await line(id, who.gunner)).event_post_id, trainee);
});

test("whoever runs an event says which posts must be filled", async () => {
  const id = await draft({ minimum_attending: 4 });
  const add = (as) => fleet.as(as).query("insert into public.event_key_posts (event_id, position_id) values ($1, $2)", [id, post.helm]);
  await assert.rejects(add(who.spare), /row-level security/);
  await add(who.command);
  await announce(id);
  assert.equal((await fleet.as(who.spare).rows("select 1 from public.event_key_posts where event_id = $1", [id])).length, 1);
  assert.equal((await fleet.as(who.spare).one("select minimum_attending from public.events where id = $1", [id])).minimum_attending, 4);
});

test("a copy carries who takes part, and nobody who was placed", async () => {
  const crew = (await fleet.one("select id from public.qualifications where code = 'navy-crew'")).id;
  const source = await draft({
    title: "Gunnery 001", open_to_recruits: false, open_to_service: "navy", requires_qualification_id: crew,
    places: 6, minimum_attending: 3, repeats_weekly: true,
  });
  await fleet.as(who.command).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [source, unit["Training Ship"]]);
  await fleet.as(who.command).query("insert into public.event_key_posts (event_id, position_id) values ($1, $2)", [source, post.helm]);
  const safety = await addPost(who.command, source, { title: "Range safety", must_fill: true, sort_order: 2 });
  await announce(source);
  await reply(who.gunner, source);
  await set(who.command, source, who.gunner, { event_post_id: safety });

  // Copied by hand.
  const copy = await draft({ title: "Gunnery 001 again", copied_from: source });
  const parts = async (id) => ({
    units: (await fleet.rows("select unit_id from public.event_units where event_id = $1", [id])).map((row) => row.unit_id),
    key: (await fleet.rows("select position_id from public.event_key_posts where event_id = $1", [id])).map((row) => row.position_id),
    posts: await fleet.rows("select title, must_fill, open_to_volunteers, sort_order from public.event_posts where event_id = $1", [id]),
  });
  const expected = {
    units: [unit["Training Ship"]],
    key: [post.helm],
    posts: [{ title: "Range safety", must_fill: true, open_to_volunteers: false, sort_order: 2 }],
  };
  assert.deepEqual(await parts(copy), expected);
  assert.equal((await fleet.rows("select 1 from public.attendance where event_id = $1", [copy])).length, 0);

  // And by the weekly repeat, which also carries the rules on who may come.
  await start(source);
  await fleet.as(who.command).query("update public.events set state = 'done' where id = $1", [source]);
  const next = await fleet.one(
    `select id, open_to_recruits, open_to_service, requires_qualification_id, places, minimum_attending
     from public.events where copied_from = $1 and repeats_weekly`,
    [source],
  );
  assert.deepEqual(
    { ...next, id: undefined },
    { id: undefined, open_to_recruits: false, open_to_service: "navy", requires_qualification_id: crew, places: 6, minimum_attending: 3 },
  );
  assert.deepEqual(await parts(next.id), expected);
});

test("who takes part is fixed once the event is closed, and goes with the event if it is deleted", async () => {
  const id = await draft();
  await fleet.as(who.command).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [id, unit["Training Ship"]]);
  const umpire = await addPost(who.command, id, { title: "Umpire" });
  await announce(id);
  await reply(who.spare, id);
  await set(who.command, id, who.spare, { event_post_id: umpire });
  await start(id);
  await fleet.as(who.command).query("update public.events set state = 'done' where id = $1", [id]);

  await assert.rejects(addPost(who.command, id, { title: "Latecomer" }), /This event is closed/);
  await assert.rejects(fleet.as(who.command).query("update public.event_posts set title = 'Referee' where id = $1", [umpire]), /This event is closed/);
  await assert.rejects(fleet.as(who.command).query("delete from public.event_units where event_id = $1", [id]), /This event is closed/);
  await assert.rejects(set(who.command, id, who.spare, { event_post_id: null }), /This event is closed/);
  await assert.rejects(
    fleet.as(who.command).query("update public.event_posts set event_id = $2 where id = $1", [umpire, await draft()]),
    /permission denied|cannot be moved/,
  );

  // An admin deletes an event made by mistake, and everything about it goes too.
  assert.equal(await fleet.as(who.admin).changed("delete from public.events where id = $1", [id]), 1);
  for (const table of ["event_units", "event_posts", "attendance"]) {
    assert.equal((await fleet.rows(`select 1 from public.${table} where event_id = $1`, [id])).length, 0, table);
  }
});

test("removing a unit or a post from the fleet takes it out of events without a fuss", async () => {
  const made = await fleet.one(
    "insert into public.units (parent_id, name, kind, opens_at_stage) values ($1, 'Spare Ship', 'ship', 1) returning id",
    [unit["Task Force Jericho"]],
  );
  const spot = await fleet.one(
    `insert into public.positions (unit_id, role_id, title, kind, nominal_grade, min_grade, max_grade, is_entry, opens_at_stage)
     values ($1, $2, 'Spare Gunner', 'primary', 'E2', 'E2', 'E4', true, 1) returning id`,
    [made.id, await fleet.roleId("gunner")],
  );
  const id = await draft();
  await fleet.as(who.command).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [id, made.id]);
  await fleet.as(who.command).query("insert into public.event_key_posts (event_id, position_id) values ($1, $2)", [id, spot.id]);
  await announce(id);
  await reply(who.spare, id);
  await set(who.spare, id, who.spare, { stand_in_position_id: spot.id });
  await start(id);
  await fleet.as(who.command).query("update public.events set state = 'done' where id = $1", [id]);

  // The event is closed, and the admin can still tidy the structure.
  assert.equal(await fleet.as(who.admin).changed("delete from public.positions where id = $1", [spot.id]), 1);
  assert.equal(await fleet.as(who.admin).changed("delete from public.units where id = $1", [made.id]), 1);
  assert.equal((await line(id, who.spare)).stand_in_position_id, null);
  assert.equal((await fleet.rows("select 1 from public.event_units where event_id = $1", [id])).length, 0);
});

test("who takes part is logged", async () => {
  const id = await draft();
  await fleet.as(who.command).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [id, unit["Training Ship"]]);
  await addPost(who.command, id, { title: "Umpire" });
  const logged = await fleet.rows(
    `select table_name, action, actor from public.audit_log
     where table_name in ('event_units', 'event_posts') and (new_row ->> 'event_id')::uuid = $1 order by id`,
    [id],
  );
  assert.deepEqual(logged, [
    { table_name: "event_units", action: "insert", actor: who.command },
    { table_name: "event_posts", action: "insert", actor: who.command },
  ]);
});
