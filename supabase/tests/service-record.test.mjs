// The service record: the days a member's status and grade changed, and who
// may read a member's history.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Fleet, migrationFiles, newFleet } from "./helpers.mjs";

let fleet;
const who = {};
let nextDiscordId = 100;
const fresh = (name, options) => fleet.person(String(nextDiscordId++), name, options);

/** A full member who has finished the recruit route. */
async function crewMember(name, options) {
  const id = await fresh(name, options);
  await fleet.qualify(id, "induction", "radio-user", "navy-crew");
  return id;
}

const appoint = (actor, memberId, positionId, extra = {}) => {
  const row = { member_id: memberId, position_id: positionId, kind: "primary", ...extra };
  const columns = Object.keys(row);
  const marks = columns.map((_, index) => `$${index + 1}`).join(", ");
  return fleet.as(actor).one(
    `insert into public.assignments (${columns.join(", ")}) values (${marks}) returning id, member_id, position_id, kind, grade_code, acting, started_on, ended_on, appointed_by, recorded_at`,
    Object.values(row),
  );
};

/** A post on the training ship, emptied of whoever an earlier test left in it. */
async function openPost(title) {
  const id = await fleet.positionId("Training Ship", title);
  await fleet.sql("update public.assignments set ended_on = current_date where position_id = $1 and ended_on is null", [id]);
  return id;
}

const statusLines = (id) =>
  fleet.rows(
    `select status, changed_by, changed_on = current_date as today
     from public.member_status_changes where member_id = $1 order by id`,
    [id],
  );
const gradeLines = (assignmentId) =>
  fleet.rows(
    `select grade_code, acting, set_by, since = current_date as today
     from public.assignment_grades where assignment_id = $1 order by id`,
    [assignmentId],
  );
const count = async (actor, table, where = "true", params = []) =>
  (await actor.rows(`select count(*)::int as n from public.${table} where ${where}`, params))[0].n;

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  await fleet.setStage(3);
});
after(() => fleet.close());

test("signing in for the first time starts the record, in nobody's name", async () => {
  const id = await fleet.signIn(String(nextDiscordId++), "New face");
  assert.deepEqual(await statusLines(id), [{ status: "applicant", changed_by: null, today: true }]);
});

test("each change of status is kept with its day and who made it, and nothing else is", async () => {
  const id = await fleet.applicant(String(nextDiscordId++), "Riser");
  const staff = fleet.as(who.staff);
  for (const status of ["recruit", "auxiliary", "member", "reserve", "member"]) {
    assert.equal(await staff.changed("update public.members set status = $2 where id = $1", [id, status]), 1, status);
  }
  // A change that is not a change of status adds no line.
  assert.equal(await staff.changed("update public.members set rsi_handle = 'Riser_Two' where id = $1", [id]), 1);
  assert.equal(await staff.changed("update public.members set status = 'member' where id = $1", [id]), 1);

  assert.deepEqual(
    (await statusLines(id)).map((line) => [line.status, line.changed_by, line.today]),
    [
      ["applicant", null, true],
      ["recruit", who.staff, true],
      ["auxiliary", who.staff, true],
      ["member", who.staff, true],
      ["reserve", who.staff, true],
      ["member", who.staff, true],
    ],
  );
});

test("a post is taken up at a grade, and a promotion in post adds a line with its day", async () => {
  const id = await crewMember("Climber");
  const made = await appoint(who.command, id, await fleet.positionId("Training Ship", "Gunner 1"));
  assert.deepEqual(await gradeLines(made.id), [{ grade_code: "E2", acting: false, set_by: who.command, today: true }]);

  const command = fleet.as(who.command);
  assert.equal(await command.changed("update public.assignments set grade_code = 'E3' where id = $1", [made.id]), 1);
  // A note is not a promotion.
  assert.equal(await command.changed("update public.assignments set note = 'Steady hands.' where id = $1", [made.id]), 1);
  // Nor is setting the grade to what it already is.
  assert.equal(await command.changed("update public.assignments set grade_code = 'E3' where id = $1", [made.id]), 1);
  assert.equal(await command.changed("update public.assignments set grade_code = 'E4' where id = $1", [made.id]), 1);
  // Leaving the post is a date on the post, not a change of grade.
  assert.equal(await command.changed("update public.assignments set ended_on = current_date where id = $1", [made.id]), 1);

  assert.deepEqual(
    (await gradeLines(made.id)).map((line) => [line.grade_code, line.acting, line.set_by]),
    [
      ["E2", false, who.command],
      ["E3", false, who.command],
      ["E4", false, who.command],
    ],
  );
});

