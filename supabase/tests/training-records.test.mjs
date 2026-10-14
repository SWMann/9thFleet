// Training records: each qualification is a course of lessons, instructors
// sign lessons off, and the qualification is awarded once every lesson is.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const qualification = {};
let nextDiscordId = 100;
const fresh = (name, options) => fleet.person(String(nextDiscordId++), name, options);

const lessonsOf = (code) =>
  fleet.rows(
    `select l.id, l.name, l.sort_order from public.lessons l join public.qualifications q on q.id = l.qualification_id
     where q.code = $1 order by l.sort_order, l.name`,
    [code],
  );
const signOff = (actor, lessonId, member, fields = {}) => {
  const row = { lesson_id: lessonId, member_id: member, ...fields };
  const columns = Object.keys(row);
  return fleet.as(actor).one(
    `insert into public.lesson_passes (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})
     returning id, lesson_id, member_id, signed_by, signed_at, event_id`,
    Object.values(row),
  );
};
const withdraw = (actor, passId) => fleet.as(actor).changed("delete from public.lesson_passes where id = $1", [passId]);
const award = (actor, member, code, eventId = null) =>
  fleet.as(actor).query("insert into public.qualification_awards (member_id, qualification_id, awarded_by, event_id) values ($1, $2, $3, $4)", [
    member,
    qualification[code],
    actor,
    eventId,
  ]);
const passesOf = (actor, member) => fleet.as(actor).rows("select lesson_id from public.lesson_passes where member_id = $1", [member]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.instructor = await fleet.person("4", "Instructor", { roles: ["instructor"] });
  who.other = await fleet.person("5", "Other instructor", { roles: ["instructor"] });
  who.member = await fleet.person("6", "Member");
  who.recruit = await fleet.person("7", "Recruit", { status: "recruit" });
  who.applicant = await fleet.applicant("8", "Applicant");
  who.discharged = await fleet.person("9", "Discharged", { status: "discharged" });
  for (const row of await fleet.rows("select id, code from public.qualifications")) qualification[row.code] = row.id;
  await fleet.setStage(3);
});
after(() => fleet.close());

test("every course has its lessons in order, and what it requires first, for the fleet to read", async () => {
  const courses = await fleet.as(who.recruit).rows(
    `select q.code, r.code as requires, count(l.id)::int as lessons
     from public.qualifications q
     left join public.qualifications r on r.id = q.requires_qualification_id
     left join public.lessons l on l.qualification_id = q.id
     group by q.code, r.code order by q.code`,
  );
  assert.deepEqual(
    courses.map((course) => [course.code, course.requires, course.lessons]),
    [
      ["commission", "navy-crew", 6],
      ["induction", null, 5],
      ["instructor", "radio-user", 4],
      ["navy-crew", "radio-user", 6],
      ["net-controller", "radio-user", 4],
      ["radio-user", "induction", 5],
    ],
  );
  assert.deepEqual(
    (await lessonsOf("induction")).map((lesson) => lesson.name),
    ["The fleet and its values", "Conduct and the chain of command", "How an operation runs", "The voice app", "Radio check"],
  );
  // Staff read the syllabus too. An applicant and a visitor do not.
  assert.ok((await fleet.as(who.staff).rows("select id from public.lessons")).length > 0);
  assert.deepEqual(await fleet.as(who.applicant).rows("select id from public.lessons"), []);
  await assert.rejects(fleet.visitor().query("select id from public.lessons"), /permission denied/);
});

