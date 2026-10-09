// A task for each unit of an event, and who may read its words.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const post = {};
const unit = {};

const draft = async (fields = {}, as = who.command) => {
  const event = { kind: "training", title: "Convoy 001", starts_at: "3 days", commander_id: who.runner, ...fields };
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
const takePart = async (id, ...names) => {
  for (const name of names) {
    await fleet.as(who.command).query("insert into public.event_units (event_id, unit_id) values ($1, $2)", [id, unit[name]]);
  }
};
/** Give a unit its task, as whoever writes the orders. With no level, the database chooses. */
const task = (as, id, name, body, level) =>
  level
    ? fleet.as(as).query("insert into public.event_unit_tasks (event_id, unit_id, body, level) values ($1, $2, $3, $4)", [id, unit[name], body, level])
    : fleet.as(as).query("insert into public.event_unit_tasks (event_id, unit_id, body) values ($1, $2, $3)", [id, unit[name], body]);
const levelOf = async (id, name) =>
  (await fleet.one("select level from public.event_unit_tasks where event_id = $1 and unit_id = $2", [id, unit[name]])).level;
const setLevel = (as, id, name, level) =>
  fleet.as(as).changed("update public.event_unit_tasks set level = $3 where event_id = $1 and unit_id = $2", [id, unit[name], level]);
/** The units whose tasks a member is shown as listed, and the units whose words they can read. */
const listed = async (member, id) =>
  (
    await fleet.as(member).rows(
      "select u.name from public.event_unit_tasks t join public.units u on u.id = t.unit_id where t.event_id = $1 order by u.name",
      [id],
    )
  ).map((row) => row.name);
const reads = async (member, id) =>
  (
    await fleet.as(member).rows(
      `select u.name from public.event_unit_task_texts x
       join public.event_unit_tasks t on t.id = x.task_id
       join public.units u on u.id = t.unit_id
       where x.event_id = $1 order by u.name`,
      [id],
    )
  ).map((row) => row.name);

/** An announced event with the flagship, the escort and the flight, and a task at every level. */
const convoy = async (title = "Convoy 001") => {
  const id = await draft({ title });
  await takePart(id, "UEES Nexus", "Escort One", "A Flight");
  await task(who.runner, id, "UEES Nexus", "Hold the lane.", "everyone");
  await task(who.runner, id, "Gunnery", "Port and starboard arcs.", "unit");
  await task(who.runner, id, "Engineering", "Damage control closed up.", "leaders");
  await task(who.runner, id, "Escort One", "Break off on the codeword.", "commander");
  await task(who.runner, id, "A Flight", "Sweep ahead.", "leaders");
  await announce(id);
  return id;
};
const every = ["A Flight", "Engineering", "Escort One", "Gunnery", "UEES Nexus"];

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  // Far enough on that every post used here is open.
  await fleet.setStage(5);
  who.admin = await fleet.signIn("1", "Founder");
  who.command = await fleet.person("2", "Command", { roles: ["command"] });
  who.instructor = await fleet.person("3", "Instructor", { roles: ["instructor"] });
  who.runner = await fleet.person("4", "Runner");
  who.co = await fleet.person("6", "Captain");
  who.chief = await fleet.person("7", "Chief");
  who.gunner = await fleet.person("8", "Gunner");
  who.engineer = await fleet.person("9", "Engineer");
  who.escortCo = await fleet.person("10", "Escort captain");
  who.escortGunner = await fleet.person("11", "Escort gunner");
  who.pilot = await fleet.person("12", "Pilot");
  who.spare = await fleet.person("13", "Spare");
  who.applicant = await fleet.applicant("14", "Applicant");

  for (const name of ["UEE 9th Fleet", "Fleet Command", "Fleet Staff", "Task Force Jericho", "UEES Nexus", "Bridge", "Gunnery", "Engineering", "Escort One", "A Flight", "Training Ship"]) {
    unit[name] = (await fleet.one("select id from public.units where name = $1", [name])).id;
  }
  const posts = [
    ["co", "Bridge", "Commanding Officer"],
    ["chief", "Gunnery", "Gunnery Chief"],
    ["gunner", "Gunnery", "Turret Gunner 1"],
    ["engineer", "Engineering", "Engineer 1"],
    ["escortCo", "Escort One", "Commanding Officer"],
    ["escortGunner", "Escort One", "Gunner 1"],
    ["pilot", "A Flight", "Fighter Pilot 2"],
  ];
  for (const [member, unitName, title] of posts) {
    post[member] = await fleet.positionId(unitName, title);
    // Every qualification, so that the post can be given whatever it needs.
    await fleet.sql("insert into public.qualification_awards (member_id, qualification_id) select $1, id from public.qualifications", [who[member]]);
    await fleet.sql("insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary')", [who[member], post[member]]);
  }
  post.gunner2 = await fleet.positionId("Gunnery", "Turret Gunner 2");
});
after(() => fleet.close());