test("a post taken up in the past starts its grade on the day the post started", async () => {
  const id = await crewMember("Old hand");
  const post = await fleet.positionId("Training Ship", "Gunner 2");
  // Only the database owner can date an appointment.
  const made = await fleet.one(
    `insert into public.assignments (member_id, position_id, kind, started_on)
     values ($1, $2, 'primary', current_date - 50) returning id`,
    [id, post],
  );
  const line = await fleet.one(
    "select since = current_date - 50 as on_the_day, set_by from public.assignment_grades where assignment_id = $1",
    [made.id],
  );
  assert.deepEqual(line, { on_the_day: true, set_by: null });
});

test("confirming an acting appointment adds a line, and a duty adds none", async () => {
  const id = await crewMember("Wings");
  const flight = await appoint(who.command, id, await fleet.positionId("A Flight", "Flight Lead"), { acting: true });
  await fleet.qualify(id, "commission");
  assert.equal(await fleet.as(who.command).changed("update public.assignments set acting = false where id = $1", [flight.id]), 1);
  const lines = await gradeLines(flight.id);
  assert.deepEqual(lines.map((line) => line.acting), [true, false]);
  assert.equal(lines[0].grade_code, lines[1].grade_code);

  await fleet.qualify(id, "instructor");
  const duty = await fleet.as(who.command).one(
    "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'duty') returning id",
    [id, await fleet.positionId("Fleet Staff", "Instructor")],
  );
  assert.deepEqual(await gradeLines(duty.id), []);
});

test("a member reads their own lines, another member reads none of them, and staff read them all", async () => {
  const id = await crewMember("Subject");
  const made = await appoint(who.command, id, await fleet.positionId("Training Ship", "Gunner 3"));

  const me = fleet.as(id);
  assert.ok((await count(me, "member_status_changes", "member_id = $1", [id])) >= 1);
  assert.equal(await count(me, "assignment_grades", "assignment_id = $1", [made.id]), 1);
  // Nothing of anyone else's.
  assert.equal(await count(me, "member_status_changes", "member_id <> $1", [id]), 0);
  assert.equal(await count(me, "assignment_grades", "member_id <> $1", [id]), 0);

  const other = fleet.as(who.member);
  assert.equal(await count(other, "member_status_changes", "member_id = $1", [id]), 0);
  assert.equal(await count(other, "assignment_grades", "member_id = $1", [id]), 0);

  for (const reader of [who.staff, who.command, who.admin]) {
    const actor = fleet.as(reader);
    assert.ok((await count(actor, "member_status_changes", "member_id = $1", [id])) >= 1);
    assert.equal(await count(actor, "assignment_grades", "assignment_id = $1", [made.id]), 1);
  }

  for (const table of ["member_status_changes", "assignment_grades"]) {
    await assert.rejects(fleet.visitor().query(`select * from public.${table}`), /permission denied/, table);
  }
});

test("an applicant reads the day they signed in, and nobody else's", async () => {
  const id = await fleet.applicant(String(nextDiscordId++), "Hopeful");
  const lines = await fleet.as(id).rows("select member_id, status from public.member_status_changes");
  assert.deepEqual(lines, [{ member_id: id, status: "applicant" }]);
});

test("nobody writes the record through the API, whatever they hold", async () => {
  const id = await crewMember("Fixed");
  const made = await appoint(who.command, id, await fleet.positionId("Training Ship", "Gunner 4"));
  for (const actorId of [id, who.staff, who.command, who.admin]) {
    const actor = fleet.as(actorId);
    for (const change of [
      ["insert into public.member_status_changes (member_id, status) values ($1, 'member')", [id]],
      ["update public.member_status_changes set changed_on = '2001-01-01' where member_id = $1", [id]],
      ["delete from public.member_status_changes where member_id = $1", [id]],
      ["insert into public.assignment_grades (assignment_id, member_id, grade_code, acting) values ($1, $2, 'E4', false)", [made.id, id]],
      ["update public.assignment_grades set since = '2001-01-01' where assignment_id = $1", [made.id]],
      ["delete from public.assignment_grades where assignment_id = $1", [made.id]],
    ]) {
      await assert.rejects(actor.query(change[0], change[1]), /permission denied/, change[0]);
    }
  }
  assert.equal((await gradeLines(made.id)).length, 1);
});

