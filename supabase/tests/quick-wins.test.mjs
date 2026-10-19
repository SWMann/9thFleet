// The calendar feed and its keys, the monthly returns, and the terms of
// secondary duties.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

/** A read of the feed the way a calendar app makes it: as nobody, with the key in a header. */
const feedWith = (key) =>
  fleet.db.transaction(async (tx) => {
    await tx.query("set local role anon");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    if (key !== undefined) await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-feed-key": key, accept: "text/calendar" })]);
    return (await tx.query("select id, title, kind_name, reply, state from public.calendar_feed order by starts_at")).rows;
  });
const myKey = (member) => fleet.as(member).one("select key, made_at from public.calendar_keys where member_id = $1", [member]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.other = await fleet.person("5", "Other");
  who.applicant = await fleet.applicant("6", "Applicant");
  who.discharged = await fleet.person("7", "Discharged", { status: "discharged" });
  await fleet.setStage(3);
});
after(() => fleet.close());

test("a serving member makes their own feed key, and only the database writes it", async () => {
  await fleet.as(who.member).query("insert into public.calendar_keys (member_id) values ($1)", [who.other]);
  const mine = await myKey(who.member);
  assert.match(mine.key, /^[0-9a-f]{64}$/, "the key is the database's, and the line is the member's own whatever they sent");
  assert.deepEqual(await fleet.as(who.other).rows("select key from public.calendar_keys"), []);
  await assert.rejects(fleet.as(who.member).query("insert into public.calendar_keys (member_id, key) values ($1, 'chosen')", [who.member]), /permission denied/);
  await assert.rejects(fleet.as(who.applicant).query("insert into public.calendar_keys (member_id) values ($1)", [who.applicant]), /row-level security|serving fleet/);
  await assert.rejects(fleet.as(who.discharged).query("insert into public.calendar_keys (member_id) values ($1)", [who.discharged]), /row-level security|serving fleet/);
  await assert.rejects(fleet.visitor().query("select key from public.calendar_keys"), /permission denied/);
  // A new key on request; the old one is gone.
  assert.equal(await fleet.as(who.member).changed("update public.calendar_keys set made_at = now() where member_id = $1", [who.member]), 1);
  const renewed = await myKey(who.member);
  assert.notEqual(renewed.key, mine.key);
  assert.ok(renewed.made_at >= mine.made_at);
  assert.equal(await fleet.as(who.other).changed("update public.calendar_keys set made_at = now() where member_id = $1", [who.member]), 0);
});

test("the feed sends a key's owner their events and their own replies, and nobody anything else", async () => {
  const patrol = await fleet.as(who.command).one("insert into public.events (kind, title, starts_at, commander_id) values ('patrol', 'Patrol 001', now() + interval '3 days', $1) returning id", [who.command]);
  await fleet.as(who.command).query("update public.events set state = 'announced' where id = $1", [patrol.id]);
  const draft = await fleet.as(who.command).one("insert into public.events (kind, title, starts_at, commander_id) values ('patrol', 'A draft', now() + interval '5 days', $1) returning id", [who.command]);
  const old = await fleet.as(who.command).one("insert into public.events (kind, title, starts_at, commander_id) values ('patrol', 'Long ago', now() - interval '100 days', $1) returning id", [who.command]);
  await fleet.sql("update public.events set state = 'announced', announced_at = now() - interval '101 days' where id = $1", [old.id]);
  await fleet.as(who.member).query("insert into public.attendance (event_id, member_id, reply) values ($1, $2, 'attending')", [patrol.id, who.member]);
  const key = (await myKey(who.member)).key;

  const feed = await feedWith(key);
  assert.deepEqual(
    feed.map((row) => [row.title, row.kind_name, row.reply, row.state]),
    [["Patrol 001", "Patrol", "attending", "announced"]],
    "the announced event, with the owner's reply; not the draft, and not an event more than 90 days gone",
  );
  assert.ok(!feed.some((row) => row.id === draft.id));
  assert.deepEqual(await feedWith(undefined), []);
  assert.deepEqual(await feedWith(""), []);
  assert.deepEqual(await feedWith("0".repeat(64)), []);
  // A reader's own condition is applied to the rows the key earns, never to the tables underneath, whatever plan is chosen.
  for (const plan of ["on", "off"]) {
    const probed = await fleet.db.transaction(async (tx) => {
      await tx.query(`set local enable_indexscan = ${plan}`);
      await tx.query(`set local enable_bitmapscan = ${plan}`);
      await tx.query("set local role anon");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      return (await tx.query("select id from public.calendar_feed where 1 / (case when title = 'Patrol 001' then 0 else 1 end) = 1")).rows;
    });
    assert.deepEqual(probed, [], `plan ${plan}`);
  }
  assert.deepEqual(await feedWith(key.toUpperCase()), []);
  // Another member's key sees the same event with their own reply, which is none.
  await fleet.as(who.other).query("insert into public.calendar_keys (member_id) values ($1)", [who.other]);
  assert.deepEqual((await feedWith((await myKey(who.other)).key)).map((row) => [row.title, row.reply]), [["Patrol 001", null]]);
  // A key whose owner has left earns nothing, and comes back with them.
  await fleet.sql("update public.members set status = 'discharged' where id = $1", [who.other]);
  assert.deepEqual(await feedWith((await fleet.one("select key from public.calendar_keys where member_id = $1", [who.other])).key), []);
  await fleet.sql("update public.members set status = 'member' where id = $1", [who.other]);
  // A cancelled event is still sent, marked, so a calendar can drop it.
  await fleet.as(who.command).query("update public.events set state = 'cancelled' where id = $1", [patrol.id]);
  assert.deepEqual((await feedWith(key)).map((row) => row.state), ["cancelled"]);
  // The view is read-only, and the feed is not a way in to anything else.
  await assert.rejects(fleet.visitor().query("insert into public.calendar_feed (id) values (gen_random_uuid())"), /permission denied|cannot insert/);
  await assert.rejects(fleet.visitor().query("select id from public.events"), /permission denied/);
});