test("the order of battle says which post commands each unit, and which posts lead", async () => {
  const commanders = Object.fromEntries(
    (
      await fleet.rows(
        `select u.name, p.title, pu.name as sits_in from public.units u
         left join public.positions p on p.id = u.commander_position_id
         left join public.units pu on pu.id = p.unit_id`,
      )
    ).map((row) => [row.name, row.title ? `${row.title}, ${row.sits_in}` : null]),
  );
  // A ship's commanding officer sits on the bridge, and commands the ship.
  assert.equal(commanders["UEES Nexus"], "Commanding Officer, Bridge");
  assert.equal(commanders["Bridge"], "Commanding Officer, Bridge");
  assert.equal(commanders["Gunnery"], "Gunnery Chief, Gunnery");
  assert.equal(commanders["Escort One"], "Commanding Officer, Escort One");
  assert.equal(commanders["A Flight"], "Flight Lead, A Flight");
  assert.equal(commanders["Task Force Jericho"], "Fleet Commander, Fleet Command");
  assert.equal(commanders["UEE 9th Fleet"], "Fleet Commander, Fleet Command");
  // A crew of entry posts has nobody to command it, and a staff of duties has no post that could.
  assert.equal(commanders["Training Ship"], null);
  assert.equal(commanders["Fleet Staff"], null);

  const leaders = (await fleet.rows("select p.title from public.positions p join public.units u on u.id = p.unit_id where u.name = 'Bridge' and p.is_leader order by 1")).map((row) => row.title);
  assert.deepEqual(leaders, ["Chief of the Boat", "Commanding Officer", "Executive Officer", "Tactical Officer"]);
  assert.equal((await fleet.one("select count(*)::int as n from public.positions where is_leader and kind = 'duty'")).n, 0);

  // Only an admin says who commands a unit.
  assert.equal(await fleet.as(who.command).changed("update public.units set commander_position_id = null where id = $1", [unit["Gunnery"]]), 0);
  assert.equal(await fleet.as(who.admin).changed("update public.positions set is_leader = true where id = $1", [post.gunner2]), 1);
  await fleet.as(who.admin).query("update public.positions set is_leader = false where id = $1", [post.gunner2]);
});

test("a visitor is refused the tasks, an applicant sees none, and nobody reads the words from the task itself", async () => {
  const id = await convoy("Convoy 002");
  for (const table of ["event_unit_tasks", "event_unit_task_texts"]) {
    await assert.rejects(fleet.visitor().query(`select * from public.${table}`), /permission denied/, table);
  }
  assert.deepEqual(await fleet.as(who.applicant).rows("select id from public.event_unit_tasks"), []);
  assert.deepEqual(await fleet.as(who.applicant).rows("select task_id from public.event_unit_task_texts"), []);
  // The words are kept with the task for whoever writes them, and are read from the other table.
  for (const member of [who.gunner, who.runner, who.command]) {
    await assert.rejects(fleet.as(member).query("select body from public.event_unit_tasks where event_id = $1", [id]), /permission denied/);
    await assert.rejects(fleet.as(member).query("select * from public.event_unit_tasks where event_id = $1", [id]), /permission denied/);
    await assert.rejects(fleet.as(member).query("select id from public.event_unit_tasks where body like 'Break%'"), /permission denied/);
  }
  // Nobody writes the words' own table.
  await assert.rejects(
    fleet.as(who.command).query("update public.event_unit_task_texts set body = 'x' where event_id = $1", [id]),
    /permission denied/,
  );
});

