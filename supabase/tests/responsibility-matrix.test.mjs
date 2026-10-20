// The responsibility matrix: roles with a stage and a fallback chain, the
// areas as the matrix groups them, the operation types' facts, and the
// situations and tasks the serving fleet reads and admins keep.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const role = {};

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.applicant = await fleet.applicant("7", "Applicant");
  for (const row of await fleet.rows("select id, slug from public.fleet_roles")) role[row.slug] = row.id;
  await fleet.setStage(3);
});
after(() => fleet.close());

test("the matrix arrived whole: the roles, the areas, the types, the situations and the tasks", async () => {
  const counts = await fleet.one(
    `select (select count(*)::int from public.fleet_roles) as roles,
            (select count(*)::int from public.fleet_roles where speciality_of_role_id is not null) as specialities,
            (select count(*)::int from public.areas) as areas,
            (select count(*)::int from public.event_types) as types,
            (select count(*)::int from public.situations) as situations,
            (select count(*)::int from public.tasks) as tasks,
            (select count(*)::int from public.tasks where event_type_id is null and situation_id is null) as spine,
            (select count(*)::int from public.tasks where event_type_id is not null) as modules,
            (select count(*)::int from public.tasks where situation_id is not null) as drills,
            (select count(*)::int from public.task_roles) as links`,
  );
  assert.deepEqual(counts, { roles: 78, specialities: 13, areas: 17, types: 17, situations: 16, tasks: 169, spine: 64, modules: 55, drills: 50, links: 428 });
  // The renames kept the old addresses.
  const renamed = await fleet.rows("select slug, name, former_slugs from public.fleet_roles where cardinality(former_slugs) > 0 order by slug");
  assert.deepEqual(
    renamed.map((row) => `${row.former_slugs[0]} > ${row.slug} (${row.name})`),
    [
      "chief-of-the-boat > coxswain (Coxswain)",
      "flight-deck-chief > deck-chief (Deck Chief)",
      "deck-hand > deck-crew (Deck Crew)",
      "flight-lead > flight-leader (Flight Leader)",
      "tactical-officer > gunnery-officer (Gunnery Officer)",
      "helmsman > helm (Helm)",
      "senior-engineer > lead-engineer (Lead Engineer)",
      "gunnery-chief > lead-gunner (Lead Gunner)",
    ],
  );
  assert.deepEqual(
    (await fleet.rows("select slug, former_slugs[1] as was from public.areas where cardinality(former_slugs) > 0 order by slug")).map((row) => `${row.was} > ${row.slug}`),
    ["command > naval-command", "fighters > pilots", "ship-security > security", "staff-duties > staff", "helm > support"],
  );
  // The positions and the stations kept their roles through the renames.
  assert.equal((await fleet.one("select count(*)::int as n from public.positions p join public.fleet_roles r on r.id = p.role_id where r.slug = 'gunnery-officer'")).n, 1);
  assert.equal((await fleet.one("select count(*)::int as n from public.crew_template_stations s join public.fleet_roles r on r.id = s.role_id where r.slug = 'helm'")).n, 3);
  // The staff posts of the matrix sit on the site's duties.
  const head = await fleet.one("select exists_from, echelon, post_type, kind from public.fleet_roles where slug = 'head-of-logistics-and-medical'");
  assert.deepEqual(head, { exists_from: 3, echelon: "Fleet", post_type: "officer", kind: "duty" });
  // The Task Force Commander exists from stage 3, as Tom decided.
  assert.equal((await fleet.one("select exists_from from public.fleet_roles where slug = 'task-force-commander'")).exists_from, 3);
  // A speciality is of its base role, and takes the base's place before its stage.
  const turret = await fleet.one("select b.slug as base, f.slug as fallback, r.exists_from from public.fleet_roles r join public.fleet_roles b on b.id = r.speciality_of_role_id join public.fleet_roles f on f.id = r.fallback_role_id where r.slug = 'turret-gunner'");
  assert.deepEqual(turret, { base: "gunner", fallback: "gunner", exists_from: 2 });
});