test("command edits the syllabus: lessons, their order, and what a course requires", async () => {
  const added = await fleet.as(who.command).one(
    "insert into public.lessons (qualification_id, sort_order, name, description) values ($1, 6, 'Night check', 'A radio check at night.') returning id",
    [qualification.induction],
  );
  assert.equal(await fleet.as(who.command).changed("update public.lessons set name = 'Night radio check', sort_order = 7 where id = $1", [added.id]), 1);
  assert.deepEqual((await lessonsOf("induction")).at(-1).name, "Night radio check");
  // A name is used once in a course, and is tidy.
  await assert.rejects(
    fleet.as(who.command).query("insert into public.lessons (qualification_id, name) values ($1, 'Radio check')", [qualification.induction]),
    /duplicate key/,
  );
  await assert.rejects(fleet.as(who.command).query("insert into public.lessons (qualification_id, name) values ($1, ' Untidy')", [qualification.induction]), /lessons_name_check/);
  for (const actor of [who.staff, who.instructor, who.member]) {
    await assert.rejects(fleet.as(actor).query("insert into public.lessons (qualification_id, name) values ($1, 'Theirs')", [qualification.induction]), /row-level security/);
    assert.equal(await fleet.as(actor).changed("update public.lessons set name = 'Changed' where id = $1", [added.id]), 0);
    assert.equal(await fleet.as(actor).changed("delete from public.lessons where id = $1", [added.id]), 0);
  }
  assert.equal(await fleet.as(who.command).changed("delete from public.lessons where id = $1", [added.id]), 1);
  // A lesson keeps to its course.
  await assert.rejects(
    fleet.as(who.command).query("update public.lessons set qualification_id = $1 where qualification_id = $2", [qualification["radio-user"], qualification.induction]),
    /permission denied/,
  );

  // What a course requires is command's to set; the rest of a qualification stays an admin's.
  await assert.rejects(
    fleet.as(who.command).query("update public.qualifications set requires_qualification_id = null, name = 'Renamed' where code = 'net-controller'"),
    /Command sets what a course requires, and nothing else about it\./,
  );
  assert.equal(await fleet.as(who.command).changed("update public.qualifications set requires_qualification_id = null where code = 'net-controller'"), 1);
  const changed = await fleet.one("select name, requires_qualification_id from public.qualifications where code = 'net-controller'");
  assert.deepEqual(changed, { name: "Net controller", requires_qualification_id: null });
  assert.equal(await fleet.as(who.staff).changed("update public.qualifications set requires_qualification_id = null where code = 'navy-crew'"), 0);
  await assert.rejects(
    fleet.as(who.command).query("update public.qualifications set requires_qualification_id = id where code = 'navy-crew'"),
    /qualifications_requires_another|A course cannot require one that requires it/,
  );
  // Nor round in a circle, however long the way round.
  await fleet.sql("update public.qualifications set requires_qualification_id = $1 where code = 'net-controller'", [qualification["radio-user"]]);
  await assert.rejects(
    fleet.as(who.command).query("update public.qualifications set requires_qualification_id = $1 where code = 'radio-user'", [qualification["net-controller"]]),
    /A course cannot require one that requires it\./,
  );
  await assert.rejects(
    fleet.as(who.admin).query("update public.qualifications set requires_qualification_id = $1 where code = 'induction'", [qualification["navy-crew"]]),
    /A course cannot require one that requires it\./,
  );
});

test("an instructor signs off a lesson for a serving member, in their own name, and the database dates it", async () => {
  const [first, second] = await lessonsOf("induction");
  const pass = await signOff(who.instructor, first.id, who.recruit);
  assert.equal(pass.signed_by, who.instructor);
  assert.ok(Date.now() - new Date(pass.signed_at).getTime() < 60_000);
  assert.equal(pass.event_id, null);
  // Once.
  await assert.rejects(signOff(who.instructor, first.id, who.recruit), /duplicate key/);
  // Who signed, and when, is the database's.
  await assert.rejects(signOff(who.instructor, second.id, who.recruit, { signed_by: who.other }), /permission denied/);
  await assert.rejects(signOff(who.instructor, second.id, who.recruit, { signed_at: "2020-01-01" }), /permission denied/);
  // Not their own, not by anyone but an instructor, and not for anyone outside the serving fleet.
  await assert.rejects(signOff(who.instructor, second.id, who.instructor), /Nobody signs off their own lesson/);
  for (const actor of [who.member, who.staff, who.command, who.recruit]) {
    await assert.rejects(signOff(actor, second.id, who.recruit), /Only an instructor signs off a lesson/, "not an instructor");
  }
  await assert.rejects(signOff(who.instructor, second.id, who.applicant), /for a serving member/);
  await assert.rejects(signOff(who.instructor, second.id, who.discharged), /for a serving member/);
  // A course that requires another waits for it.
  const [radio] = await lessonsOf("radio-user");
  await assert.rejects(signOff(who.instructor, radio.id, who.recruit), /They must hold General induction first\./);
  // The admin holds every role, and may sign off their own, to start the chain.
  await signOff(who.admin, second.id, who.admin);
});

