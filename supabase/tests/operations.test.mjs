// Events, their orders, the roll, stand-ins, the attendance return and the
// after-action report: who can see them and who can do what.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const post = {};

/** Draft an event as someone, and return its id. */
const draft = async (as, fields = {}) => {
  const event = {
    kind: "patrol",
    title: "Patrol 001",
    starts_at: "3 days",
    commander_id: who.admin,
    ...fields,
  };
  const row = await fleet.as(as).one(
    `insert into public.events (kind, title, starts_at, commander_id)
     values ($1, $2, now() + $3::interval, $4) returning id`,
    [event.kind, event.title, event.starts_at, event.commander_id],
  );
  return row.id;
};
const announce = (as, id) => fleet.as(as).query("update public.events set state = 'announced' where id = $1", [id]);
/** A patrol announced by command, three days out, so its roll is open. */
const announced = async (fields) => {
  const id = await draft(who.admin, fields);
  await announce(who.admin, id);
  return id;
};
// Time cannot be wound on, so the database owner moves the event instead.
const closeRoll = (id) =>
  fleet.sql(
    "update public.events set starts_at = now() + interval '10 hours', announced_at = now() - interval '3 days' where id = $1",
    [id],
  );
const start = (id) =>
  fleet.sql(
    "update public.events set starts_at = now() - interval '1 hour', announced_at = now() - interval '3 days' where id = $1",
    [id],
  );
const reply = (member, id, answer) =>
  fleet.as(member).query(
    `insert into public.attendance (event_id, member_id, reply) values ($1, $2, $3)
     on conflict (event_id, member_id) do update set reply = excluded.reply`,
    [id, member, answer],
  );
const line = (id, member) =>
  fleet.one("select * from public.attendance where event_id = $1 and member_id = $2", [id, member]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.instructor = await fleet.person("2", "Instructor", { roles: ["instructor"] });
  who.gunner = await fleet.person("3", "Gunner");
  who.helm = await fleet.person("4", "Helm");
  who.spare = await fleet.person("5", "Spare");
  who.auxiliary = await fleet.person("6", "Auxiliary", { status: "auxiliary" });
  who.second = await fleet.person("7", "Second");
  who.applicant = await fleet.applicant("8", "Applicant");

  post.gunner1 = await fleet.positionId("Training Ship", "Gunner 1");
  post.gunner2 = await fleet.positionId("Training Ship", "Gunner 2");
  post.helm = await fleet.positionId("Training Ship", "Helmsman");
  post.commander = await fleet.positionId("Fleet Command", "Fleet Commander");
  post.later = await fleet.positionId("Gunnery", "Turret Gunner 1");
  for (const [member, position] of [[who.gunner, post.gunner1], [who.helm, post.helm]]) {
    await fleet.qualify(member, "radio-user", "navy-crew");
    await fleet.sql("insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')", [member, position]);
  }
});
after(() => fleet.close());

test("a visitor is refused every table", async () => {
  for (const table of ["events", "event_orders", "attendance", "attendance_returns", "after_action_reports"]) {
    await assert.rejects(fleet.visitor().query(`select * from public.${table}`), /permission denied/, table);
  }
});

test("command drafts any event, an instructor drafts training, and nobody else drafts one", async () => {
  const id = await draft(who.admin, { kind: "strike", title: "Strike 001" });
  const event = await fleet.one("select * from public.events where id = $1", [id]);
  assert.equal(event.state, "draft");
  assert.equal(event.created_by, who.admin);
  assert.equal(event.roll_closes_at, null);
  assert.equal((await fleet.rows("select 1 from public.event_orders where event_id = $1", [id])).length, 1);

  await draft(who.instructor, { kind: "training", title: "Training Evolution 001", commander_id: who.instructor });
  await assert.rejects(draft(who.instructor, { kind: "strike" }), /row-level security/);
  await assert.rejects(draft(who.gunner, { kind: "training" }), /row-level security/);
  await assert.rejects(draft(who.applicant, { kind: "training" }), /row-level security/);
});