test("an address an admin changes goes on forwarding: the old slug is kept, newest last, at most ten", async () => {
  const admin = fleet.as(who.admin);
  await admin.query("update public.fleet_roles set slug = 'helmsperson' where slug = 'helm'");
  assert.deepEqual((await fleet.one("select former_slugs from public.fleet_roles where slug = 'helmsperson'")).former_slugs, ["helmsman", "helm"]);
  // Back to a former address: that one leaves the list, and the one just left joins it.
  await admin.query("update public.fleet_roles set slug = 'helm' where slug = 'helmsperson'");
  assert.deepEqual((await fleet.one("select former_slugs from public.fleet_roles where slug = 'helm'")).former_slugs, ["helmsman", "helmsperson"]);
  // A change to anything but the address leaves the list alone.
  await admin.query("update public.fleet_roles set sort_order = sort_order where slug = 'helm'");
  assert.deepEqual((await fleet.one("select former_slugs from public.fleet_roles where slug = 'helm'")).former_slugs, ["helmsman", "helmsperson"]);
  // Areas forward the same way, and the list never grows past ten.
  for (let step = 1; step <= 12; step += 1) await admin.query(`update public.areas set slug = 'support-${step}' where slug = '${step === 1 ? "support" : `support-${step - 1}`}'`);
  const area = await fleet.one("select former_slugs from public.areas where slug = 'support-12'");
  assert.equal(area.former_slugs.length, 10);
  assert.deepEqual(area.former_slugs.slice(-2), ["support-10", "support-11"]);
  await admin.query("update public.areas set slug = 'support' where slug = 'support-12'");
});

test("every fallback chain ends at a role that exists at launch, and a loop is refused", async () => {
  const unresolved = await fleet.rows(
    `with recursive chain as (
       select id as start, id, fallback_role_id, exists_from, 1 as hops from public.fleet_roles
       union all
       select c.start, r.id, r.fallback_role_id, r.exists_from, c.hops + 1 from chain c join public.fleet_roles r on r.id = c.fallback_role_id where c.hops < 12
     )
     select s.slug from public.fleet_roles s where not exists (select 1 from chain c where c.start = s.id and c.exists_from = 1)`,
  );
  assert.deepEqual(unresolved, []);
  const admin = fleet.as(who.admin);
  // Gunner falls to nothing; making it fall back to Lead Gunner, which falls to Gunner, would loop.
  await assert.rejects(admin.query("update public.fleet_roles set fallback_role_id = $1 where slug = 'gunner'", [role["lead-gunner"]]), /come back to the role/);
  await assert.rejects(admin.query("update public.fleet_roles set fallback_role_id = id where slug = 'gunner'"), /not_own_fallback|come back to the role/);
  // A speciality of a speciality is refused.
  await assert.rejects(admin.query("update public.fleet_roles set speciality_of_role_id = $1 where slug = 'loader'", [role["turret-gunner"]]), /base role/);
  // The site's rule that a role's own facts are an admin's.
  assert.equal(await fleet.as(who.command).changed("update public.fleet_roles set exists_from = 2 where slug = 'gunner'"), 0);
});