test("a task is for a unit taking part, written by whoever writes the orders, and starts as the unit's own", async () => {
  const id = await draft({ title: "Drill 001" });
  await takePart(id, "UEES Nexus");
  await task(who.runner, id, "Gunnery", "Port and starboard arcs.");
  assert.equal(await levelOf(id, "Gunnery"), "unit");
  const row = await fleet.one("select set_by, callsign from public.event_unit_tasks where event_id = $1", [id]);
  assert.equal(row.set_by, who.runner);
  assert.equal(row.callsign, "");

  // A unit that is not taking part has no task, and a unit has one task.
  await assert.rejects(task(who.runner, id, "Escort One", "Screen."), /not taking part/);
  await assert.rejects(task(who.runner, id, "Gunnery", "Again."), /duplicate key|unique/);
  await assert.rejects(task(who.runner, id, "Engineering", ""), /violates check constraint/);
  // Nobody else gives a unit a task, not even its own commander.
  await assert.rejects(task(who.chief, id, "Engineering", "Mine."), /row-level security/);
  await assert.rejects(task(who.gunner, id, "Engineering", "Mine."), /row-level security/);

  // With no unit named, every unit takes part.
  const open = await draft({ title: "Drill 002" });
  await task(who.runner, open, "Escort One", "Screen.");
  // A task stays with its event and its unit.
  await assert.rejects(
    fleet.as(who.runner).query("update public.event_unit_tasks set unit_id = $2 where event_id = $1", [open, unit["A Flight"]]),
    /permission denied|cannot be moved/,
  );
});

test("a task's words are read by those its level allows, and by the commanders above", async () => {
  const id = await convoy("Convoy 003");
  // Everyone who can read the event sees that each unit has a task.
  for (const member of [who.gunner, who.spare, who.escortCo, who.runner]) {
    assert.deepEqual(await listed(member, id), every);
  }
  // A member of Gunnery reads their own unit's, and what is open to everyone.
  assert.deepEqual(await reads(who.gunner, id), ["Gunnery", "UEES Nexus"]);
  // Its chief commands it, and reads no more than that: Engineering's is for Engineering's leaders.
  assert.deepEqual(await reads(who.chief, id), ["Gunnery", "UEES Nexus"]);
  // An engineer who is not a leader is not shown a task that is for the leaders.
  assert.deepEqual(await reads(who.engineer, id), ["UEES Nexus"]);
  // The ship's commanding officer reads the task of every unit under them.
  assert.deepEqual(await reads(who.co, id), ["Engineering", "Gunnery", "UEES Nexus"]);
  // The escort's commander reads their own, which nobody else in the escort does.
  assert.deepEqual(await reads(who.escortCo, id), ["Escort One", "UEES Nexus"]);
  assert.deepEqual(await reads(who.escortGunner, id), ["UEES Nexus"]);
  assert.deepEqual(await reads(who.pilot, id), ["UEES Nexus"]);
  assert.deepEqual(await reads(who.spare, id), ["UEES Nexus"]);
  // Whoever runs the event reads them all, and so does command.
  assert.deepEqual(await reads(who.runner, id), every);
  assert.deepEqual(await reads(who.command, id), every);
});

test("someone standing in for a post reads what its holder would, for that event only", async () => {
  const id = await convoy("Convoy 004");
  const other = await convoy("Convoy 005");
  await fleet.as(who.spare).query("insert into public.attendance (event_id, member_id, reply) values ($1, $2, 'attending')", [id, who.spare]);
  assert.deepEqual(await reads(who.spare, id), ["UEES Nexus"]);
  await fleet.as(who.runner).query(
    "update public.attendance set stand_in_position_id = $3 where event_id = $1 and member_id = $2",
    [id, who.spare, post.gunner2],
  );
  assert.deepEqual(await reads(who.spare, id), ["Gunnery", "UEES Nexus"]);
  assert.deepEqual(await reads(who.spare, other), ["UEES Nexus"]);
});

test("a member of the opposing force reads only what everyone reads, whatever post they hold", async () => {
  const id = await convoy("Convoy 006");
  assert.deepEqual(await reads(who.gunner, id), ["Gunnery", "UEES Nexus"]);
  await fleet.as(who.command).query("insert into public.event_opfor_members (event_id, member_id) values ($1, $2)", [id, who.gunner]);
  assert.deepEqual(await reads(who.gunner, id), ["UEES Nexus"]);
  assert.deepEqual(await listed(who.gunner, id), every);
});