test("an event cannot be drafted as someone else, already announced, or without a serving commander", async () => {
  await assert.rejects(
    fleet.as(who.admin).query(
      "insert into public.events (kind, title, starts_at, commander_id, created_by) values ('patrol', 'Forged', now() + interval '3 days', $1, $2)",
      [who.admin, who.gunner],
    ),
    /permission denied/,
  );
  await assert.rejects(
    fleet.as(who.admin).query(
      "insert into public.events (kind, title, starts_at, commander_id, state) values ('patrol', 'Too soon', now() + interval '3 days', $1, 'announced')",
      [who.admin],
    ),
    /permission denied/,
  );
  await assert.rejects(draft(who.admin, { commander_id: who.applicant }), /must be serving members/);
  await assert.rejects(
    fleet.as(who.admin).query("insert into public.events (kind, title, starts_at) values ('patrol', 'Nobody', now() + interval '3 days')"),
    /needs an operation commander/,
  );
});

test("a draft is seen only by the people working on it", async () => {
  const id = await draft(who.instructor, { kind: "training", title: "Draft drill", commander_id: who.helm });
  const sees = async (member) => (await fleet.as(member).rows("select id from public.events where id = $1", [id])).length;
  assert.equal(await sees(who.instructor), 1, "its author");
  assert.equal(await sees(who.helm), 1, "its commander");
  assert.equal(await sees(who.admin), 1, "command");
  assert.equal(await sees(who.gunner), 0, "another member");
  assert.equal((await fleet.as(who.gunner).rows("select 1 from public.event_orders where event_id = $1", [id])).length, 0);

  await announce(who.instructor, id);
  assert.equal(await sees(who.gunner), 1);
  assert.equal(await sees(who.auxiliary), 1, "an auxiliary serves too");
  assert.equal(await sees(who.applicant), 0, "an applicant never sees events");
});

test("announcing stamps the time and sets when the roll closes", async () => {
  const id = await announced();
  const event = await fleet.one(
    `select announced_at is not null as stamped,
            roll_closes_at = starts_at - interval '24 hours' as a_day_before from public.events where id = $1`,
    [id],
  );
  assert.deepEqual(event, { stamped: true, a_day_before: true });

  // Announced with less than a day to go, the roll stays open until the start.
  const soon = await draft(who.admin, { kind: "response", title: "Response 001", starts_at: "6 hours" });
  await announce(who.admin, soon);
  assert.equal((await fleet.one("select roll_closes_at = starts_at as at_start from public.events where id = $1", [soon])).at_start, true);

  const past = await draft(who.admin, { title: "Too late" });
  await fleet.sql("update public.events set starts_at = now() - interval '1 hour' where id = $1", [past]);
  await assert.rejects(announce(who.admin, past), /announced before it starts/);
});

test("a member replies for themselves, can change their mind, and nobody replies for them", async () => {
  const id = await announced();
  await reply(who.gunner, id, "attending");
  assert.equal((await line(id, who.gunner)).reply, "attending");
  assert.ok((await line(id, who.gunner)).replied_at, "the database stamps the time");
  await reply(who.gunner, id, "not_attending");
  assert.equal((await line(id, who.gunner)).reply, "not_attending");

  await assert.rejects(
    fleet.as(who.helm).query("insert into public.attendance (event_id, member_id, reply) values ($1, $2, 'attending')", [id, who.gunner]),
    /Only the member can reply|row-level security/,
  );
  await assert.rejects(
    fleet.as(who.admin).query("update public.attendance set reply = 'attending' where event_id = $1 and member_id = $2", [id, who.gunner]),
    /Only the member can reply/,
  );
  await assert.rejects(
    fleet.as(who.gunner).query("update public.attendance set reply = null where event_id = $1 and member_id = $2", [id, who.gunner]),
    /cannot be taken back/,
  );
  await assert.rejects(
    fleet.as(who.gunner).query("update public.attendance set replied_at = now() - interval '1 year' where event_id = $1", [id]),
    /permission denied/,
  );
  await assert.rejects(reply(who.applicant, id, "attending"), /The roll is for serving members/);
});

test("the roll closes 24 hours before the start", async () => {
  const id = await announced();
  await reply(who.gunner, id, "attending");
  await closeRoll(id);
  await assert.rejects(reply(who.gunner, id, "not_attending"), /The roll has closed/);
  await assert.rejects(reply(who.helm, id, "attending"), /The roll has closed/);
  assert.equal((await line(id, who.gunner)).reply, "attending");
});