test("a serving member reads who holds a post now, and not a post someone has left", async () => {
  const id = await crewMember("Mover");
  const first = await appoint(who.command, id, await fleet.positionId("Training Ship", "Helmsman"));
  const reader = fleet.as(who.member);
  assert.equal(await count(reader, "assignments", "id = $1", [first.id]), 1, "a post held now is on the order of battle");

  assert.equal(await fleet.as(who.command).changed("update public.assignments set ended_on = current_date where id = $1", [first.id]), 1);
  assert.equal(await count(reader, "assignments", "id = $1", [first.id]), 0, "a post that was left is history");
  // The member themselves, and staff, still read it.
  assert.equal(await count(fleet.as(id), "assignments", "id = $1", [first.id]), 1);
  for (const staff of [who.staff, who.command, who.admin]) {
    assert.equal(await count(fleet.as(staff), "assignments", "id = $1", [first.id]), 1);
  }
  // Leaving the post did not cost them their place on the roster the fleet reads.
  assert.equal(await count(reader, "roster", "member_id = $1", [id]), 1);
});

test("deleting a member takes their record with them", async () => {
  const id = await crewMember("Leaver");
  const made = await appoint(who.command, id, await fleet.positionId("Training Ship", "Engineer"));
  await fleet.sql("delete from auth.users where id = $1", [id]);
  assert.equal(await count(fleet, "member_status_changes", "member_id = $1", [id]), 0);
  assert.equal(await count(fleet, "assignment_grades", "assignment_id = $1", [made.id]), 0);
});

test("putting right the grade of a post that was left corrects its last line, and is not a promotion today", async () => {
  const id = await crewMember("Corrected");
  const post = await openPost("Gunner 2");
  // Held from 100 days ago to 60 days ago, at E2. Only the database owner can date a post or change one that has ended.
  const made = await fleet.one(
    `insert into public.assignments (member_id, position_id, kind, started_on)
     values ($1, $2, 'primary', current_date - 100) returning id`,
    [id, post],
  );
  await fleet.sql("update public.assignments set ended_on = current_date - 60 where id = $1", [made.id]);
  await fleet.sql("update public.assignments set grade_code = 'E3' where id = $1", [made.id]);
  assert.deepEqual(
    await fleet.rows(
      "select grade_code, since = current_date - 100 as first_day from public.assignment_grades where assignment_id = $1",
      [made.id],
    ),
    [{ grade_code: "E3", first_day: true }],
  );
});

test("what command writes on an appointment is read by staff, and by nobody else", async () => {
  const id = await crewMember("Noted");
  const made = await appoint(who.command, id, await openPost("Gunner 3"), { note: "Watch closely: late twice." });
  const noteAs = async (reader) => (await fleet.as(reader).rows("select note from public.assignment_notes where assignment_id = $1", [made.id])).map((row) => row.note);

  for (const staff of [who.staff, who.command, who.admin]) {
    assert.deepEqual(await noteAs(staff), ["Watch closely: late twice."]);
  }
  // Not the member it is about, and not anyone else who serves.
  for (const reader of [id, who.member]) {
    assert.deepEqual(await noteAs(reader), []);
  }
  await assert.rejects(fleet.visitor().query("select * from public.assignment_notes"), /permission denied/);

  // The appointment itself no longer carries the note to anyone, staff included.
  for (const reader of [id, who.member, who.staff, who.command, who.admin]) {
    await assert.rejects(fleet.as(reader).query("select note from public.assignments where id = $1", [made.id]), /permission denied/);
    await assert.rejects(fleet.as(reader).query("select * from public.assignments where id = $1", [made.id]), /permission denied/);
  }
  // Who holds the post is still read by the fleet.
  assert.equal(await count(fleet.as(who.member), "assignments", "id = $1", [made.id]), 1);

  // Command rewrites the note, and takes it off.
  const command = fleet.as(who.command);
  assert.equal(await command.changed("update public.assignments set note = 'Settled in.' where id = $1", [made.id]), 1);
  assert.deepEqual(await noteAs(who.staff), ["Settled in."]);
  assert.equal(await command.changed("update public.assignments set note = '' where id = $1", [made.id]), 1);
  assert.deepEqual(await noteAs(who.staff), [""]);

  // Nobody writes the copy for themselves.
  for (const actor of [id, who.staff, who.command, who.admin]) {
    await assert.rejects(
      fleet.as(actor).query("update public.assignment_notes set note = 'Forged.' where assignment_id = $1", [made.id]),
      /permission denied/,
    );
    await assert.rejects(
      fleet.as(actor).query("insert into public.assignment_notes (assignment_id, member_id, note) values ($1, $2, 'Forged.')", [made.id, id]),
      /permission denied/,
    );
  }
});

