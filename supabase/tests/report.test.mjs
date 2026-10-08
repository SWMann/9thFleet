// Training sign-off at an event, and the fuller after-action report:
// how each objective turned out, what was lost, and who is mentioned.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const qualification = {};

const draft = async (fields = {}, as = who.command) => {
  const event = { kind: "training", title: "Radio course 001", starts_at: "3 days", commander_id: who.helm, ...fields };
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
const reply = (member, id, answer = "attending") =>
  fleet.as(member).query(
    `insert into public.attendance (event_id, member_id, reply) values ($1, $2, $3)
     on conflict (event_id, member_id) do update set reply = excluded.reply`,
    [id, member, answer],
  );
const mark = (as, id, member, returned) =>
  fleet.as(as).query("insert into public.attendance_returns (event_id, member_id, returned) values ($1, $2, $3)", [id, member, returned]);
const award = (as, member, code, eventId = null) =>
  fleet.as(as).one(
    `insert into public.qualification_awards (member_id, qualification_id, awarded_by, event_id)
     values ($1, $2, $3, $4) returning *`,
    [member, qualification[code], as, eventId],
  );
/** An announced event that has started, with an objective, which the gunner and the spare hand attended. */
const ran = async (fields = {}) => {
  const id = await draft(fields);
  const objective = (
    await fleet.as(who.command).one("insert into public.event_objectives (event_id, title) values ($1, 'Pass the radio check') returning id", [id])
  ).id;
  await announce(id);
  for (const member of [who.gunner, who.spare]) await reply(member, id);
  await start(id);
  return { id, objective };
};

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.command = await fleet.person("2", "Command", { roles: ["command"] });
  who.instructor = await fleet.person("3", "Instructor", { roles: ["instructor"] });
  who.helm = await fleet.person("4", "Helm");
  who.gunner = await fleet.person("5", "Gunner");
  who.spare = await fleet.person("6", "Spare");
  who.other = await fleet.person("7", "Other");
  who.applicant = await fleet.applicant("8", "Applicant");
  for (const row of await fleet.rows("select id, code from public.qualifications")) qualification[row.code] = row.id;
});
after(() => fleet.close());

test("a visitor is refused the report's records, and an applicant sees none of them", async () => {
  const { id, objective } = await ran();
  await fleet.as(who.helm).query("insert into public.event_objective_outcomes (objective_id, event_id, outcome) values ($1, $2, 'achieved')", [objective, id]);
  await fleet.as(who.helm).query("insert into public.event_losses (event_id, item) values ($1, 'Gladius')", [id]);
  await fleet.as(who.helm).query("insert into public.event_mentions (event_id, member_id, citation) values ($1, $2, 'Kept the net clear.')", [id, who.gunner]);
  for (const table of ["event_objective_outcomes", "event_losses", "event_mentions"]) {
    await assert.rejects(fleet.visitor().query(`select * from public.${table}`), /permission denied/, table);
    assert.equal((await fleet.as(who.applicant).rows(`select * from public.${table}`)).length, 0, table);
    assert.equal((await fleet.as(who.other).rows(`select 1 from public.${table} where event_id = $1`, [id])).length, 1, `${table}, to the fleet`);
  }
});

test("an instructor signs off who passed at an event that teaches the qualification", async () => {
  const id = await draft({ teaches_qualification_id: qualification["radio-user"] });
  await announce(id);
  for (const member of [who.gunner, who.spare, who.instructor]) await reply(member, id);
  await assert.rejects(award(who.instructor, who.gunner, "radio-user", id), /once the event has started/);
  await start(id);

  const pass = await award(who.instructor, who.gunner, "radio-user", id);
  assert.equal(pass.event_id, id);
  assert.equal(pass.awarded_by, who.instructor);
  // The event teaches one qualification, and only that one is signed off there.
  await assert.rejects(award(who.instructor, who.spare, "navy-crew", id), /does not teach this qualification/);
  // Someone who was not there is not signed off.
  await assert.rejects(award(who.instructor, who.other, "radio-user", id), /was not at the event/);
  // Who may award at all has not changed: an instructor, and never to themselves.
  await assert.rejects(award(who.helm, who.spare, "radio-user", id), /row-level security/);
  await assert.rejects(award(who.instructor, who.instructor, "radio-user", id), /row-level security/);
  // An award made away from any event is as it was.
  const plain = await award(who.instructor, who.other, "induction");
  assert.equal(plain.event_id, null);
  // What event an award was made at is not changed afterwards.
  await assert.rejects(fleet.as(who.instructor).query("update public.qualification_awards set event_id = null where id = $1", [pass.id]), /permission denied/);
});

