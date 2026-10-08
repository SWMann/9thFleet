// The shape of the database: nothing is exposed that should not be, and the
// reference data matches the roadmap and Volume 1.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
before(async () => {
  fleet = await newFleet();
});
after(() => fleet.close());

test("every table has row-level security switched on", async () => {
  const open = await fleet.rows(
    `select schemaname || '.' || tablename as name from pg_tables
     where schemaname in ('public', 'app') and not rowsecurity`,
  );
  assert.deepEqual(open, []);
});

test("a visitor can read the settings, the grades and ranks and the structure, and nothing else", async () => {
  const grants = await fleet.rows(
    `select table_schema || '.' || table_name as name, privilege_type
     from information_schema.role_table_grants
     where grantee = 'anon' and table_schema in ('public', 'app')
     order by 1, 2`,
  );
  assert.deepEqual(grants, [
    { name: "public.fleet_settings", privilege_type: "SELECT" },
    { name: "public.grades", privilege_type: "SELECT" },
    { name: "public.position_qualifications", privilege_type: "SELECT" },
    { name: "public.positions", privilege_type: "SELECT" },
    { name: "public.qualifications", privilege_type: "SELECT" },
    { name: "public.ranks", privilege_type: "SELECT" },
    { name: "public.units", privilege_type: "SELECT" },
  ]);
});

test("signed-in users hold no privilege on the private schema's tables, and none of the blunt ones anywhere", async () => {
  const grants = await fleet.rows(
    `select table_schema || '.' || table_name as name, privilege_type
     from information_schema.role_table_grants
     where grantee = 'authenticated'
       and (table_schema = 'app' or privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER'))`,
  );
  assert.deepEqual(grants, []);
});

test("the audit log, member accounts and the member list cannot be written to directly", async () => {
  const writable = await fleet.rows(
    `select table_name, privilege_type
     from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public'
       and table_name in ('audit_log', 'member_accounts', 'grades', 'ranks')
       and privilege_type <> 'SELECT'`,
  );
  assert.deepEqual(writable, []);
  const members = await fleet.rows(
    `select privilege_type from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public' and table_name = 'members'
       and privilege_type in ('INSERT', 'DELETE', 'UPDATE')`,
  );
  assert.deepEqual(members, [], "members: no insert or delete, and update only column by column");
});

test("no function is callable through the API", async () => {
  const inPublic = await fleet.rows(
    "select proname from pg_proc where pronamespace = 'public'::regnamespace",
  );
  assert.deepEqual(inPublic, [], "the public schema holds no functions");

  const forVisitors = await fleet.rows(
    `select proname from pg_proc
     where pronamespace = 'app'::regnamespace and has_function_privilege('anon', oid, 'execute')`,
  );
  assert.deepEqual(forVisitors, []);
});

test("signed-in users can run the rule helpers and nothing else", async () => {
  const allowed = await fleet.rows(
    `select proname from pg_proc
     where pronamespace = 'app'::regnamespace and has_function_privilege('authenticated', oid, 'execute')
     order by 1`,
  );
  assert.deepEqual(
    allowed.map((row) => row.proname),
    [
      "edits_event", "has_role", "holds_role", "is_serving", "is_staff", "is_trusted_context", "may_apply",
      "may_create_event", "member_grade", "my_status", "runs_event",
    ],
  );
});

test("every function pins its search path", async () => {
  const loose = await fleet.rows(
    `select proname from pg_proc
     where pronamespace = 'app'::regnamespace
       and not exists (select 1 from unnest(coalesce(proconfig, '{}')) as c where c like 'search_path=%')`,
  );
  assert.deepEqual(loose, []);
});

test("views apply the reader's own access rules", async () => {
  const views = await fleet.rows(
    `select c.relname, coalesce(c.reloptions::text, '') as options
     from pg_class c where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace`,
  );
  assert.ok(views.length >= 1);
  for (const view of views) {
    assert.match(view.options, /security_invoker=true/, view.relname);
  }
});

