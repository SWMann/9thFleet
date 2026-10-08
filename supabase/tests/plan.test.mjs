// Fuller orders: objectives, elements and their tasks, the timeline, ships,
// nets, amendments and their acknowledgement.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

const PARTS = {
  event_objectives: { title: "Hold the lane for one hour" },
  event_elements: { name: "UEES Nexus", callsign: "Anvil", task: "Screen the convoy." },
  event_timings: { offset_minutes: -15, label: "Muster" },
  event_ships: { ship: "Hammerhead", note: "Flagship" },
  event_nets: { name: "Command", purpose: "Orders and reports", controller: "Zero" },
};

const draft = async (fields = {}, as = who.command) => {
  const event = { kind: "patrol", title: "Patrol 010", starts_at: "3 days", commander_id: who.helm, ...fields };
  const names = Object.keys(event);
  const values = names.map((name, index) => (name === "starts_at" ? `now() + $${index + 1}::interval` : `$${index + 1}`));
  const row = await fleet.as(as).one(
    `insert into public.events (${names.join(", ")}) values (${values.join(", ")}) returning id`,
    Object.values(event),
  );
  return row.id;
};
const announce = (id, as = who.command) => fleet.as(as).query("update public.events set state = 'announced' where id = $1", [id]);
const start = (id) =>
  fleet.sql(
    "update public.events set starts_at = now() - interval '1 hour', announced_at = now() - interval '3 days' where id = $1",
    [id],
  );