test("a sign-off at an event is checked against the event, as an award is", async () => {
  const trainee = await fresh("Trainee", { status: "recruit" });
  await fleet.qualify(trainee, "induction");
  const [first, second] = await lessonsOf("radio-user");
  const event = await fleet.as(who.command).one(
    "insert into public.events (kind, title, starts_at, commander_id, teaches_qualification_id) values ('training', 'Radio course 001', now() + interval '3 days', $1, $2) returning id",
    [who.instructor, qualification["radio-user"]],
  );
  await fleet.as(who.command).query("update public.events set state = 'announced' where id = $1", [event.id]);
  await fleet.as(trainee).query("insert into public.attendance (event_id, member_id, reply) values ($1, $2, 'attending')", [event.id, trainee]);
  await assert.rejects(signOff(who.instructor, first.id, trainee, { event_id: event.id }), /once the event has started/);
  await fleet.sql("update public.events set starts_at = now() - interval '1 hour', announced_at = now() - interval '3 days' where id = $1", [event.id]);
  const pass = await signOff(who.instructor, first.id, trainee, { event_id: event.id });
  assert.equal(pass.event_id, event.id);
  // The event teaches one course. Someone who was not there is not signed off at it.
  const [navy] = await lessonsOf("navy-crew");
  const absent = await fresh("Absent", { status: "recruit" });
  await fleet.qualify(absent, "induction");
  await fleet.qualify(who.member, "induction", "radio-user");
  await assert.rejects(signOff(who.instructor, navy.id, who.member, { event_id: event.id }), /does not teach this qualification/);
  await assert.rejects(signOff(who.instructor, second.id, absent, { event_id: event.id }), /was not at the event/);
  // Marked absent, the roll no longer counts.
  await fleet.as(who.instructor).query("insert into public.attendance_returns (event_id, member_id, returned) values ($1, $2, 'absent_without_notice')", [event.id, trainee]);
  await assert.rejects(signOff(who.instructor, second.id, trainee, { event_id: event.id }), /was marked absent/);
  // One to one is always open.
  await signOff(who.instructor, second.id, trainee);
});

test("the qualification is awarded once every lesson is signed off, as a separate step", async () => {
  const trainee = await fresh("Keen", { status: "recruit" });
  const lessons = await lessonsOf("induction");
  for (const lesson of lessons.slice(0, -1)) await signOff(who.instructor, lesson.id, trainee);
  await assert.rejects(award(who.instructor, trainee, "induction"), /Every lesson of the course is signed off before/);
  await signOff(who.other, lessons.at(-1).id, trainee);
  // What the course requires is held first, on the award as on the lessons.
  await fleet.passLessons(trainee, "radio-user");
  await assert.rejects(award(who.instructor, trainee, "radio-user"), /They must hold General induction first\./);
  await fleet.sql("delete from public.lesson_passes p using public.lessons l where l.id = p.lesson_id and l.qualification_id = $1 and p.member_id = $2", [qualification["radio-user"], trainee]);
  await award(who.instructor, trainee, "induction");
  // Holding it, there is nothing left to sign off.
  await assert.rejects(signOff(who.instructor, lessons[0].id, trainee), /They already hold this qualification/);
  const [radio] = await lessonsOf("radio-user");
  await signOff(who.instructor, radio.id, trainee);
  // A course with no lessons is awarded as before. The SQL editor is not held to the lessons.
  await fleet.sql("delete from public.lessons where qualification_id = $1", [qualification["net-controller"]]);
  await fleet.qualify(trainee, "radio-user");
  await award(who.instructor, trainee, "net-controller");
  const held = await fleet.rows("select q.code from public.qualification_awards a join public.qualifications q on q.id = a.qualification_id where a.member_id = $1 order by q.code", [trainee]);
  assert.deepEqual(
    held.map((row) => row.code),
    ["induction", "net-controller", "radio-user"],
  );
});