test("nobody replies to a draft or a cancelled event", async () => {
  const id = await draft(who.admin);
  await assert.rejects(reply(who.admin, id, "attending"), /has not been announced/);
  await announce(who.admin, id);
  await fleet.as(who.admin).query("update public.events set state = 'cancelled' where id = $1", [id]);
  await assert.rejects(reply(who.gunner, id, "attending"), /was cancelled/);
});

test("an attending member with no post of their own stands in for an empty entry post", async () => {
  const id = await announced();
  const standIn = (member, position) =>
    fleet.as(member).query("update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2", [id, member, position]);
  for (const member of [who.auxiliary, who.spare, who.gunner]) await reply(member, id, "attending");

  // Gunner 2 has no holder, so it is empty from the start.
  await standIn(who.auxiliary, post.gunner2);
  const taken = await line(id, who.auxiliary);
  assert.equal(taken.stand_in_position_id, post.gunner2);
  assert.equal(taken.stand_in_set_by, who.auxiliary);

  // One stand-in for each post.
  await assert.rejects(standIn(who.spare, post.gunner2), /duplicate key/);
  // Someone with a post of their own keeps to it.
  await assert.rejects(standIn(who.gunner, post.gunner2), /post of your own/);
  // A post whose holder is attending is not empty.
  await assert.rejects(standIn(who.spare, post.gunner1), /holder of that post is attending/);
  // A post that has not opened yet cannot be filled.
  await assert.rejects(standIn(who.spare, post.later), /not open yet/);

  // Stepping back out is the member's own choice.
  await standIn(who.auxiliary, null);
  assert.equal((await line(id, who.auxiliary)).stand_in_position_id, null);
});

test("a post whose holder has not replied opens to stand-ins when the roll closes", async () => {
  const id = await announced();
  await reply(who.spare, id, "attending");
  const take = () =>
    fleet.as(who.spare).query("update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2", [id, who.spare, post.gunner1]);
  await assert.rejects(take(), /has not replied/);
  await closeRoll(id);
  await take();
  assert.equal((await line(id, who.spare)).stand_in_position_id, post.gunner1);
});

test("leadership and key posts are filled by whoever runs the event", async () => {
  const id = await announced({ commander_id: who.second });
  for (const member of [who.spare, who.auxiliary]) await reply(member, id, "attending");
  await reply(who.helm, id, "not_attending");

  // The Helmsman on the training ship is an entry post, so use the one key post there is: the Fleet Commander's.
  await reply(who.admin, id, "not_attending");
  await assert.rejects(
    fleet.as(who.spare).query("update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2", [id, who.spare, post.commander]),
    /operation commander fills this post/,
  );
  // A member cannot place someone else: the rules hide the other member's line from the change.
  assert.equal(
    await fleet.as(who.spare).changed(
      "update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2",
      [id, who.auxiliary, post.helm],
    ),
    0,
  );

  // The operation commander places an attending member, and can do so before the roll closes.
  await fleet.as(who.second).query(
    "update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2",
    [id, who.spare, post.commander],
  );
  const placed = await line(id, who.spare);
  assert.equal(placed.stand_in_position_id, post.commander);
  assert.equal(placed.stand_in_set_by, who.second);

  // Stepping up: a member who holds a post is moved to a key post, and someone else fills the post they left.
  await reply(who.gunner, id, "attending");
  const place = (member, position) =>
    fleet.as(who.second).query(
      "update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2",
      [id, member, position],
    );
  await assert.rejects(place(who.auxiliary, post.gunner1), /holder of that post is attending/);
  await place(who.spare, null);
  await place(who.gunner, post.commander);
  await place(who.auxiliary, post.gunner1);
  assert.equal((await line(id, who.auxiliary)).stand_in_position_id, post.gunner1);
  await place(who.auxiliary, null);
  await place(who.gunner, null);
  await place(who.spare, post.commander);

  // Only someone who is attending can be placed.
  await assert.rejects(
    fleet.as(who.second).query("update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2", [id, who.helm, post.gunner2]),
    /Only a member who is attending/,
  );
  // Someone who drops out leaves the post they were standing in for.
  await reply(who.spare, id, "not_attending");
  assert.equal((await line(id, who.spare)).stand_in_position_id, null);
});