test("a table added later is locked until a migration opens it", async () => {
  await fleet.sql("create table public.added_later (id int primary key)");
  const row = await fleet.one(
    `select has_table_privilege('anon', 'public.added_later', 'select') as visitor,
            has_table_privilege('authenticated', 'public.added_later', 'select') as member`,
  );
  assert.deepEqual(row, { visitor: false, member: false });
  await fleet.sql("drop table public.added_later");
});

test("a function added later cannot be run until a migration allows it", async () => {
  await fleet.sql("create function public.added_later() returns int language sql as 'select 1'");
  await fleet.sql("create function app.added_later() returns int language sql security definer set search_path = '' as 'select 1'");
  const row = await fleet.one(
    `select has_function_privilege('anon', 'public.added_later()', 'execute') as visitor,
            has_function_privilege('authenticated', 'public.added_later()', 'execute') as member,
            has_function_privilege('authenticated', 'app.added_later()', 'execute') as helper`,
  );
  assert.deepEqual(row, { visitor: false, member: false, helper: false });
  await fleet.sql("drop function public.added_later()");
  await fleet.sql("drop function app.added_later()");
});

test("there are 18 grades and each has a rank in all three services", async () => {
  const grades = await fleet.rows("select code from public.grades order by sort_order");
  assert.deepEqual(
    grades.map((row) => row.code),
    ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "OC", "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8", "O9", "O10"],
  );
  const counts = await fleet.rows(
    "select service, count(*)::int as ranks from public.ranks group by service order by service",
  );
  assert.deepEqual(counts, [
    { service: "navy", ranks: 18 },
    { service: "army", ranks: 18 },
    { service: "marines", ranks: 18 },
  ]);
});

test("the flagship has the 25 positions of the crew template", async () => {
  const row = await fleet.one(
    `select count(*)::int as posts, count(*) filter (where p.is_entry)::int as entry
     from public.positions p
     join public.units department on department.id = p.unit_id
     join public.units ship on ship.id = department.parent_id
     where ship.name = 'UEES Nexus' and p.kind = 'primary'`,
  );
  assert.deepEqual(row, { posts: 25, entry: 12 });
});

test("stage 1 opens the Fleet Commander, six crew positions and two duties", async () => {
  const open = await fleet.rows(
    `select u.name || ': ' || p.title as line from public.positions p
     join public.units u on u.id = p.unit_id
     where p.opens_at_stage = 1 order by 1`,
  );
  assert.deepEqual(
    open.map((row) => row.line),
    [
      "Fleet Command: Fleet Commander",
      "Fleet Staff: Instructor",
      "Fleet Staff: Recruiter",
      "Training Ship: Engineer",
      "Training Ship: Gunner 1",
      "Training Ship: Gunner 2",
      "Training Ship: Gunner 3",
      "Training Ship: Gunner 4",
      "Training Ship: Helmsman",
    ],
  );
});

test("every band holds its nominal grade, and no position opens before its unit", async () => {
  const wrongBand = await fleet.rows(
    `select p.title from public.positions p
     join public.grades n on n.code = p.nominal_grade
     join public.grades lo on lo.code = p.min_grade
     join public.grades hi on hi.code = p.max_grade
     where p.kind = 'primary' and not (n.sort_order between lo.sort_order and hi.sort_order)`,
  );
  assert.deepEqual(wrongBand, []);

  const tooEarly = await fleet.rows(
    `select p.title from public.positions p join public.units u on u.id = p.unit_id
     where p.opens_at_stage < u.opens_at_stage`,
  );
  assert.deepEqual(tooEarly, []);

  const mixedBands = await fleet.rows(
    `select p.title from public.positions p
     join public.grades lo on lo.code = p.min_grade
     join public.grades hi on hi.code = p.max_grade
     where p.kind = 'primary' and lo.band <> 'officer' and hi.band = 'officer'`,
  );
  assert.deepEqual(mixedBands, [], "no band crosses from enlisted to officer");
});