test("an appointment with no note keeps no copy of one", async () => {
  const id = await crewMember("Unremarked");
  const made = await appoint(who.command, id, await openPost("Gunner 4"));
  assert.equal(await count(fleet, "assignment_notes", "assignment_id = $1", [made.id]), 0);
});

test("what an instructor writes on an award is sent to nobody", async () => {
  const id = await fresh("Qualified", { status: "recruit" });
  const instructor = await fresh("Teacher", { roles: ["instructor"] });
  await fleet.qualify(id, "induction");
  await fleet.passLessons(id, "radio-user");
  await fleet.as(instructor).query(
    `insert into public.qualification_awards (member_id, qualification_id, awarded_by, note)
     select $1, id, $2, 'Passed on the second attempt.' from public.qualifications where code = 'radio-user'`,
    [id, instructor],
  );
  for (const reader of [id, who.member, instructor, who.staff, who.command, who.admin]) {
    await assert.rejects(fleet.as(reader).query("select note from public.qualification_awards where member_id = $1", [id]), /permission denied/);
    // That the award was made, by whom and when, is read as before.
    assert.equal(await count(fleet.as(reader), "qualification_awards", "member_id = $1 and awarded_by = $2", [id, instructor]), 1);
  }
  assert.equal((await fleet.one("select note from public.qualification_awards where member_id = $1 and awarded_by = $2", [id, instructor])).note, "Passed on the second attempt.");
});

test("the record's days are days in UTC, whatever time zone a request asks for", async () => {
  const id = await crewMember("Far east");
  const post = await openPost("Helmsman");
  // Kiritimati is 14 hours ahead of UTC and Niue 11 behind, so one of the two is always on another day.
  for (const zone of ["Pacific/Kiritimati", "Pacific/Niue"]) {
    const asStaff = (actor, text, params) =>
      fleet.db.transaction(async (tx) => {
        await tx.query("set local role authenticated");
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actor, role: "authenticated" })]);
        await tx.query("select set_config('timezone', $1, true)", [zone]);
        return tx.query(text, params);
      });
    await asStaff(who.staff, "update public.members set status = 'reserve' where id = $1", [id]);
    await asStaff(who.staff, "update public.members set status = 'member' where id = $1", [id]);
    const made = await asStaff(who.command, "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary') returning id", [id, post]);
    await asStaff(who.command, "update public.assignments set grade_code = 'E3' where id = $1", [made.rows[0].id]);
    // The site sends the day in UTC. The day in the session's time zone is refused when it is another day.
    const utc = "(now() at time zone 'utc')::date";
    if ((await asStaff(who.command, `select current_date = ${utc} as same`, [])).rows[0].same === false) {
      await assert.rejects(
        asStaff(who.command, "update public.assignments set ended_on = current_date where id = $1", [made.rows[0].id]),
        /An assignment ends on the day it is ended\./,
        `${zone}: another day`,
      );
    }
    await asStaff(who.command, `update public.assignments set ended_on = ${utc} where id = $1`, [made.rows[0].id]);

    const statuses = await fleet.rows(`select changed_on = ${utc} as utc_day from public.member_status_changes where member_id = $1`, [id]);
    assert.ok(statuses.every((line) => line.utc_day), `${zone}: status`);
    const appointment = await fleet.one(`select started_on = ${utc} as started_today, ended_on = ${utc} as ended_today from public.assignments where id = $1`, [made.rows[0].id]);
    assert.deepEqual(appointment, { started_today: true, ended_today: true }, `${zone}: appointment`);
    const promoted = await fleet.one(
      `select since = ${utc} as utc_day from public.assignment_grades where assignment_id = $1 and grade_code = 'E3'`,
      [made.rows[0].id],
    );
    assert.equal(promoted.utc_day, true, `${zone}: grade`);
  }
});