test("a unit's commander passes its task down inside the unit, and does nothing else to it", async () => {
  const id = await convoy("Convoy 007");
  // Only the unit's own commander, or whoever writes the orders.
  assert.equal(await setLevel(who.chief, id, "Escort One", "unit"), 0);
  assert.equal(await setLevel(who.escortGunner, id, "Escort One", "unit"), 0);
  assert.equal(await setLevel(who.co, id, "Gunnery", "everyone"), 0);

  await assert.rejects(setLevel(who.escortCo, id, "Escort One", "everyone"), /pass its task down inside the unit/);
  await assert.rejects(
    fleet.as(who.escortCo).query("update public.event_unit_tasks set body = 'Stay put.' where event_id = $1 and unit_id = $2", [id, unit["Escort One"]]),
    /Only whoever writes the event's orders changes a task/,
  );
  assert.equal(await setLevel(who.escortCo, id, "Escort One", "leaders"), 1);
  assert.deepEqual(await reads(who.escortGunner, id), ["UEES Nexus"]);
  assert.equal(await setLevel(who.escortCo, id, "Escort One", "unit"), 1);
  assert.deepEqual(await reads(who.escortGunner, id), ["Escort One", "UEES Nexus"]);
  // Once down, it is not taken back up by them.
  await assert.rejects(setLevel(who.escortCo, id, "Escort One", "commander"), /pass its task down inside the unit/);
  // Whoever writes the orders sets any level, and changes the words, which reach those who read them.
  assert.equal(await setLevel(who.runner, id, "Escort One", "commander"), 1);
  await fleet.as(who.runner).query("update public.event_unit_tasks set body = 'Hold with the convoy.' where event_id = $1 and unit_id = $2", [id, unit["Escort One"]]);
  const words = await fleet.as(who.escortCo).one(
    "select x.body from public.event_unit_task_texts x join public.event_unit_tasks t on t.id = x.task_id where t.event_id = $1 and t.unit_id = $2",
    [id, unit["Escort One"]],
  );
  assert.equal(words.body, "Hold with the convoy.");
  assert.deepEqual(await reads(who.escortGunner, id), ["UEES Nexus"]);
});

test("a draft's tasks stay with the draft, whatever their level", async () => {
  const id = await draft({ title: "Drill 003" });
  await task(who.runner, id, "Gunnery", "For all to read.", "everyone");
  assert.deepEqual(await listed(who.gunner, id), []);
  assert.deepEqual(await reads(who.gunner, id), []);
  assert.deepEqual(await fleet.as(who.gunner).rows("select body from public.event_unit_task_texts where event_id = $1", [id]), []);
  assert.deepEqual(await reads(who.runner, id), ["Gunnery"]);
});

test("every task opens once the event is closed, and is fixed with it", async () => {
  const id = await convoy("Convoy 008");
  assert.deepEqual(await reads(who.spare, id), ["UEES Nexus"]);
  await start(id);
  await fleet.as(who.runner).query("update public.events set state = 'done' where id = $1", [id]);
  for (const member of [who.spare, who.gunner, who.pilot]) {
    assert.deepEqual(await reads(member, id), every);
  }
  await assert.rejects(setLevel(who.runner, id, "Gunnery", "everyone"), /This event is closed/);
  await assert.rejects(task(who.runner, id, "Bridge", "Too late."), /This event is closed/);
  await assert.rejects(
    fleet.as(who.runner).query("delete from public.event_unit_tasks where event_id = $1", [id]),
    /This event is closed/,
  );
});

test("a copy brings the tasks the person copying may read, and leaves the rest behind", async () => {
  const id = await convoy("Convoy 009");
  const copy = async (as, title) =>
    (
      await fleet.as(as).one(
        "insert into public.events (kind, title, starts_at, commander_id, copied_from) values ('training', $1, now() + interval '9 days', $2, $3) returning id",
        [title, as, id],
      )
    ).id;
  // The instructor may draft this type, and holds no post: they read only what everyone reads.
  const theirs = await copy(who.instructor, "Convoy 010");
  assert.deepEqual(await listed(who.instructor, theirs), ["UEES Nexus"]);
  const full = await copy(who.command, "Convoy 011");
  assert.deepEqual(await listed(who.command, full), every);
  assert.equal(await levelOf(full, "Escort One"), "commander");
  assert.deepEqual(await reads(who.command, full), every);
});

test("a task, and each change to who reads it, is logged with who made it", async () => {
  const id = await convoy("Convoy 012");
  await setLevel(who.escortCo, id, "Escort One", "unit");
  const lines = await fleet.rows(
    `select action, actor, new_row ->> 'level' as level, old_row ->> 'level' as was
     from public.audit_log where table_name = 'event_unit_tasks' and new_row ->> 'event_id' = $1 and new_row ->> 'unit_id' = $2
     order by id`,
    [id, unit["Escort One"]],
  );
  assert.deepEqual(lines, [
    { action: "insert", actor: who.runner, level: "commander", was: null },
    { action: "update", actor: who.escortCo, level: "unit", was: "commander" },
  ]);
});