test("a commission is the board's decision, which command records", async () => {
  const cadet = await fresh("Cadet", { status: "member" });
  await fleet.qualify(cadet, "induction", "radio-user", "navy-crew");
  await fleet.passLessons(cadet, "commission");
  await assert.rejects(award(who.instructor, cadet, "commission"), /The commissioning board commissions an officer, and command records its decision\./);
  await assert.rejects(award(who.command, cadet, "commission"), /row-level security/, "command without the instructor role may not award at all");
  const commandant = await fresh("Commandant", { roles: ["command", "instructor"] });
  await award(commandant, cadet, "commission");
});

test("taking a qualification away takes the course's passes with it", async () => {
  const lapsed = await fresh("Lapsed", { status: "recruit" });
  await fleet.passLessons(lapsed, "induction");
  await award(who.instructor, lapsed, "induction");
  assert.equal((await passesOf(who.staff, lapsed)).length, 5);
  assert.equal(await fleet.as(who.staff).changed("delete from public.qualification_awards where member_id = $1", [lapsed]), 1);
  assert.deepEqual(await passesOf(who.staff, lapsed), []);
  assert.deepEqual(await fleet.as(who.staff).rows("select passed from public.training_progress where member_id = $1", [lapsed]), []);
  // The SQL editor, putting a mistake right, keeps them.
  await fleet.passLessons(lapsed, "induction");
  await fleet.qualify(lapsed, "induction");
  await fleet.sql("delete from public.qualification_awards where member_id = $1", [lapsed]);
  assert.equal((await passesOf(who.staff, lapsed)).length, 5);
});

test("the instructor who signed a lesson off withdraws it, until the qualification is awarded", async () => {
  const trainee = await fresh("Unsure", { status: "recruit" });
  const lessons = await lessonsOf("induction");
  const mine = await signOff(who.instructor, lessons[0].id, trainee);
  const theirs = await signOff(who.other, lessons[1].id, trainee);
  assert.equal(await withdraw(who.other, mine.id), 0, "another instructor");
  assert.equal(await withdraw(who.command, mine.id), 0, "command");
  assert.equal(await withdraw(who.staff, mine.id), 0, "staff");
  assert.equal(await withdraw(trainee, mine.id), 0, "the member");
  assert.equal(await withdraw(who.instructor, mine.id), 1, "the instructor who signed it");
  // Nothing about a pass is changed, only withdrawn.
  await assert.rejects(fleet.as(who.other).query("update public.lesson_passes set event_id = null where id = $1", [theirs.id]), /permission denied/);
  // Once the qualification is awarded, the passes stand.
  await fleet.passLessons(trainee, "induction");
  await award(who.instructor, trainee, "induction");
  assert.equal(await withdraw(who.other, theirs.id), 0);
  // A lesson someone has passed stays on the syllabus.
  await assert.rejects(fleet.as(who.command).query("delete from public.lessons where id = $1", [lessons[1].id]), /foreign key constraint "lesson_passes_lesson_id_fkey"/);
});

