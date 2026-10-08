// Qualifications, appointments to positions, and the rank that follows.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

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

/** Make an appointment as `actor`. `extra` adds columns such as grade_code or acting. */
const appoint = (actor, memberId, positionId, extra = {}) => {
  const row = { member_id: memberId, position_id: positionId, kind: "primary", ...extra };
  const columns = Object.keys(row);
  const marks = columns.map((_, index) => `$${index + 1}`).join(", ");
  return fleet.as(actor).one(
    `insert into public.assignments (${columns.join(", ")}) values (${marks}) returning *`,
    Object.values(row),
  );
};

const end = (actor, assignmentId) =>
  fleet.as(actor).changed("update public.assignments set ended_on = current_date where id = $1", [assignmentId]);

/** Move an assignment into the past, as only the database owner can. */
const backdate = (assignmentId, startedDaysAgo, endedDaysAgo) =>
  fleet.sql(
    `update public.assignments
     set started_on = current_date - $2::int, ended_on = current_date - $3::int
     where id = $1`,
    [assignmentId, startedDaysAgo, endedDaysAgo],
  );

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.instructor = await fleet.person("4", "Instructor", { roles: ["instructor"] });
  who.member = await fleet.person("5", "Member");
  await fleet.setStage(3);
});
after(() => fleet.close());

const qualificationId = async (code) => (await fleet.one("select id from public.qualifications where code = $1", [code])).id;
const award = (actor, memberId, qualification, awardedBy = actor) =>
  fleet.as(actor).query(
    "insert into public.qualification_awards (member_id, qualification_id, awarded_by) values ($1, $2, $3)",
    [memberId, qualification, awardedBy],
  );

test("an instructor awards a qualification in their own name, dated today", async () => {
  const recruit = await fresh("Trainee", { status: "recruit" });
  const radio = await qualificationId("radio-user");
  await award(who.instructor, recruit, radio);
  const row = await fleet.one(
    "select awarded_by, awarded_on = current_date as today from public.qualification_awards where member_id = $1",
    [recruit],
  );
  assert.deepEqual(row, { awarded_by: who.instructor, today: true });

  await assert.rejects(
    fleet.as(who.instructor).query(
      "insert into public.qualification_awards (member_id, qualification_id, awarded_by, awarded_on) values ($1, $2, $3, '2001-01-01')",
      [recruit, await qualificationId("navy-crew"), who.instructor],
    ),
    /permission denied/,
  );
});

test("a qualification cannot be self-awarded, signed as someone else, given to an applicant, or awarded by a non-instructor", async () => {
  const recruit = await fresh("Trainee two", { status: "recruit" });
  const applicant = await fleet.signIn(String(nextDiscordId++), "Applicant");
  const radio = await qualificationId("radio-user");

  await assert.rejects(award(who.instructor, who.instructor, radio), /row-level security/, "own qualification");
  await assert.rejects(award(who.instructor, recruit, radio, who.admin), /row-level security/, "someone else's name");
  await assert.rejects(award(who.instructor, applicant, radio), /row-level security/, "an applicant");
  await assert.rejects(award(who.member, recruit, radio), /row-level security/, "not an instructor");
  await assert.rejects(award(who.staff, recruit, radio), /row-level security/, "staff are not instructors");
});

test("the admin can sign off their own qualification, to start the chain", async () => {
  await award(who.admin, who.admin, await qualificationId("instructor"));
});

test("staff remove an award, but not their own or an admin's", async () => {
  const id = await crewMember("Lapsed");
  await fleet.qualify(who.staff, "radio-user");
  const remove = (actor, memberId) =>
    fleet.as(actor).changed("delete from public.qualification_awards where member_id = $1", [memberId]);
  assert.equal(await remove(who.member, id), 0);
  assert.equal(await remove(who.staff, who.admin), 0);
  assert.equal(await remove(who.staff, who.staff), 0);
  assert.equal(await remove(who.staff, id), 3);
});

test("only command makes an appointment", async () => {
  const id = await crewMember("Able");
  const post = await fleet.positionId("Training Ship", "Gunner 1");
  for (const actor of [who.member, who.staff, who.instructor, id]) {
    await assert.rejects(appoint(actor, id, post), /Appointments are a command decision/);
  }
  const made = await appoint(who.command, id, post);
  assert.equal(made.grade_code, "E2", "a new member starts at the bottom of an entry band");
  assert.equal(made.appointed_by, who.command);

  const line = await fleet.rosterLine(id);
  assert.equal(line.rank_name, "Starman");
  assert.equal(line.position_title, "Gunner 1");
  assert.equal(line.unit_name, "Training Ship");
});