test("the attendance return is made by whoever ran the event, once it has started", async () => {
  const id = await announced({ commander_id: who.helm });
  await fleet.as(who.admin).query("update public.events set second_id = $2 where id = $1", [id, who.second]);
  await reply(who.gunner, id, "attending");
  const mark = (as, member, value) =>
    fleet.as(as).query(
      `insert into public.attendance_returns (event_id, member_id, returned) values ($1, $2, $3)
       on conflict (event_id, member_id) do update set returned = excluded.returned`,
      [id, member, value],
    );
  const returned = (member) =>
    fleet.one("select * from public.attendance_returns where event_id = $1 and member_id = $2", [id, member]);

  await assert.rejects(mark(who.helm, who.gunner, "present"), /once the event has started/);
  await start(id);
  await assert.rejects(mark(who.gunner, who.gunner, "present"), /whoever ran the event/);

  await mark(who.helm, who.gunner, "present");
  const marked = await returned(who.gunner);
  assert.equal(marked.returned, "present");
  assert.equal(marked.returned_by, who.helm);

  // Someone who never replied is still marked, and the second-in-command runs the event too.
  await mark(who.second, who.spare, "absent_without_notice");
  assert.equal((await returned(who.spare)).returned_by, who.second);
  // A correction is stamped with whoever made it.
  await mark(who.admin, who.spare, "absent_with_notice");
  assert.deepEqual(
    await fleet.one("select returned, returned_by from public.attendance_returns where event_id = $1 and member_id = $2", [id, who.spare]),
    { returned: "absent_with_notice", returned_by: who.admin },
  );
  await assert.rejects(
    fleet.as(who.helm).query("update public.attendance_returns set returned_by = $2 where event_id = $1", [id, who.gunner]),
    /permission denied/,
  );
  await assert.rejects(mark(who.helm, who.applicant, "present"), /The roll is for serving members/);
});

test("who was marked absent is not for the whole fleet", async () => {
  const id = await announced({ commander_id: who.helm });
  await start(id);
  for (const [member, value] of [[who.gunner, "present"], [who.spare, "absent_without_notice"]]) {
    await fleet.as(who.helm).query(
      "insert into public.attendance_returns (event_id, member_id, returned) values ($1, $2, $3)",
      [id, member, value],
    );
  }
  const sees = async (member) =>
    (await fleet.as(member).rows("select member_id from public.attendance_returns where event_id = $1 order by 1", [id]))
      .map((row) => row.member_id)
      .sort();
  assert.deepEqual(await sees(who.gunner), [who.gunner], "a member sees their own line");
  assert.deepEqual(await sees(who.auxiliary), [], "and nobody else's");
  assert.deepEqual(await sees(who.helm), [who.gunner, who.spare].sort(), "whoever ran the event sees it all");
  assert.deepEqual(await sees(who.admin), [who.gunner, who.spare].sort(), "and so do staff");
  assert.deepEqual(await sees(who.applicant), []);
});

test("an event is closed once it has started, and a closed event cannot change", async () => {
  const id = await announced({ commander_id: who.helm });
  const close = () => fleet.as(who.helm).query("update public.events set state = 'done' where id = $1", [id]);
  await assert.rejects(close(), /closed once it has started/);
  await start(id);
  await close();
  await assert.rejects(fleet.as(who.helm).query("update public.events set title = 'Rewritten' where id = $1", [id]), /This event is closed/);
  await assert.rejects(fleet.as(who.admin).query("update public.events set state = 'announced' where id = $1", [id]), /This event is closed/);
  await assert.rejects(
    fleet.as(who.helm).query("update public.event_orders set mission = 'Rewritten' where event_id = $1", [id]),
    /This event is closed/,
  );
  // The return can still be made or put right afterwards.
  await fleet.as(who.helm).query(
    "insert into public.attendance_returns (event_id, member_id, returned) values ($1, $2, 'present')",
    [id, who.helm],
  );
});