const add = (as, table, id, fields = PARTS[table]) => {
  const names = ["event_id", ...Object.keys(fields)];
  return fleet.as(as).one(
    `insert into public.${table} (${names.join(", ")}) values (${names.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
    [id, ...Object.values(fields)],
  );
};
const reply = (member, id, answer = "attending") =>
  fleet.as(member).query(
    `insert into public.attendance (event_id, member_id, reply) values ($1, $2, $3)
     on conflict (event_id, member_id) do update set reply = excluded.reply`,
    [id, member, answer],
  );
const amend = (as, id, body) =>
  fleet.as(as).one("insert into public.event_amendments (event_id, body) values ($1, $2) returning *", [id, body]);
const acknowledge = (member, id, number = 1) =>
  fleet.as(member).query(
    `insert into public.event_acknowledgements (event_id, member_id, amendment_number) values ($1, $2, $3)
     on conflict (event_id, member_id) do update set amendment_number = excluded.amendment_number`,
    [id, member, number],
  );

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.command = await fleet.person("2", "Command", { roles: ["command"] });
  who.instructor = await fleet.person("3", "Instructor", { roles: ["instructor"] });
  who.helm = await fleet.person("4", "Helm");
  who.gunner = await fleet.person("5", "Gunner");
  who.spare = await fleet.person("6", "Spare");
  who.applicant = await fleet.applicant("7", "Applicant");
});
after(() => fleet.close());

test("a visitor is refused the plan, and an applicant sees none of it", async () => {
  const id = await draft();
  for (const table of Object.keys(PARTS)) await add(who.command, table, id);
  await announce(id);
  await amend(who.helm, id, "Start moved to 2000.");
  for (const table of [...Object.keys(PARTS), "event_amendments", "event_acknowledgements"]) {
    await assert.rejects(fleet.visitor().query(`select * from public.${table}`), /permission denied/, table);
    assert.equal((await fleet.as(who.applicant).rows(`select * from public.${table}`)).length, 0, table);
  }
  for (const table of [...Object.keys(PARTS), "event_amendments"]) {
    assert.equal((await fleet.as(who.spare).rows(`select 1 from public.${table} where event_id = $1`, [id])).length, 1, table);
  }
});

test("the plan is written by whoever may write the orders, and a draft's plan is seen only by them", async () => {
  const id = await draft({ kind: "training", commander_id: who.helm }, who.instructor);
  for (const table of Object.keys(PARTS)) {
    await add(who.instructor, table, id);
    await assert.rejects(add(who.gunner, table, id, { ...PARTS[table], [Object.keys(PARTS[table])[0]]: table === "event_timings" ? 30 : "Another one" }), /row-level security/, table);
    assert.equal((await fleet.as(who.gunner).rows(`select 1 from public.${table} where event_id = $1`, [id])).length, 0, table);
    assert.equal((await fleet.as(who.helm).rows(`select 1 from public.${table} where event_id = $1`, [id])).length, 1, `${table}, to its commander`);
  }
  await announce(id, who.instructor);
  // Once it is announced its author no longer writes it. Whoever runs it does.
  assert.equal(await fleet.as(who.instructor).changed("update public.event_elements set task = 'Changed.' where event_id = $1", [id]), 0);
  assert.equal(await fleet.as(who.helm).changed("update public.event_elements set task = 'Lead the drill.' where event_id = $1", [id]), 1);
  assert.equal(await fleet.as(who.gunner).changed("delete from public.event_objectives where event_id = $1", [id]), 0);
  assert.equal(await fleet.as(who.helm).changed("delete from public.event_objectives where event_id = $1", [id]), 1);
});

test("the plan keeps to its limits", async () => {
  const id = await draft();
  await assert.rejects(add(who.command, "event_timings", id, { offset_minutes: 2000, label: "Too late" }), /check constraint/);
  await add(who.command, "event_elements", id);
  await assert.rejects(add(who.command, "event_elements", id), /duplicate key/);
  await add(who.command, "event_nets", id);
  await assert.rejects(add(who.command, "event_nets", id), /duplicate key/);
  await assert.rejects(add(who.command, "event_objectives", id, { title: " " }), /check constraint/);
  const many = Array.from({ length: 13 }, (_, index) => `command/section-${index}`);
  await assert.rejects(fleet.as(who.command).query("update public.events set reading = $2 where id = $1", [id, many]), /check constraint/);
  await fleet.as(who.command).query(
    "update public.events set reading = $2, muster_at = 'Baijini Point, pad 04', area = 'ArcCorp to microTech' where id = $1",
    [id, ["command/orders", "organisation/navy-squadron"]],
  );
  const event = await fleet.as(who.helm).one("select reading, muster_at, area from public.events where id = $1", [id]);
  assert.deepEqual(event, { reading: ["command/orders", "organisation/navy-squadron"], muster_at: "Baijini Point, pad 04", area: "ArcCorp to microTech" });
});

test("the plan is fixed once the event is closed", async () => {
  const id = await draft();
  const made = {};
  for (const table of Object.keys(PARTS)) made[table] = (await add(who.command, table, id)).id;
  await announce(id);
  await start(id);
  await fleet.as(who.helm).query("update public.events set state = 'done' where id = $1", [id]);
  for (const table of Object.keys(PARTS)) {
    const field = Object.keys(PARTS[table])[0];
    await assert.rejects(add(who.helm, table, id, { ...PARTS[table], [field]: table === "event_timings" ? 45 : "After the fact" }), /This event is closed/, table);
    await assert.rejects(fleet.as(who.helm).query(`delete from public.${table} where id = $1`, [made[table]]), /This event is closed/, table);
  }
  await assert.rejects(amend(who.helm, id, "Too late."), /announced and is not yet closed/);
});

test("an amendment is issued by whoever runs an announced event, and the database numbers and signs it", async () => {
  const id = await draft();
  await assert.rejects(amend(who.command, id, "A draft is simply changed."), /announced and is not yet closed/);
  await announce(id);
  await assert.rejects(amend(who.gunner, id, "Not mine to issue."), /row-level security/);

  const first = await amend(who.helm, id, "Start moved to 2000 UTC.");
  assert.equal(first.number, 1);
  assert.equal(first.issued_by, who.helm);
  assert.ok(first.issued_at);
  const second = await amend(who.command, id, "Muster at pad 06, not pad 04.");
  assert.equal(second.number, 2);

  // Its number, its date and its signature are not the writer's to give, and it is never rewritten.
  await assert.rejects(
    fleet.as(who.helm).query("insert into public.event_amendments (event_id, body, number) values ($1, 'Forged', 9)", [id]),
    /permission denied/,
  );
  await assert.rejects(
    fleet.as(who.helm).query("insert into public.event_amendments (event_id, body, issued_by) values ($1, 'Forged', $2)", [id, who.command]),
    /permission denied/,
  );
  await assert.rejects(fleet.as(who.helm).query("update public.event_amendments set body = 'Rewritten' where id = $1", [first.id]), /permission denied/);
  assert.equal(await fleet.as(who.helm).changed("delete from public.event_amendments where id = $1", [first.id]), 0);
  await assert.rejects(amend(who.helm, id, ""), /check constraint/);
  // An admin removes one issued by mistake.
  assert.equal(await fleet.as(who.admin).changed("delete from public.event_amendments where id = $1", [second.id]), 1);
});

test("a member who is attending acknowledges the latest amendment, for themselves", async () => {
  const id = await draft();
  await announce(id);
  await reply(who.gunner, id);
  await reply(who.spare, id, "not_attending");
  await assert.rejects(acknowledge(who.gunner, id), /no amendment to acknowledge/);

  await amend(who.helm, id, "Start moved to 2000 UTC.");
  await amend(who.helm, id, "Weapons tight throughout.");
  // Whatever number is sent, it is the latest that is acknowledged, and the database says when.
  await acknowledge(who.gunner, id, 1);
  const line = await fleet.one("select amendment_number, acknowledged_at from public.event_acknowledgements where event_id = $1 and member_id = $2", [id, who.gunner]);
  assert.equal(line.amendment_number, 2);
  assert.ok(line.acknowledged_at);

  await assert.rejects(acknowledge(who.spare, id), /Only a member who is attending/);
  await assert.rejects(
    fleet.as(who.helm).query("insert into public.event_acknowledgements (event_id, member_id, amendment_number) values ($1, $2, 2)", [id, who.spare]),
    /row-level security|Only the member/,
  );
  await assert.rejects(
    fleet.as(who.gunner).query("update public.event_acknowledgements set acknowledged_at = now() - interval '1 day' where event_id = $1", [id]),
    /permission denied/,
  );

  // A later amendment is acknowledged again.
  await amend(who.helm, id, "Fallback: salvage contracts at ArcCorp.");
  await acknowledge(who.gunner, id);
  assert.equal(
    (await fleet.one("select amendment_number from public.event_acknowledgements where event_id = $1 and member_id = $2", [id, who.gunner])).amendment_number,
    3,
  );
});

test("who has acknowledged is for whoever runs the event, and each member for their own line", async () => {
  const id = await draft();
  await announce(id);
  for (const member of [who.gunner, who.spare]) await reply(member, id);
  await amend(who.helm, id, "Start moved to 2000 UTC.");
  for (const member of [who.gunner, who.spare]) await acknowledge(member, id);
  const sees = async (member) =>
    (await fleet.as(member).rows("select member_id from public.event_acknowledgements where event_id = $1", [id])).map((row) => row.member_id).sort();
  assert.deepEqual(await sees(who.gunner), [who.gunner]);
  assert.deepEqual(await sees(who.helm), [who.gunner, who.spare].sort(), "its commander");
  assert.deepEqual(await sees(who.command), [who.gunner, who.spare].sort(), "command");
  assert.deepEqual(await sees(who.instructor), []);
});

test("a copy carries the plan, and not the amendments or who acknowledged them", async () => {
  const source = await draft({ title: "Convoy 001", muster_at: "Baijini Point", area: "The lane", reading: ["command/orders"], repeats_weekly: true });
  for (const table of Object.keys(PARTS)) await add(who.command, table, source);
  await add(who.command, "event_timings", source, { offset_minutes: 90, label: "Hot debrief" });
  await announce(source);
  await reply(who.gunner, source);
  await amend(who.helm, source, "Start moved to 2000 UTC.");
  await acknowledge(who.gunner, source);

  const plan = async (id) => {
    const out = {};
    for (const table of Object.keys(PARTS)) {
      const columns = Object.keys(PARTS[table]).join(", ");
      out[table] = await fleet.rows(`select ${columns} from public.${table} where event_id = $1 order by 1`, [id]);
    }
    out.amendments = (await fleet.rows("select 1 from public.event_amendments where event_id = $1", [id])).length;
    out.acknowledged = (await fleet.rows("select 1 from public.event_acknowledgements where event_id = $1", [id])).length;
    return out;
  };
  const expected = { ...(await plan(source)), amendments: 0, acknowledged: 0 };

  const copy = await draft({ title: "Convoy 001 again", copied_from: source });
  assert.deepEqual(await plan(copy), expected);

  await start(source);
  await fleet.as(who.helm).query("update public.events set state = 'done' where id = $1", [source]);
  const next = await fleet.one("select id, muster_at, area, reading from public.events where copied_from = $1 and repeats_weekly", [source]);
  assert.deepEqual({ muster_at: next.muster_at, area: next.area, reading: next.reading }, { muster_at: "Baijini Point", area: "The lane", reading: ["command/orders"] });
  assert.deepEqual(await plan(next.id), expected);
});

test("the plan, amendments and acknowledgements are logged", async () => {
  const id = await draft();
  await add(who.command, "event_nets", id);
  await announce(id);
  await reply(who.gunner, id);
  await amend(who.helm, id, "Start moved to 2000 UTC.");
  await acknowledge(who.gunner, id);
  const logged = await fleet.rows(
    `select table_name, action, actor from public.audit_log
     where table_name in ('event_nets', 'event_amendments', 'event_acknowledgements') and (new_row ->> 'event_id')::uuid = $1 order by id`,
    [id],
  );
  assert.deepEqual(logged, [
    { table_name: "event_nets", action: "insert", actor: who.command },
    { table_name: "event_amendments", action: "insert", actor: who.helm },
    { table_name: "event_acknowledgements", action: "insert", actor: who.gunner },
  ]);
});