test("the monthly return records the month just ended, from the record, and is command's to read", async () => {
  // Two members who joined months ago, one of whom left, as the record would show it.
  const joined = await fleet.person("20", "Joined Early");
  const gone = await fleet.person("21", "Left Since");
  await fleet.sql("update public.member_status_changes set changed_on = date '2026-07-10' where member_id in ($1, $2)", [joined, gone]);
  await fleet.sql("update public.members set status = 'discharged' where id = $1", [gone]);
  await fleet.sql("update public.member_status_changes set changed_on = date '2026-08-20' where member_id = $1 and status = 'discharged'", [gone]);
  // An event held in August, with two present.
  const held = await fleet.as(who.command).one("insert into public.events (kind, title, starts_at, commander_id) values ('patrol', 'August patrol', '2026-08-15 19:00+00', $1) returning id", [who.command]);
  await fleet.sql("update public.events set state = 'done', announced_at = '2026-08-01' where id = $1", [held.id]);
  await fleet.sql("insert into public.attendance_returns (event_id, member_id, returned, returned_by) values ($1, $2, 'present', $4), ($1, $3, 'present', $4)", [held.id, joined, who.member, who.command]);

  await fleet.sql("select app.record_monthly_return(date '2026-07-01')");
  await fleet.sql("select app.record_monthly_return(date '2026-08-01')");
  // Not a month that has not ended.
  await assert.rejects(fleet.sql("select app.record_monthly_return(current_date)"), /A return is for a month that has ended/);
  await assert.rejects(fleet.sql("select app.record_monthly_return(date '2030-06-01')"), /A return is for a month that has ended/);
  const july = await fleet.one("select * from public.fleet_returns where month = '2026-07-01'");
  const august = await fleet.one("select * from public.fleet_returns where month = '2026-08-01'");
  // Only the two back-dated members were in the fleet in July; the rest joined today.
  assert.equal(july.serving, 2);
  assert.equal(july.joined, 2);
  assert.equal(july.departed, 0);
  assert.equal(july.events_held, 0);
  assert.equal(august.serving, 1);
  assert.equal(august.departed, 1);
  assert.equal(august.events_held, 1);
  assert.equal(august.attendances, 2);
  // The register has no history, so an old month has no hull figures; the month just ended takes them now.
  assert.equal(august.hulls, null);
  const gladius = (await fleet.one("select id from public.ship_models where slug = 'gladius'")).id;
  await fleet.as(who.member).query("insert into public.ships (model_id, name) values ($1, 'Counted')", [gladius]);
  await fleet.sql("select app.record_monthly_return()");
  const lastMonth = await fleet.one("select * from public.fleet_returns order by month desc limit 1");
  assert.equal(lastMonth.hulls, 1);
  assert.equal(lastMonth.hulls_ready, 1);
  // Run again, the month just ended takes the register afresh; an older month keeps the figure it had.
  await fleet.sql("delete from public.ships where name = 'Counted'");
  await fleet.sql("select app.record_monthly_return()");
  assert.equal((await fleet.one("select hulls from public.fleet_returns order by month desc limit 1")).hulls, 0);
  await fleet.sql("update public.fleet_returns set hulls = 3, hulls_ready = 2 where month = '2026-08-01'");
  await fleet.sql("select app.record_monthly_return(date '2026-08-01')");
  assert.deepEqual(await fleet.one("select hulls, hulls_ready from public.fleet_returns where month = '2026-08-01'"), { hulls: 3, hulls_ready: 2 });
  // Command reads the returns; nobody writes them through the API.
  assert.ok((await fleet.as(who.command).rows("select month from public.fleet_returns")).length >= 3);
  assert.deepEqual(await fleet.as(who.member).rows("select month from public.fleet_returns"), []);
  await assert.rejects(fleet.as(who.command).query("insert into public.fleet_returns (month, serving, members, auxiliaries, recruits, reserve, joined, departed, events_held, attendances) values ('2020-01-01', 0, 0, 0, 0, 0, 0, 0, 0, 0)"), /permission denied/);
  await assert.rejects(fleet.as(who.command).query("select app.record_monthly_return()"), /permission denied/);
  await fleet.sql("delete from public.member_status_changes where member_id in ($1, $2)", [joined, gone]);
  await fleet.sql("delete from auth.users where id in ($1, $2)", [joined, gone]);
});