// The migration fills the record in for what happened before it, from the
// audit log. This runs every earlier migration, makes some history, then
// applies it.
test("history from before this migration is filled in from the audit log", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "..", "migrations");
  const files = migrationFiles();
  const mine = files.find((name) => name.endsWith("_service_record.sql"));
  assert.ok(mine, "the migration is there");

  const db = new PGlite();
  await db.exec(readFileSync(join(here, "supabase-shim.sql"), "utf8"));
  for (const name of files.slice(0, files.indexOf(mine))) {
    await db.exec(readFileSync(join(dir, name), "utf8"));
  }
  const old = new Fleet(db);
  try {
    await old.sql("update app.bootstrap set founder_discord_id = '1'");
    const founder = await old.signIn("1", "Founder");
    const command = await old.person("2", "Command", { roles: ["command"] });
    const staff = await old.person("3", "Staff", { roles: ["staff"] });
    await old.setStage(3);

    // Someone who came up through the ranks, was promoted in post, and went to reserve.
    const riser = await old.applicant("4", "Riser");
    await old.sql("update public.members set service = 'navy' where id = $1", [riser]);
    for (const status of ["recruit", "auxiliary", "member"]) {
      await old.as(staff).query("update public.members set status = $2 where id = $1", [riser, status]);
    }
    await old.qualify(riser, "induction", "radio-user", "navy-crew");
    const post = await old.as(command).one(
      "insert into public.assignments (member_id, position_id, kind) values ($1, $2, 'primary') returning id",
      [riser, await old.positionId("Training Ship", "Gunner 1")],
    );
    await old.as(command).query("update public.assignments set grade_code = 'E3' where id = $1", [post.id]);
    await old.as(staff).query("update public.members set status = 'reserve' where id = $1", [riser]);

    // Someone the audit log knows nothing about: their lines were removed from it.
    const quiet = await old.person("5", "Quiet");
    await old.qualify(quiet, "induction", "radio-user", "navy-crew");
    const quietPost = await old.sql(
      `insert into public.assignments (member_id, position_id, kind, started_on)
       values ($1, $2, 'primary', current_date - 20) returning id`,
      [quiet, await old.positionId("Training Ship", "Gunner 2")],
    );
    await old.sql("delete from public.audit_log where subject = $1", [quiet]);
    await old.sql("update public.members set joined_on = current_date - 30 where id = $1", [quiet]);
    await old.sql("delete from public.audit_log where subject = $1", [quiet]);

    await db.exec(readFileSync(join(dir, mine), "utf8"));

    const statuses = async (id) =>
      (await old.rows("select status, changed_by from public.member_status_changes where member_id = $1 order by id", [id])).map(
        (line) => [line.status, line.changed_by],
      );
    assert.deepEqual(await statuses(riser), [
      ["applicant", null],
      ["recruit", staff],
      ["auxiliary", staff],
      ["member", staff],
      ["reserve", staff],
    ]);
    // The founder was made a full member as they signed in.
    assert.deepEqual((await statuses(founder)).at(-1), ["member", null]);

    const grades = await old.rows(
      "select grade_code, acting, set_by, since = current_date as today from public.assignment_grades where assignment_id = $1 order by id",
      [post.id],
    );
    assert.deepEqual(grades, [
      { grade_code: "E2", acting: false, set_by: command, today: true },
      { grade_code: "E3", acting: false, set_by: command, today: true },
    ]);

    // With nothing in the log, the record starts from what is known now.
    assert.deepEqual(
      await old.rows(
        "select status, changed_on = current_date - 30 as first_day from public.member_status_changes where member_id = $1",
        [quiet],
      ),
      [{ status: "member", first_day: true }],
    );
    assert.deepEqual(
      await old.rows(
        "select grade_code, since = current_date - 20 as first_day from public.assignment_grades where assignment_id = $1",
        [quietPost.rows[0].id],
      ),
      [{ grade_code: "E2", first_day: true }],
    );

    // Every post that carries a grade has its first line, and no post has two for the same day's start.
    const missing = await old.one(
      `select count(*)::int as n from public.assignments a
       where a.kind = 'primary' and not exists (select 1 from public.assignment_grades g where g.assignment_id = a.id)`,
    );
    assert.equal(missing.n, 0);
  } finally {
    await db.close();
  }
});