test("the situations and tasks are the serving fleet's to read and an admin's to keep", async () => {
  // A serving member reads every task with its roles; staff too; an applicant and a visitor read none.
  const member = fleet.as(who.member);
  const task = await member.one(
    `select t.wording, d.slug as does, l.slug as leads, c.slug as supervises, t.needed_from
     from public.tasks t join public.fleet_roles d on d.id = t.does_role_id join public.fleet_roles l on l.id = t.leads_role_id
     left join public.fleet_roles c on c.id = t.supervises_command_role_id
     where t.sort_order = 1`,
  );
  assert.deepEqual(task, { wording: "Set the fleet's priorities for the period: region, threats, which types of operation", does: "fleet-commander", leads: "fleet-commander", supervises: null, needed_from: 1 });
  assert.deepEqual(
    (await member.rows("select tr.part, coalesce(r.slug, tr.token) as who from public.task_roles tr join public.tasks t on t.id = tr.task_id left join public.fleet_roles r on r.id = tr.role_id where t.sort_order = 1 order by tr.part, tr.sort_order")).map((row) => `${row.part}:${row.who}`),
    ["consulted:fleet-executive-officer", "consulted:fleet-intelligence-officer", "consulted:head-of-operations-and-planning", "informed:task-force-commander", "informed:head-of-logistics-and-medical"],
  );
  assert.equal((await fleet.as(who.staff).rows("select id from public.situations")).length, 16);
  assert.deepEqual(await fleet.as(who.applicant).rows("select id from public.tasks"), []);
  await assert.rejects(fleet.visitor().query("select id from public.tasks"), /permission denied/);
  await assert.rejects(fleet.visitor().query("select id from public.situations"), /permission denied/);
  // A visitor still reads the roles, with their new facts, as the public roles pages do.
  assert.equal((await fleet.visitor().rows("select slug, exists_from, fallback_role_id from public.fleet_roles where slug = 'gunner'")).length, 1);
  // A situation names who calls it and who owns it.
  const hostile = await member.one("select c.slug as calls, o.slug as owns from public.situations s join public.fleet_roles c on c.id = s.calls_role_id join public.fleet_roles o on o.id = s.owns_role_id where s.slug = 'hostile-contact'");
  assert.deepEqual(hostile, { calls: "commanding-officer", owns: "task-force-commander" });

  // Writes are an admin's.
  const unknown = (await fleet.one("select id from public.situations where slug = 'unknown-contact'")).id;
  for (const actor of [who.member, who.staff, who.command]) {
    await assert.rejects(fleet.as(actor).query("insert into public.situations (slug, name) values ('fire', 'Fire aboard')"), /row-level security/);
    assert.equal(await fleet.as(actor).changed("update public.tasks set notes = 'Mine' where sort_order = 1"), 0);
    assert.equal(await fleet.as(actor).changed("delete from public.task_roles where task_id = (select id from public.tasks where sort_order = 1)"), 0);
  }
  const admin = fleet.as(who.admin);
  const fire = await admin.one("insert into public.situations (slug, name, what_you_see, calls_role_id, owns_role_id, sort_order) values ('fire', 'Fire aboard', 'Flames in a compartment', $1, $2, 17) returning id", [role.engineer, role["commanding-officer"]]);
  const drill = await admin.one(
    "insert into public.tasks (situation_id, phase, echelon, wording, does_role_id, leads_role_id, needed_from, sort_order) values ($1, 'drill', 'Ship', 'Fight the fire', $2, $3, 1, 1000) returning id",
    [fire.id, role.engineer, role["chief-engineer"]],
  );
  await admin.query("insert into public.task_roles (task_id, part, token, sort_order) values ($1, 'informed', 'ships_company', 1)", [drill.id]);
  await assert.rejects(admin.query("insert into public.task_roles (task_id, part, token, sort_order) values ($1, 'informed', 'ships_company', 2)", [drill.id]), /duplicate key/);
  // A task has one home, a drill is a situation's, and a module's task takes its type's stage.
  await assert.rejects(
    admin.query("insert into public.tasks (situation_id, event_type_id, phase, echelon, wording, does_role_id, leads_role_id, sort_order) values ($1, (select id from public.event_types where key = 'patrol'), 'drill', 'Ship', 'Two homes', $2, $2, 1001)", [fire.id, role.engineer]),
    /one_home/,
  );
  await assert.rejects(
    admin.query("insert into public.tasks (phase, echelon, wording, does_role_id, leads_role_id, needed_from, sort_order) values ('drill', 'Ship', 'A drill of nothing', $1, $1, 1, 1002)", [role.engineer]),
    /drill_is_a_situation/,
  );
  await assert.rejects(
    admin.query("insert into public.tasks (event_type_id, phase, echelon, wording, does_role_id, leads_role_id, needed_from, sort_order) values ((select id from public.event_types where key = 'patrol'), 'underway', 'Ship', 'With a stage of its own', $1, $1, 2, 1003)", [role.engineer]),
    /module_takes_its_stage/,
  );
  await assert.rejects(admin.query("insert into public.task_roles (task_id, part, role_id, token) values ($1, 'consulted', $2, 'whole_force')", [drill.id, role.engineer]), /one_of/);
  // A situation or a type with tasks stays, as does a role a task names; a task goes with everyone it consults and informs.
  await assert.rejects(admin.query("delete from public.fleet_roles where slug = 'fleet-commander'"), /foreign key|violates/);
  await assert.rejects(admin.query("delete from public.situations where id = $1", [fire.id]), /foreign key|violates/);
  await assert.rejects(admin.query("delete from public.event_types where key = 'strike'"), /foreign key|violates/);
  assert.equal(await admin.changed("delete from public.tasks where id = $1", [drill.id]), 1);
  assert.deepEqual(await fleet.rows("select id from public.task_roles where task_id = $1", [drill.id]), []);
  assert.equal(await admin.changed("delete from public.situations where id = $1", [fire.id]), 1);
  // The log has it.
  const logged = await fleet.rows("select table_name, action from public.audit_log where actor = $1 and table_name in ('situations', 'tasks', 'task_roles') order by at, table_name", [who.admin]);
  assert.ok(logged.some((row) => row.table_name === "situations" && row.action === "insert"));
  assert.ok(logged.some((row) => row.table_name === "task_roles" && row.action === "insert"));
});

test("the event types carry the matrix's facts, and a type that opens later is still read", async () => {
  const strike = await fleet.as(who.member).one("select family, opens_at, minimum_force, planned_or_reactive from public.event_types where key = 'strike'");
  assert.deepEqual(strike, { family: "Offensive", opens_at: 3, minimum_force: "Two ships with air", planned_or_reactive: "Planned" });
  assert.equal((await fleet.as(who.member).one("select name from public.event_types where key = 'response'")).name, "Quick reaction");
  // A module's tasks are its type's.
  assert.equal((await fleet.one("select count(*)::int as n from public.tasks t join public.event_types e on e.id = t.event_type_id where e.key = 'strike'")).n, 8);
});