test("command renews a secondary duty on the day, and nothing else is renewed", async () => {
  await fleet.qualify(who.member, "induction", "radio-user", "navy-crew");
  await fleet.qualify(who.member, "instructor");
  const duty = await fleet.one("select p.id from public.positions p join public.units u on u.id = p.unit_id where p.kind = 'duty' and p.title = 'Instructor' and u.name = 'Fleet Staff'");
  assert.ok(duty, "the instructor duty, open from stage 1");
  const held = await fleet.as(who.command).one("insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'duty') returning id, started_on, renewed_on", [who.member, duty.id]);
  assert.equal(held.renewed_on, null);
  await assert.rejects(
    fleet.as(who.command).query("update public.assignments set renewed_on = current_date - 1 where id = $1", [held.id]),
    /A duty is renewed on the day it is renewed/,
  );
  await assert.rejects(fleet.as(who.command).query("update public.assignments set renewed_on = null where id = $1", [held.id]).then(() => fleet.as(who.command).query("update public.assignments set renewed_on = (now() at time zone 'utc')::date + 1 where id = $1", [held.id])), /renewed on the day/);
  assert.equal(await fleet.as(who.command).changed("update public.assignments set renewed_on = (now() at time zone 'utc')::date where id = $1", [held.id]), 1);
  assert.equal((await fleet.one("select renewed_on::text as day from public.assignments where id = $1", [held.id])).day, (await fleet.one("select (now() at time zone 'utc')::date::text as day")).day);
  // Not by the holder, not a post, not an ended duty. Command holding a duty does not renew their own.
  assert.equal(await fleet.as(who.member).changed("update public.assignments set renewed_on = (now() at time zone 'utc')::date where id = $1", [held.id]), 0);
  await fleet.qualify(who.command, "induction", "radio-user", "navy-crew", "instructor");
  const own = await fleet.one("select p.id from public.positions p join public.units u on u.id = p.unit_id where p.kind = 'duty' and p.title = 'Instructor' and u.name = 'Fleet Staff'");
  const theirs = await fleet.as(who.admin).one("insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'duty') returning id", [who.command, own.id]);
  await assert.rejects(fleet.as(who.command).query("update public.assignments set renewed_on = (now() at time zone 'utc')::date where id = $1", [theirs.id]), /You cannot renew your own duty/);
  assert.equal(await fleet.as(who.admin).changed("update public.assignments set renewed_on = (now() at time zone 'utc')::date where id = $1", [theirs.id]), 1);
  await fleet.sql("update public.assignments set ended_on = current_date where id = $1", [theirs.id]);
  const post = await fleet.one("select p.id from public.positions p where p.kind = 'primary' and p.is_entry and not exists (select 1 from public.assignments a where a.position_id = p.id and a.ended_on is null) limit 1");
  const primary = await fleet.as(who.command).one("insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary') returning id", [who.member, post.id]);
  await assert.rejects(fleet.as(who.command).query("update public.assignments set renewed_on = (now() at time zone 'utc')::date where id = $1", [primary.id]), /Only a secondary duty is renewed/);
  await fleet.as(who.command).query("update public.assignments set ended_on = current_date where id = $1", [held.id]);
  await assert.rejects(fleet.as(who.command).query("update public.assignments set renewed_on = (now() at time zone 'utc')::date where id = $1", [held.id]), /has ended/);
  // The SQL editor can put a date right.
  await fleet.sql("update public.assignments set renewed_on = started_on where id = $1", [held.id]);
});