test("a member sees their own passes; instructors and staff see everyone's", async () => {
  const trainee = await fresh("Private", { status: "recruit" });
  const lessons = await lessonsOf("induction");
  await signOff(who.instructor, lessons[0].id, trainee);
  assert.equal((await passesOf(trainee, trainee)).length, 1);
  // Where they are in the course is read the same way.
  const progress = (actor) => actor.rows("select passed, lessons, complete, held from public.training_progress where member_id = $1", [trainee]);
  assert.deepEqual(await progress(fleet.as(trainee)), [{ passed: 1, lessons: 5, complete: false, held: false }]);
  assert.deepEqual(await progress(fleet.as(who.instructor)), [{ passed: 1, lessons: 5, complete: false, held: false }]);
  assert.deepEqual(await progress(fleet.as(who.member)), []);
  assert.equal((await passesOf(who.member, trainee)).length, 0, "another member");
  assert.equal((await passesOf(who.applicant, trainee)).length, 0, "an applicant");
  for (const reader of [who.instructor, who.other, who.staff, who.command, who.admin]) {
    assert.equal((await passesOf(reader, trainee)).length, 1, "instructors and staff");
  }
  // An instructor who is not staff sees the passes of the members they can see, so not a discharged member's.
  await fleet.sql("update public.members set status = 'discharged' where id = $1", [trainee]);
  assert.equal((await passesOf(who.instructor, trainee)).length, 0, "an instructor, of a discharged member");
  assert.equal((await passesOf(who.staff, trainee)).length, 1, "staff, of a discharged member");
  assert.equal((await passesOf(trainee, trainee)).length, 1, "their own");
  assert.deepEqual(await fleet.as(who.instructor).rows("select passed from public.training_progress where member_id = $1", [trainee]), []);
  await fleet.sql("update public.members set status = 'recruit' where id = $1", [trainee]);
  await assert.rejects(fleet.visitor().query("select id from public.lesson_passes"), /permission denied/);
  await assert.rejects(fleet.visitor().query("select * from public.training_progress"), /permission denied/);
  await fleet.passLessons(trainee, "induction");
  assert.deepEqual(await progress(fleet.as(who.staff)), [{ passed: 5, lessons: 5, complete: true, held: false }]);
  await fleet.qualify(trainee, "induction");
  assert.deepEqual(await progress(fleet.as(who.staff)), [{ passed: 5, lessons: 5, complete: true, held: true }]);
});

test("every sign-off and withdrawal is in the log of changes, under the member, and goes with them", async () => {
  const trainee = await fresh("Logged", { status: "recruit" });
  const [lesson] = await lessonsOf("induction");
  const pass = await signOff(who.instructor, lesson.id, trainee);
  await withdraw(who.instructor, pass.id);
  const lines = await fleet.rows("select actor, action, subject from public.audit_log where table_name = 'lesson_passes' and subject = $1 order by id", [trainee]);
  assert.deepEqual(
    lines.map((line) => [line.actor, line.action]),
    [
      [who.instructor, "insert"],
      [who.instructor, "delete"],
    ],
  );
  await signOff(who.instructor, lesson.id, trainee);
  await fleet.sql("delete from auth.users where id = $1", [trainee]);
  assert.deepEqual(await fleet.rows("select id from public.lesson_passes where member_id = $1", [trainee]), []);
  const blanked = await fleet.rows("select old_row, new_row from public.audit_log where table_name = 'lesson_passes' and subject = $1", [trainee]);
  assert.ok(blanked.length >= 3);
  assert.ok(blanked.every((line) => line.old_row === null && line.new_row === null));
  // The lesson itself is still on the syllabus.
  assert.equal((await lessonsOf("induction")).length, 5);
});

test("deleting an instructor leaves the passes they signed, unsigned", async () => {
  const leaver = await fresh("Leaving instructor", { roles: ["instructor"] });
  const trainee = await fresh("Taught", { status: "recruit" });
  const [lesson] = await lessonsOf("induction");
  const pass = await signOff(leaver, lesson.id, trainee);
  await fleet.sql("delete from auth.users where id = $1", [leaver]);
  const kept = await fleet.one("select signed_by from public.lesson_passes where id = $1", [pass.id]);
  assert.deepEqual(kept, { signed_by: null });
});