test("orders are written by whoever runs the event and read by the fleet", async () => {
  const id = await draft(who.instructor, { kind: "training", title: "Orders drill", commander_id: who.helm });
  const write = (as, text) =>
    fleet.as(as).changed("update public.event_orders set warning_order = $2 where event_id = $1", [id, text]);
  assert.equal(await write(who.instructor, "Drafted by the instructor."), 1, "the author, while it is a draft");
  assert.equal(await write(who.gunner, "Scribble."), 0);
  await announce(who.instructor, id);
  assert.equal(await write(who.instructor, "Too late."), 0, "the author no longer writes them once it is announced");
  assert.equal(await write(who.helm, "Gunnery on the training ship at 1930."), 1);
  assert.equal(await write(who.gunner, "Scribble."), 0);

  const read = await fleet.as(who.gunner).one("select warning_order, updated_by from public.event_orders where event_id = $1", [id]);
  assert.deepEqual(read, { warning_order: "Gunnery on the training ship at 1930.", updated_by: who.helm });
  assert.equal((await fleet.as(who.applicant).rows("select 1 from public.event_orders where event_id = $1", [id])).length, 0);
});

test("the type and the commander of an event are not anyone's to change", async () => {
  const id = await draft(who.instructor, { kind: "training", title: "Type drill", commander_id: who.helm });
  await assert.rejects(
    fleet.as(who.instructor).query("update public.events set kind = 'strike' where id = $1", [id]),
    /cannot turn this into that type/,
  );
  await announce(who.instructor, id);
  await assert.rejects(
    fleet.as(who.helm).query("update public.events set commander_id = $2 where id = $1", [id, who.gunner]),
    /Only command names a different operation commander|row-level security/,
  );
  await fleet.as(who.admin).query("update public.events set commander_id = $2 where id = $1", [id, who.gunner]);
  assert.equal(await fleet.as(who.spare).changed("update public.events set title = 'Hijacked' where id = $1", [id]), 0);
});

test("the after-action report is filed by whoever ran the event, and read by the fleet", async () => {
  const id = await announced({ commander_id: who.helm });
  const file = (as) =>
    fleet.as(as).query(
      "insert into public.after_action_reports (event_id, what_happened, to_keep, to_change) values ($1, 'Two contacts, no engagement.', 'Radio checks at muster.', 'Brief the fallback sooner.')",
      [id],
    );
  await assert.rejects(file(who.helm), /once the event has started/);
  await start(id);
  await assert.rejects(file(who.gunner), /row-level security/);
  await file(who.helm);

  const report = await fleet.as(who.gunner).one("select author_id, what_happened from public.after_action_reports where event_id = $1", [id]);
  assert.deepEqual(report, { author_id: who.helm, what_happened: "Two contacts, no engagement." });
  assert.equal((await fleet.as(who.applicant).rows("select 1 from public.after_action_reports")).length, 0);
  await assert.rejects(
    fleet.as(who.helm).query("update public.after_action_reports set author_id = $2 where event_id = $1", [id, who.gunner]),
    /permission denied/,
  );
});

test("only a draft can be deleted, by its author or command", async () => {
  const mine = await draft(who.instructor, { kind: "training", title: "Scrapped drill", commander_id: who.instructor });
  assert.equal(await fleet.as(who.gunner).changed("delete from public.events where id = $1", [mine]), 0);
  assert.equal(await fleet.as(who.instructor).changed("delete from public.events where id = $1", [mine]), 1);

  const live = await announced({ commander_id: who.helm });
  assert.equal(await fleet.as(who.helm).changed("delete from public.events where id = $1", [live]), 0, "an announced event is cancelled, not deleted");
  await fleet.as(who.helm).query("update public.events set state = 'cancelled' where id = $1", [live]);
  assert.equal((await fleet.one("select state from public.events where id = $1", [live])).state, "cancelled");
});

test("events and the roll are logged", async () => {
  const id = await announced();
  await reply(who.gunner, id, "attending");
  const logged = await fleet.rows(
    `select table_name, action from public.audit_log
     where (table_name = 'events' and (new_row ->> 'id')::uuid = $1)
        or (table_name = 'attendance' and (new_row ->> 'event_id')::uuid = $1)
     order by id`,
    [id],
  );
  assert.deepEqual(logged, [
    { table_name: "events", action: "insert" },
    { table_name: "events", action: "update" },
    { table_name: "attendance", action: "insert" },
  ]);
});