test("trying to make an appointment tells an outsider nothing", async () => {
  const applicant = await fleet.signIn(String(nextDiscordId++), "Outsider");
  const discharged = await fresh("Gone", { status: "discharged" });
  const recruit = await fresh("Not yet a member", { status: "recruit" });
  const probes = [
    [who.member, await fleet.positionId("Bridge", "Commanding Officer")],
    [recruit, await fleet.positionId("Training Ship", "Gunner 2")],
    [who.member, await fleet.positionId("Fleet Staff", "Recruiter")],
    [who.admin, await fleet.positionId("Fleet Command", "Fleet Commander")],
  ];
  for (const actor of [applicant, discharged]) {
    for (const [target, post] of probes) {
      await assert.rejects(appoint(actor, target, post), /^error: Appointments are a command decision\.$/);
    }
  }
});

test("who made an appointment, and its dates, cannot be sent from outside", async () => {
  const id = await crewMember("Baker");
  const post = await fleet.positionId("Training Ship", "Gunner 2");
  await assert.rejects(appoint(who.command, id, post, { appointed_by: who.admin }), /permission denied/);
  await assert.rejects(appoint(who.command, id, post, { started_on: "2020-01-01" }), /permission denied/);
  await assert.rejects(appoint(who.command, id, post, { started_on: "2020-01-01", ended_on: "2099-12-31" }), /permission denied/);
  const made = await appoint(who.command, id, post);
  assert.equal(made.appointed_by, who.command);
  assert.equal(made.ended_on, null);
});

test("an assignment ends on the day it is ended", async () => {
  const id = await crewMember("Charlie");
  const made = await appoint(who.command, id, await fleet.positionId("Training Ship", "Gunner 3"));
  const command = fleet.as(who.command);
  await assert.rejects(command.query("update public.assignments set ended_on = current_date - 99 where id = $1", [made.id]), /ends on the day it is ended/);
  await assert.rejects(command.query("update public.assignments set ended_on = current_date + 99 where id = $1", [made.id]), /ends on the day it is ended/);
  assert.equal(await end(who.command, made.id), 1);
  assert.equal((await fleet.rosterLine(id)).grade_code, "E2", "the grade is kept for now");
});

test("a position needs its qualifications", async () => {
  const id = await fresh("Unqualified");
  const post = await fleet.positionId("Training Ship", "Gunner 4");
  await assert.rejects(appoint(who.command, id, post), /needs the Navy crew qualification/);
  await fleet.qualify(id, "navy-crew");
  await assert.rejects(appoint(who.command, id, post), /needs the Radio user qualification/);
  await fleet.qualify(id, "radio-user");
  await appoint(who.command, id, post);
});

test("only a full member holds a position", async () => {
  const recruit = await fresh("Recruit", { status: "recruit" });
  await fleet.qualify(recruit, "radio-user", "navy-crew");
  await assert.rejects(
    appoint(who.command, recruit, await fleet.positionId("Training Ship", "Helmsman")),
    /Only a full member/,
  );
});

test("a Navy position goes to a member of the Navy", async () => {
  const soldier = await crewMember("Soldier", { service: "army" });
  await assert.rejects(
    appoint(who.command, soldier, await fleet.positionId("Training Ship", "Helmsman")),
    /belongs to the Navy/,
  );
});

test("a position cannot be filled before its stage opens", async () => {
  const id = await crewMember("Early");
  const post = await fleet.positionId("Bridge", "Commanding Officer");
  await assert.rejects(appoint(who.command, id, post, { acting: true }), /does not open until stage 5/);

  await fleet.setStage(1);
  await assert.rejects(
    appoint(who.command, id, await fleet.positionId("Gunnery", "Turret Gunner 1")),
    /does not open until stage 2/,
  );
  await fleet.setStage(3);
});

test("a position cannot open before the unit it belongs to, or the units above that", async () => {
  const id = await crewMember("Too early");
  const gunnery = (await fleet.one("select id from public.units where name = 'Gunnery'")).id;
  const added = await fleet.as(who.admin).one(
    `insert into public.positions (unit_id, role_id, title, kind, nominal_grade, min_grade, max_grade, is_entry, opens_at_stage)
     values ($1, $2, 'Powder Monkey', 'primary', 'E2', 'E2', 'E4', false, 1) returning id`,
    [gunnery, await fleet.roleId("gunner")],
  );
  await fleet.setStage(1);
  await assert.rejects(appoint(who.command, id, added.id), /does not open until stage 2/);
  await fleet.setStage(3);
  await fleet.sql("delete from public.positions where id = $1", [added.id]);
});

