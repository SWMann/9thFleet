// Areas and fleet roles: every position has a role, who keeps them, and how a
// role's needs are checked when someone is appointed.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

const denied = (work) => assert.rejects(work, (error) => /row-level security|permission denied/.test(error.message));
const appoint = (actor, memberId, positionId, extra = {}) => {
  const row = { member_id: memberId, position_id: positionId, kind: "primary", ...extra };
  const columns = Object.keys(row);
  return fleet.as(actor).one(
    `insert into public.assignments (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
};
let made = 0;
/** A full member of the Navy with the recruit route behind them. */
const crewMember = async (name) => {
  made += 1;
  const id = await fleet.person(String(100 + made), name);
  await fleet.qualify(id, "radio-user", "navy-crew");
  return id;
};

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

test("every position has a role, and the first roles are the Fleet Commander's", async () => {
  const counts = await fleet.one(
    `select (select count(*)::int from public.areas) as areas,
            (select count(*)::int from public.fleet_roles) as roles,
            (select count(*)::int from public.positions) as positions,
            (select count(*)::int from public.positions where role_id is null) as without`,
  );
  assert.deepEqual(counts, { areas: 15, roles: 30, positions: 52, without: 0 });

  const titles = (slug) =>
    fleet
      .rows(
        `select regexp_replace(p.title, ' \\d+$', '') as title, count(*)::int as posts
         from public.positions p join public.fleet_roles r on r.id = p.role_id
         where r.slug = $1 group by 1 order by 1`,
        [slug],
      );
  // One Gunner role covers a small ship's gunners, the turret gunners and the remote weapons operators.
  assert.deepEqual(await titles("gunner"), [
    { title: "Gunner", posts: 7 },
    { title: "Remote Weapons Operator", posts: 2 },
    { title: "Turret Gunner", posts: 7 },
  ]);
  // A pilot of A Flight is a Fighter Pilot, by title too.
  assert.deepEqual(await titles("fighter-pilot"), [{ title: "Fighter Pilot", posts: 3 }]);
  // Engineer and Senior Engineer stay apart.
  assert.deepEqual(await titles("engineer"), [{ title: "Engineer", posts: 4 }]);
  assert.deepEqual(await titles("senior-engineer"), [{ title: "Senior Engineer", posts: 1 }]);

  const kinds = await fleet.rows(
    "select r.kind as role, p.kind as position from public.positions p join public.fleet_roles r on r.id = p.role_id where r.kind <> p.kind",
  );
  assert.deepEqual(kinds, [], "a position has a role of the other kind");
  const duties = await fleet.one("select count(*)::int as roles from public.fleet_roles where kind = 'duty'");
  assert.equal(duties.roles, 11, "each staff duty is a role of its own");
});

test("a role says where it leads, so progression can be read", async () => {
  const steps = await fleet.rows(
    `select r.slug, n.slug as next from public.fleet_roles r join public.fleet_roles n on n.id = r.next_role_id order by r.slug`,
  );
  assert.deepEqual(steps, [
    { slug: "deck-hand", next: "flight-deck-chief" },
    { slug: "engineer", next: "senior-engineer" },
    { slug: "fighter-pilot", next: "flight-lead" },
    { slug: "gunner", next: "gunnery-chief" },
    { slug: "senior-engineer", next: "chief-engineer" },
  ]);

  const admin = fleet.as(who.admin);
  await assert.rejects(
    admin.query("update public.fleet_roles set next_role_id = $1 where slug = 'chief-engineer'", [await fleet.roleId("engineer")]),
    /A role cannot lead back to itself/,
  );
  await assert.rejects(
    admin.query("update public.fleet_roles set next_role_id = id where slug = 'medic'"),
    /A role cannot lead back to itself/,
  );
  // Removing a role leaves the ones that led to it with nowhere set, and does not remove them.
  const made = await admin.one(
    "insert into public.fleet_roles (slug, name, area_id, next_role_id) select 'apprentice', 'Apprentice', area_id, id from public.fleet_roles where slug = 'engineer' returning id",
  );
  await admin.query("update public.fleet_roles set next_role_id = $1 where slug = 'deck-hand'", [made.id]);
  await admin.query("delete from public.fleet_roles where id = $1", [made.id]);
  assert.equal((await fleet.one("select next_role_id from public.fleet_roles where slug = 'deck-hand'")).next_role_id, null);
  await admin.query("update public.fleet_roles set next_role_id = $1 where slug = 'deck-hand'", [await fleet.roleId("flight-deck-chief")]);
});

test("anyone reads the areas and roles, and only an admin changes them", async () => {
  const visitor = fleet.visitor();
  assert.equal((await visitor.rows("select slug from public.areas")).length, 15);
  assert.equal((await visitor.rows("select slug from public.fleet_roles")).length, 30);
  // No role needs anything of its own until an admin says so.
  assert.deepEqual(await visitor.rows("select role_id from public.fleet_role_qualifications"), []);
  await denied(visitor.query("update public.fleet_roles set summary = 'Anything'"));
  await denied(visitor.query("insert into public.areas (slug, name, domain) values ('x', 'Xx', 'ship')"));

  const gunnery = (await fleet.one("select id from public.areas where slug = 'gunnery'")).id;
  const gunner = await fleet.roleId("gunner");
  const radio = (await fleet.one("select id from public.qualifications where code = 'radio-user'")).id;
  for (const actor of [who.member, who.staff, who.command]) {
    const outsider = fleet.as(actor);
    await denied(outsider.query("insert into public.areas (slug, name, domain) values ('shadow', 'Shadow', 'ship')"));
    await denied(outsider.query("insert into public.fleet_roles (slug, name, area_id) values ('stowaway', 'Stowaway', $1)", [gunnery]));
    await denied(outsider.query("insert into public.fleet_role_qualifications (role_id, qualification_id) values ($1, $2)", [gunner, radio]));
    assert.equal(await outsider.changed("update public.areas set name = 'Anything'"), 0);
    assert.equal(await outsider.changed("update public.fleet_roles set summary = 'Anything'"), 0);
    assert.equal(await outsider.changed("update public.positions set role_id = $1", [gunner]), 0);
    assert.equal(await outsider.changed("delete from public.fleet_roles"), 0);
    assert.equal(await outsider.changed("delete from public.fleet_role_qualifications"), 0);
  }

  const admin = fleet.as(who.admin);
  await admin.query("update public.fleet_roles set summary = 'Mans a turret.', duties = E'Keep the turret ready.\\nCall targets.' where slug = 'gunner'");
  await admin.query("insert into public.areas (slug, name, domain, about) values ('sensors', 'Sensors', 'ship', 'The sensor stations.')");
  const role = await admin.one(
    "insert into public.fleet_roles (slug, name, area_id) select 'sensors-operator', 'Sensors Operator', id from public.areas where slug = 'sensors' returning id",
  );
  assert.ok(role.id);
  // An address is lower-case words joined by hyphens.
  await assert.rejects(admin.query("insert into public.areas (slug, name, domain) values ('Bad Slug', 'Bad', 'ship')"), /areas_slug_check/);
  await assert.rejects(admin.query("insert into public.areas (slug, name, domain) values ('bad', 'Bad', 'space')"), /areas_domain_check/);
});

test("an area with roles cannot be removed, nor a role with positions", async () => {
  const admin = fleet.as(who.admin);
  await assert.rejects(admin.query("delete from public.areas where slug = 'gunnery'"), /foreign key/);
  await assert.rejects(admin.query("delete from public.fleet_roles where slug = 'gunner'"), /foreign key/);
  // With nothing hanging from them, they go.
  await admin.query("delete from public.fleet_roles where slug = 'sensors-operator'");
  await admin.query("delete from public.areas where slug = 'sensors'");
});

test("a position's kind is its role's kind", async () => {
  const admin = fleet.as(who.admin);
  const staffUnit = (await fleet.one("select id from public.units where name = 'Fleet Staff'")).id;
  await assert.rejects(
    admin.query("insert into public.positions (unit_id, role_id, title, kind) values ($1, $2, 'Night Gunner', 'duty')", [
      staffUnit,
      await fleet.roleId("gunner"),
    ]),
    /The Gunner role is for a primary position, and this is a duty position/,
  );
  await assert.rejects(
    admin.query("update public.positions set role_id = $1 where title = 'Recruiter'", [await fleet.roleId("gunner")]),
    /The Gunner role is for a primary position/,
  );
  await assert.rejects(
    admin.query("update public.fleet_roles set kind = 'duty' where slug = 'gunner'"),
    /This role has positions/,
  );
  // A position needs a role at all.
  await assert.rejects(
    admin.query("insert into public.positions (unit_id, title, kind) values ($1, 'Nobody', 'duty')", [staffUnit]),
    /null value in column "role_id"/,
  );
  // Moving a position to another role of the same kind is allowed.
  await admin.query("update public.positions set role_id = $1 where title = 'Deck Hand'", [await fleet.roleId("engineer")]);
  await admin.query("update public.positions set role_id = $1 where title = 'Deck Hand'", [await fleet.roleId("deck-hand")]);
});

test("an appointment checks what the role needs, and what the position needs on top", async () => {
  const admin = fleet.as(who.admin);
  const gunner = await crewMember("Gunner One");
  const post = await fleet.positionId("Gunnery", "Turret Gunner 1");

  // What a position needs of its own still counts: the Signaller's Net controller stays on the position.
  const signaller = await fleet.positionId("Bridge", "Signaller");
  assert.equal((await fleet.rows("select 1 from public.position_qualifications where position_id = $1", [signaller])).length, 1);
  await assert.rejects(appoint(who.command, gunner, signaller, { grade_code: "E4" }), /needs the Net controller qualification/);

  // The admin makes a new qualification a need of every Gunner.
  const drill = await admin.one(
    "insert into public.qualifications (code, name, description) values ('turret-drill', 'Turret drill', 'Passed the turret drill.') returning id",
  );
  await admin.query("insert into public.fleet_role_qualifications (role_id, qualification_id) values ($1, $2)", [
    await fleet.roleId("gunner"),
    drill.id,
  ]);
  await assert.rejects(appoint(who.command, gunner, post), /needs the Turret drill qualification/);
  // It holds on every ship: a Gunner on the training ship needs it too.
  await assert.rejects(appoint(who.command, gunner, await fleet.positionId("Training Ship", "Gunner 1")), /needs the Turret drill qualification/);
  // It is not waived for an acting holder unless the role says so.
  await assert.rejects(appoint(who.command, gunner, post, { acting: true }), /needs the Turret drill qualification/);
  await admin.query("update public.fleet_role_qualifications set waived_when_acting = true where qualification_id = $1", [drill.id]);
  const acting = await appoint(who.command, gunner, post, { acting: true });
  // Confirming an acting holder checks again.
  await assert.rejects(
    fleet.as(who.command).query("update public.assignments set acting = false where id = $1", [acting.id]),
    /needs the Turret drill qualification/,
  );
  await fleet.qualify(gunner, "turret-drill");
  await fleet.as(who.command).query("update public.assignments set acting = false where id = $1", [acting.id]);

  // What the position needs on top still counts: an entry position needs the recruit route.
  const raw = await fleet.person("150", "Untrained");
  await fleet.qualify(raw, "turret-drill");
  await assert.rejects(appoint(who.command, raw, await fleet.positionId("Gunnery", "Turret Gunner 2")), /needs the (Navy crew|Radio user) qualification/);

  await admin.query("delete from public.fleet_role_qualifications where qualification_id = $1", [drill.id]);
  const second = await crewMember("Gunner Two");
  await appoint(who.command, second, await fleet.positionId("Gunnery", "Turret Gunner 3"));
});

test("an admin renames a rank and says what a grade usually does, and nothing more", async () => {
  const admin = fleet.as(who.admin);
  await admin.query("update public.ranks set name = 'Able Starman' where service = 'navy' and grade_code = 'E2'");
  await admin.query("update public.grades set typical_position = 'Section leader' where code = 'E5'");
  assert.equal((await fleet.one("select name from public.ranks where service = 'navy' and grade_code = 'E2'")).name, "Able Starman");

  // A grade's code, band and place on the ladder are fixed, and no grade or rank is added or removed.
  await denied(admin.query("update public.grades set sort_order = 99 where code = 'E5'"));
  await denied(admin.query("update public.grades set band = 'officer' where code = 'E5'"));
  await denied(admin.query("update public.ranks set grade_code = 'E3' where service = 'navy' and grade_code = 'E2'"));
  await denied(admin.query("insert into public.grades (code, sort_order, band, typical_position) values ('E8', 99, 'nco', 'Nobody')"));
  await denied(admin.query("delete from public.ranks where service = 'army'"));

  for (const actor of [who.member, who.staff, who.command]) {
    assert.equal(await fleet.as(actor).changed("update public.ranks set name = 'Anything'"), 0);
    assert.equal(await fleet.as(actor).changed("update public.grades set typical_position = 'Anything'"), 0);
  }
  await denied(fleet.visitor().query("update public.ranks set name = 'Anything'"));

  const columns = await fleet.rows(
    `select table_name, column_name from information_schema.column_privileges
     where grantee = 'authenticated' and table_schema = 'public' and table_name in ('grades', 'ranks') and privilege_type = 'UPDATE'
     order by 1, 2`,
  );
  assert.deepEqual(columns, [
    { table_name: "grades", column_name: "typical_position" },
    { table_name: "ranks", column_name: "name" },
  ]);
});

test("every change to an area, a role or what a role needs is logged", async () => {
  const logged = await fleet.rows(
    `select table_name, action, count(*)::int as lines from public.audit_log
     where actor = $1 and table_name in ('areas', 'fleet_roles', 'fleet_role_qualifications', 'ranks', 'grades')
     group by 1, 2 order by 1, 2`,
    [who.admin],
  );
  const seen = logged.map((line) => `${line.table_name} ${line.action}`);
  for (const expected of [
    "areas delete",
    "areas insert",
    "fleet_role_qualifications delete",
    "fleet_role_qualifications insert",
    "fleet_role_qualifications update",
    "fleet_roles delete",
    "fleet_roles insert",
    "fleet_roles update",
    "grades update",
    "ranks update",
  ]) {
    assert.ok(seen.includes(expected), `no line for ${expected}`);
  }
  const summary = await fleet.one(
    `select old_row ->> 'summary' as was, new_row ->> 'summary' as now from public.audit_log
     where table_name = 'fleet_roles' and action = 'update' and new_row ->> 'summary' = 'Mans a turret.'`,
  );
  assert.equal(summary.was, "Mans a ship's weapons, from a turret or a remote weapons station.");
});

test("a unit says what it brings and can have a picture, which anyone reads and only an admin sets", async () => {
  const ship = (await fleet.one("select id from public.units where name = 'Training Ship'")).id;
  // Every unit starts with nothing listed and the symbol for its kind.
  assert.deepEqual(await fleet.one("select count(*)::int as n from public.units where brings <> '' or picture is not null"), { n: 0 });

  for (const other of [who.command, who.staff, who.member]) {
    assert.equal(await fleet.as(other).changed("update public.units set brings = 'Two turrets' where id = $1", [ship]), 0);
    assert.equal(await fleet.as(other).changed("update public.units set picture = 'areaHelm' where id = $1", [ship]), 0);
  }
  await denied(fleet.visitor().query("update public.units set brings = 'Two turrets' where id = $1", [ship]));

  const admin = fleet.as(who.admin);
  assert.equal(await admin.changed("update public.units set brings = $2, picture = 'areaHelm' where id = $1", [ship, "Four turrets\nA medical bed"]), 1);
  assert.deepEqual(await fleet.visitor().one("select brings, picture from public.units where id = $1", [ship]), {
    brings: "Four turrets\nA medical bed",
    picture: "areaHelm",
  });

  await assert.rejects(admin.query("update public.units set brings = $2 where id = $1", [ship, "x".repeat(601)]), /check constraint/);
  await assert.rejects(admin.query("update public.units set picture = $2 where id = $1", [ship, "x".repeat(41)]), /check constraint/);
  await assert.rejects(admin.query("update public.units set picture = '' where id = $1", [ship]), /check constraint/);
  // Taking the picture away brings the symbol back.
  assert.equal(await admin.changed("update public.units set picture = null, brings = '' where id = $1", [ship]), 1);

  const logged = await fleet.rows(
    "select new_row ->> 'brings' as brings from public.audit_log where table_name = 'units' and actor = $1 and new_row ->> 'id' = $2 order by id",
    [who.admin, ship],
  );
  assert.deepEqual(logged.map((line) => line.brings), ["Four turrets\nA medical bed", ""]);
});