test("the attendance return has the last word on who was there", async () => {
  const id = await draft({ teaches_qualification_id: qualification["radio-user"], title: "Radio course 002" });
  await announce(id);
  await reply(who.spare, id);
  await start(id);
  // The spare hand said they would come and did not. The other came without replying.
  await mark(who.helm, id, who.spare, "absent_without_notice");
  await mark(who.helm, id, who.other, "present");
  await assert.rejects(award(who.instructor, who.spare, "radio-user", id), /was marked absent/);
  const pass = await award(who.instructor, who.other, "radio-user", id);
  assert.equal(pass.event_id, id);
  // It can still be signed off once the event is closed.
  await fleet.as(who.helm).query("update public.events set state = 'done' where id = $1", [id]);
  await mark(who.helm, id, who.helm, "present");
  await award(who.instructor, who.helm, "radio-user", id);
});

test("whoever ran an event says how each objective turned out, once it has started", async () => {
  const id = await draft();
  const objective = (
    await fleet.as(who.command).one("insert into public.event_objectives (event_id, title) values ($1, 'Pass the radio check') returning id", [id])
  ).id;
  const elsewhere = (await ran()).objective;
  await announce(id);
  const set = (as, target, outcome, note = "") =>
    fleet.as(as).query(
      `insert into public.event_objective_outcomes (objective_id, event_id, outcome, note) values ($1, $2, $3, $4)
       on conflict (objective_id) do update set outcome = excluded.outcome, note = excluded.note`,
      [target, id, outcome, note],
    );
  await assert.rejects(set(who.helm, objective, "achieved"), /once the event has started/);
  await start(id);
  await assert.rejects(set(who.gunner, objective, "achieved"), /row-level security|whoever ran the event/);
  await assert.rejects(set(who.helm, elsewhere, "achieved"), /not one of this event's/);

  await set(who.helm, objective, "partly", "Two of three passed.");
  let row = await fleet.one("select outcome, note, set_by from public.event_objective_outcomes where objective_id = $1", [objective]);
  assert.deepEqual(row, { outcome: "partly", note: "Two of three passed.", set_by: who.helm });

  // The event closes, the objective is fixed, and the outcome can still be put right.
  await fleet.as(who.helm).query("update public.events set state = 'done' where id = $1", [id]);
  await assert.rejects(fleet.as(who.helm).query("update public.event_objectives set title = 'Rewritten' where id = $1", [objective]), /This event is closed/);
  await set(who.command, objective, "achieved");
  row = await fleet.one("select outcome, set_by from public.event_objective_outcomes where objective_id = $1", [objective]);
  assert.deepEqual(row, { outcome: "achieved", set_by: who.command });
  await assert.rejects(
    fleet.as(who.helm).query("update public.event_objective_outcomes set set_by = $2 where objective_id = $1", [objective, who.gunner]),
    /permission denied/,
  );
});

test("losses are recorded by whoever ran the event, and keep who first recorded them", async () => {
  const { id } = await ran();
  const add = (as, fields) =>
    fleet.as(as).one(
      `insert into public.event_losses (event_id, item, quantity, note) values ($1, $2, $3, $4) returning *`,
      [id, fields.item, fields.quantity ?? 1, fields.note ?? ""],
    );
  await assert.rejects(add(who.gunner, { item: "Gladius" }), /row-level security|whoever ran the event/);
  const loss = await add(who.helm, { item: "Gladius", quantity: 2, note: "Turret fire at the outpost." });
  assert.equal(loss.recorded_by, who.helm);
  await assert.rejects(add(who.helm, { item: "Gladius", quantity: 0 }), /check constraint/);
  await fleet.as(who.command).query("update public.event_losses set quantity = 3 where id = $1", [loss.id]);
  const corrected = await fleet.one("select quantity, recorded_by from public.event_losses where id = $1", [loss.id]);
  assert.deepEqual(corrected, { quantity: 3, recorded_by: who.helm });
  assert.equal(await fleet.as(who.gunner).changed("delete from public.event_losses where id = $1", [loss.id]), 0);
  assert.equal(await fleet.as(who.helm).changed("delete from public.event_losses where id = $1", [loss.id]), 1);
});

test("a mention is written by whoever ran the event, about someone else, and the fleet reads it", async () => {
  const { id } = await ran();
  const mention = (as, member, citation = "Kept the net clear under pressure.") =>
    fleet.as(as).one("insert into public.event_mentions (event_id, member_id, citation) values ($1, $2, $3) returning *", [id, member, citation]);
  await assert.rejects(mention(who.gunner, who.spare), /row-level security|whoever ran the event/);
  await assert.rejects(mention(who.helm, who.helm), /written by someone else/);
  await assert.rejects(mention(who.helm, who.applicant), /for a serving member/);

  const made = await mention(who.helm, who.gunner);
  assert.equal(made.mentioned_by, who.helm);
  assert.ok(made.mentioned_at);
  await assert.rejects(mention(who.helm, who.gunner, "Again."), /duplicate key/);
  // The member finds it on their own record, and the fleet finds it with the event.
  assert.deepEqual(
    (await fleet.as(who.gunner).rows("select event_id from public.event_mentions where member_id = $1", [who.gunner])).map((row) => row.event_id).includes(id),
    true,
  );
  assert.equal((await fleet.as(who.other).rows("select 1 from public.event_mentions where event_id = $1", [id])).length, 1);

  // Its words can be corrected. Who it is about, who wrote it and when cannot.
  await fleet.as(who.command).query("update public.event_mentions set citation = 'Kept the net clear.' where id = $1", [made.id]);
  const kept = await fleet.one("select citation, mentioned_by from public.event_mentions where id = $1", [made.id]);
  assert.deepEqual(kept, { citation: "Kept the net clear.", mentioned_by: who.helm });
  await assert.rejects(fleet.as(who.helm).query("update public.event_mentions set member_id = $2 where id = $1", [made.id, who.spare]), /permission denied/);
  await assert.rejects(fleet.as(who.helm).query("update public.event_mentions set mentioned_by = $2 where id = $1", [made.id, who.spare]), /permission denied/);
  assert.equal(await fleet.as(who.helm).changed("delete from public.event_mentions where id = $1", [made.id]), 1);
});

test("the report's records are for an event that took place", async () => {
  const id = await draft();
  await assert.rejects(
    fleet.as(who.command).query("insert into public.event_losses (event_id, item) values ($1, 'Gladius')", [id]),
    /took place/,
  );
  await announce(id);
  await assert.rejects(
    fleet.as(who.helm).query("insert into public.event_mentions (event_id, member_id, citation) values ($1, $2, 'Early.')", [id, who.gunner]),
    /once the event has started/,
  );
});

test("next week's event teaches what this one did, and starts with no report", async () => {
  const { id, objective } = await ran({ teaches_qualification_id: qualification["radio-user"], repeats_weekly: true, title: "Radio course 010" });
  await fleet.as(who.helm).query("insert into public.event_objective_outcomes (objective_id, event_id, outcome) values ($1, $2, 'achieved')", [objective, id]);
  await fleet.as(who.helm).query("insert into public.event_losses (event_id, item) values ($1, 'Pisces')", [id]);
  await fleet.as(who.helm).query("insert into public.event_mentions (event_id, member_id, citation) values ($1, $2, 'First to pass.')", [id, who.gunner]);
  await award(who.instructor, who.gunner, "radio-user", id).catch(() => {});
  await fleet.as(who.helm).query("update public.events set state = 'done' where id = $1", [id]);

  const next = await fleet.one("select id, teaches_qualification_id from public.events where copied_from = $1", [id]);
  assert.equal(next.teaches_qualification_id, qualification["radio-user"]);
  assert.equal((await fleet.rows("select 1 from public.event_objectives where event_id = $1", [next.id])).length, 1);
  for (const table of ["event_objective_outcomes", "event_losses", "event_mentions"]) {
    assert.equal((await fleet.rows(`select 1 from public.${table} where event_id = $1`, [next.id])).length, 0, table);
  }
});

test("the report's records are logged, with a mention under the member it is about", async () => {
  const { id } = await ran();
  await fleet.as(who.helm).query("insert into public.event_mentions (event_id, member_id, citation) values ($1, $2, 'Kept the net clear.')", [id, who.spare]);
  await fleet.as(who.helm).query("insert into public.event_losses (event_id, item) values ($1, 'Gladius')", [id]);
  const logged = await fleet.rows(
    `select table_name, action, actor, subject from public.audit_log
     where table_name in ('event_mentions', 'event_losses') and (new_row ->> 'event_id')::uuid = $1 order by id`,
    [id],
  );
  assert.deepEqual(logged, [
    { table_name: "event_mentions", action: "insert", actor: who.helm, subject: who.spare },
    { table_name: "event_losses", action: "insert", actor: who.helm, subject: null },
  ]);
});