test("one holder per position and one primary position per member", async () => {
  const first = await crewMember("First");
  const second = await crewMember("Second");
  const post = await fleet.positionId("Gunnery", "Turret Gunner 1");
  await appoint(who.command, first, post);
  await assert.rejects(appoint(who.command, second, post), /duplicate key/);
  await assert.rejects(
    appoint(who.command, first, await fleet.positionId("Gunnery", "Turret Gunner 2")),
    /duplicate key/,
  );
});

test("the grade stays inside the band, on appointment and on promotion", async () => {
  const id = await crewMember("Climber");
  const post = await fleet.positionId("Gunnery", "Turret Gunner 3");
  await assert.rejects(appoint(who.command, id, post, { grade_code: "E5" }), /outside this position's band, E2 to E4/);
  await assert.rejects(appoint(who.command, id, post, { grade_code: "E1" }), /outside this position's band/);

  const made = await appoint(who.command, id, post);
  const command = fleet.as(who.command);
  assert.equal(await command.changed("update public.assignments set grade_code = 'E3' where id = $1", [made.id]), 1);
  assert.equal((await fleet.rosterLine(id)).rank_name, "Leading Starman");
  await assert.rejects(
    command.query("update public.assignments set grade_code = 'E5' where id = $1", [made.id]),
    /outside this position's band/,
  );
  await assert.rejects(
    command.query("update public.assignments set grade_code = null where id = $1", [made.id]),
    /always carries a grade/,
  );
  assert.equal(await fleet.as(who.staff).changed("update public.assignments set grade_code = 'E4' where id = $1", [made.id]), 0);
});

test("command cannot appoint or promote themselves", async () => {
  await fleet.qualify(who.command, "radio-user", "navy-crew");
  const post = await fleet.positionId("Gunnery", "Turret Gunner 7");
  await assert.rejects(appoint(who.command, who.command, post), /cannot appoint or promote yourself/);

  // The admin appoints them. They still cannot raise their own grade, but they
  // can step down.
  const made = await appoint(who.admin, who.command, post);
  const command = fleet.as(who.command);
  await assert.rejects(command.query("update public.assignments set grade_code = 'E4' where id = $1", [made.id]), /cannot appoint or promote yourself/);
  assert.equal(await end(who.command, made.id), 1);
});

test("command cannot touch an admin's appointments", async () => {
  const held = await fleet.one("select id from public.assignments where member_id = $1 and ended_on is null", [who.admin]);
  const command = fleet.as(who.command);
  await assert.rejects(command.query("update public.assignments set ended_on = current_date where id = $1", [held.id]), /Only an admin/);
  await assert.rejects(command.query("update public.assignments set grade_code = 'O5' where id = $1", [held.id]), /Only an admin/);
  await assert.rejects(
    appoint(who.command, who.admin, await fleet.positionId("Fleet Staff", "Recruiter"), { kind: "duty" }),
    /Only an admin/,
  );
  assert.equal((await fleet.rosterLine(who.admin)).position_title, "Fleet Commander");
});

test("an officer position needs a commission, unless the appointment is acting", async () => {
  const id = await crewMember("Number One");
  const post = await fleet.positionId("Bridge", "Executive Officer");
  await assert.rejects(appoint(who.command, id, post), /needs the Commission qualification/);

  const made = await appoint(who.command, id, post, { acting: true });
  assert.equal(made.grade_code, "O2", "the bottom of the band");
  const line = await fleet.rosterLine(id);
  assert.equal(line.rank_name, "Lieutenant Junior Grade");
  assert.equal(line.acting, true);

  // An acting holder is confirmed only once they hold the commission.
  const command = fleet.as(who.command);
  await assert.rejects(
    command.query("update public.assignments set acting = false where id = $1", [made.id]),
    /needs the Commission qualification/,
  );

  // The acting rank ends with the acting appointment.
  await end(who.command, made.id);
  const after = await fleet.rosterLine(id);
  assert.equal(after.grade_code, "E2");
  assert.equal(after.rank_name, "Starman");
});

test("a commissioned officer takes an officer position in their own right, or is confirmed in it", async () => {
  const id = await crewMember("Guns");
  await fleet.qualify(id, "commission");
  const made = await appoint(who.command, id, await fleet.positionId("Bridge", "Tactical Officer"), { grade_code: "O2" });
  assert.equal(made.acting, false);
  assert.equal((await fleet.rosterLine(id)).rank_name, "Lieutenant Junior Grade");

  const acting = await crewMember("Wings");
  const flight = await appoint(who.command, acting, await fleet.positionId("A Flight", "Flight Lead"), { acting: true });
  await fleet.qualify(acting, "commission");
  assert.equal(await fleet.as(who.command).changed("update public.assignments set acting = false where id = $1", [flight.id]), 1);
});

test("moving to a new position keeps the grade if it fits and otherwise takes the bottom of the band", async () => {
  const id = await crewMember("Mover");
  const first = await appoint(who.command, id, await fleet.positionId("Gunnery", "Turret Gunner 4"), { grade_code: "E3" });
  await end(who.command, first.id);

  // E3 is inside the Senior Engineer's band of E3 to E5.
  const second = await appoint(who.command, id, await fleet.positionId("Engineering", "Senior Engineer"));
  assert.equal(second.grade_code, "E3");
  await end(who.command, second.id);

  // E3 is below the Chief Engineer's band of E5 to E7.
  const third = await appoint(who.command, id, await fleet.positionId("Engineering", "Chief Engineer"));
  assert.equal(third.grade_code, "E5");
  assert.equal((await fleet.rosterLine(id)).rank_name, "Petty Officer");
});

test("rank is kept for 30 days after leaving a position, then drops to the bottom of the band", async () => {
  const cases = [
    { name: "Rating", unit: "Gunnery", title: "Turret Gunner 5", grade: "E3", floor: "E2" },
    { name: "Petty officer", unit: "Bridge", title: "Helmsman", grade: "E5", floor: "E4" },
    { name: "Officer", unit: "Escort One", title: "Commanding Officer", grade: "O2", floor: "O1", commission: true },
  ];
  for (const item of cases) {
    const id = await crewMember(item.name);
    if (item.commission) await fleet.qualify(id, "commission");
    const made = await appoint(who.command, id, await fleet.positionId(item.unit, item.title), { grade_code: item.grade });

    await backdate(made.id, 100, 10);
    assert.equal((await fleet.rosterLine(id)).grade_code, item.grade, `${item.name}: 10 days out`);
    assert.equal((await fleet.rosterLine(id)).position_title, null);

    await backdate(made.id, 100, 40);
    assert.equal((await fleet.rosterLine(id)).grade_code, item.floor, `${item.name}: 40 days out`);
  }
});

test("time spent acting up does not cost someone their own grade", async () => {
  const id = await crewMember("Stand-in");
  const own = await appoint(who.command, id, await fleet.positionId("Gunnery", "Gunnery Chief"), { grade_code: "E6" });

  // They left their own position 40 days ago to act as Executive Officer.
  await backdate(own.id, 200, 40);
  const stint = await appoint(who.command, id, await fleet.positionId("Bridge", "Executive Officer"), { acting: true });
  assert.equal((await fleet.rosterLine(id)).grade_code, "O2");

  // The acting appointment ends today. They are back at their own grade.
  await fleet.sql("update public.assignments set started_on = current_date - 40, ended_on = current_date where id = $1", [stint.id]);
  assert.equal((await fleet.rosterLine(id)).grade_code, "E6", "their own grade, for 30 days from today");

  await backdate(stint.id, 80, 40);
  assert.equal((await fleet.rosterLine(id)).grade_code, "E4", "then the bottom of their band");
});

test("a secondary duty is held alongside a position, by a pool, one each", async () => {
  const leader = await crewMember("Team leader");
  const second = await crewMember("Second leader");
  const hand = await crewMember("Hand");
  const recruiter = await fleet.positionId("Fleet Staff", "Recruiter");
  const signaller = await fleet.positionId("Bridge", "Signaller");

  // Not every requirement is waived for an acting holder.
  await assert.rejects(
    appoint(who.command, leader, signaller, { grade_code: "E4", acting: true }),
    /needs the Net controller qualification/,
  );
  await fleet.qualify(leader, "net-controller");
  await appoint(who.command, leader, signaller, { grade_code: "E4" });
  await appoint(who.command, second, await fleet.positionId("Medical", "Medic"), { grade_code: "E4" });
  await appoint(who.command, hand, await fleet.positionId("Gunnery", "Turret Gunner 6"));

  // The Recruiter duty is open to E4 and above.
  await assert.rejects(appoint(who.command, hand, recruiter, { kind: "duty" }), /open to E4 and above/);
  const duty = await appoint(who.command, leader, recruiter, { kind: "duty" });
  assert.equal(duty.grade_code, null, "a duty carries no rank");
  await appoint(who.command, second, recruiter, { kind: "duty" });

  // One duty at most.
  await fleet.qualify(leader, "instructor");
  await assert.rejects(
    appoint(who.command, leader, await fleet.positionId("Fleet Staff", "Instructor"), { kind: "duty" }),
    /duplicate key/,
  );

  const line = await fleet.rosterLine(leader);
  assert.equal(line.position_title, "Signaller", "the roster shows the primary position");
  assert.equal(line.rank_name, "Jr. Petty Officer");
});

test("the Instructor duty needs the Instructor qualification", async () => {
  const id = await crewMember("Teacher");
  const duty = await fleet.positionId("Fleet Staff", "Instructor");
  await assert.rejects(appoint(who.command, id, duty, { kind: "duty" }), /needs the Instructor qualification/);
  await fleet.qualify(id, "instructor");
  await appoint(who.command, id, duty, { kind: "duty" });
});

test("a duty cannot be recorded as a primary position, or the other way round", async () => {
  const id = await crewMember("Confused");
  await assert.rejects(
    appoint(who.command, id, await fleet.positionId("Fleet Staff", "Staff Clerk")),
    /is a duty position/,
  );
  await assert.rejects(
    appoint(who.command, id, await fleet.positionId("Engineering", "Engineer 2"), { kind: "duty" }),
    /is a primary position/,
  );
});

test("an assignment cannot be moved, and an ended one is the service record", async () => {
  const id = await crewMember("Recorded");
  const other = await crewMember("Other");
  const command = fleet.as(who.command);
  const made = await appoint(who.command, id, await fleet.positionId("Engineering", "Engineer 1"));

  await assert.rejects(command.query("update public.assignments set member_id = $2 where id = $1", [made.id, other]), /permission denied/);
  await assert.rejects(
    command.query("update public.assignments set position_id = $2 where id = $1", [made.id, await fleet.positionId("Engineering", "Engineer 2")]),
    /permission denied/,
  );
  await assert.rejects(command.query("update public.assignments set started_on = '2020-01-01' where id = $1", [made.id]), /permission denied/);
  await assert.rejects(
    fleet.sql("update public.assignments set member_id = $2 where id = $1", [made.id, other]),
    /cannot be moved/,
    "not even from the SQL editor",
  );

  assert.equal(await command.changed("update public.assignments set ended_on = current_date, note = 'Posted out.' where id = $1", [made.id]), 1);
  await assert.rejects(command.query("update public.assignments set note = 'Rewritten.' where id = $1", [made.id]), /service record/);
  await assert.rejects(command.query("update public.assignments set ended_on = null where id = $1", [made.id]), /service record/);

  assert.equal(await command.changed("delete from public.assignments where id = $1", [made.id]), 0);
  assert.equal(await fleet.as(who.admin).changed("delete from public.assignments where id = $1", [made.id]), 1);
});

test("the admin keeps the order of battle, and nobody else can change it", async () => {
  const unit = (await fleet.one("select id from public.units where name = 'Escort One'")).id;
  const bridgeCo = await fleet.positionId("Bridge", "Commanding Officer");
  for (const actor of [who.member, who.staff, who.command]) {
    const outsider = fleet.as(actor);
    await assert.rejects(
      outsider.query("insert into public.positions (unit_id, title, kind) values ($1, 'Stowaway', 'duty')", [unit]),
      /row-level security/,
    );
    await assert.rejects(
      outsider.query("insert into public.units (parent_id, name, kind) values ($1, 'Shadow Fleet', 'ship')", [unit]),
      /row-level security/,
    );
    assert.equal(await outsider.changed("update public.positions set opens_at_stage = 1 where id = $1", [bridgeCo]), 0);
    assert.equal(await outsider.changed("update public.positions set max_grade = 'O10' where title = 'Gunner 1'"), 0);
    assert.equal(await outsider.changed("update public.units set opens_at_stage = 1"), 0);
    assert.equal(await outsider.changed("delete from public.units where name = 'Escort One'"), 0);
    assert.equal(await outsider.changed("update public.qualifications set name = 'Anything'"), 0);
    assert.equal(await outsider.changed("delete from public.position_qualifications where position_id = $1", [bridgeCo]), 0);
  }

  const admin = fleet.as(who.admin);
  await admin.query(
    `insert into public.positions (unit_id, role_id, title, kind, nominal_grade, min_grade, max_grade, is_entry, opens_at_stage)
     values ($1, $2, 'Gunner 4', 'primary', 'E2', 'E2', 'E4', true, 4)`,
    [unit, await fleet.roleId("gunner")],
  );
  await assert.rejects(
    admin.query("insert into public.positions (unit_id, role_id, title, kind) values ($1, $2, 'No grades', 'primary')", [
      unit,
      await fleet.roleId("gunner"),
    ]),
    /positions_primary_has_grades/,
  );
  await assert.rejects(admin.query("update public.units set parent_id = id where id = $1", [unit]), /units_not_own_parent/);
});
