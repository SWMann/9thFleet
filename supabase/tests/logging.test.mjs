// The activity log and the page views: who can write a line, what a line can
// say, and who can read them.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

const refusal = (work) => assert.rejects(work, (error) => /row-level security|permission denied/.test(error.message));
const views = (path) => fleet.one("select views, landings from public.page_views where path = $1", [path]);
const tick = (actor, path, landing = false) =>
  actor.query("insert into public.page_view_ticks (path, landing) values ($1, $2)", [path, landing]);

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.applicant = await fleet.applicant("5", "Applicant");
  who.leaver = await fleet.person("6", "Leaver");
});
after(() => fleet.close());

test("anyone signed in adds a line, and the database says whose it is and when", async () => {
  await fleet.as(who.applicant).query("insert into public.activity_log (kind) values ('sign_in')");
  await fleet.as(who.member).query(
    "insert into public.activity_log (kind, action, shown, cause) values ('refused', 'event.reply', 'The roll has closed.', 'P0001')",
  );

  const lines = await fleet.rows("select actor, kind, action, shown, cause, at from public.activity_log order by id");
  assert.deepEqual(
    lines.map(({ at, ...line }) => line),
    [
      { actor: who.applicant, kind: "sign_in", action: null, shown: null, cause: null },
      { actor: who.member, kind: "refused", action: "event.reply", shown: "The roll has closed.", cause: "P0001" },
    ],
  );
  for (const line of lines) assert.ok(Math.abs(Date.now() - new Date(line.at).getTime()) < 60_000, "dated by the database");
});

test("nobody can write a line in another name, or date one", async () => {
  // Whose line it is and when cannot be sent at all.
  await refusal(
    fleet.as(who.member).query("insert into public.activity_log (actor, kind) values ($1, 'sign_in')", [who.staff]),
  );
  await refusal(
    fleet.as(who.member).query("insert into public.activity_log (kind, at) values ('sign_in', now() - interval '1 year')"),
  );
  // An admin is no exception.
  await refusal(
    fleet.as(who.admin).query("insert into public.activity_log (actor, kind) values ($1, 'sign_out')", [who.staff]),
  );
  // A visitor has no name to write under.
  await refusal(fleet.visitor().query("insert into public.activity_log (kind) values ('sign_in')"));
});

test("a line keeps to a length, and only the four kinds exist", async () => {
  await fleet.as(who.staff).query("insert into public.activity_log (kind, action, shown, cause) values ('failed', $1, $2, $3)", [
    "a".repeat(200),
    "b".repeat(2000),
    "c".repeat(2000),
  ]);
  const line = await fleet.one(
    "select char_length(action) as action, char_length(shown) as shown, char_length(cause) as cause from public.activity_log where actor = $1",
    [who.staff],
  );
  assert.deepEqual(line, { action: 60, shown: 500, cause: 500 });

  await assert.rejects(
    fleet.as(who.staff).query("insert into public.activity_log (kind) values ('promoted')"),
    /invalid input value for enum/,
  );
});

test("past thirty lines in a minute the rest are dropped without an error", async () => {
  for (let line = 0; line < 40; line += 1) {
    await fleet.as(who.command).query("insert into public.activity_log (kind, action) values ('refused', 'event.reply')");
  }
  const kept = await fleet.one("select count(*)::int as lines from public.activity_log where actor = $1", [who.command]);
  assert.equal(kept.lines, 30);
  // Someone else is not held back by it.
  await fleet.as(who.member).query("insert into public.activity_log (kind) values ('sign_out')");
  const theirs = await fleet.one("select count(*)::int as lines from public.activity_log where actor = $1 and kind = 'sign_out'", [who.member]);
  assert.equal(theirs.lines, 1);
});

test("only admins read the activity log, and nobody changes it", async () => {
  const total = (await fleet.one("select count(*)::int as lines from public.activity_log")).lines;
  assert.ok(total > 0);
  assert.equal((await fleet.as(who.admin).rows("select id from public.activity_log")).length, total);
  for (const reader of [who.command, who.staff, who.member, who.applicant]) {
    assert.deepEqual(await fleet.as(reader).rows("select id from public.activity_log"), [], "someone who is not an admin read the log");
  }
  await refusal(fleet.visitor().rows("select id from public.activity_log"));

  // Not even an admin can change or remove a line through the API.
  await refusal(fleet.as(who.admin).query("update public.activity_log set shown = 'nothing happened'"));
  await refusal(fleet.as(who.admin).query("delete from public.activity_log"));
});

test("deleting a member's record removes their lines", async () => {
  await fleet.as(who.leaver).query("insert into public.activity_log (kind) values ('sign_in')");
  await fleet.sql("delete from auth.users where id = $1", [who.leaver]);
  assert.deepEqual(await fleet.rows("select id from public.activity_log where actor = $1", [who.leaver]), []);
});

test("a view of a public page adds one to the day's total and stores nothing else", async () => {
  await tick(fleet.visitor(), "/", true);
  await tick(fleet.visitor(), "/");
  await tick(fleet.as(who.member), "/manual/command/orders");
  await tick(fleet.visitor(), "/Ranks/");

  assert.deepEqual(await views("/"), { views: 2, landings: 1 });
  assert.deepEqual(await views("/manual/command/orders"), { views: 1, landings: 0 });
  assert.deepEqual(await views("/ranks"), { views: 1, landings: 0 }, "an address is counted in one spelling");
  assert.deepEqual(await fleet.rows("select * from public.page_view_ticks"), [], "nothing is kept at the door");

  const columns = await fleet.rows(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'page_views' order by 1",
  );
  assert.deepEqual(
    columns.map((column) => column.column_name),
    ["day", "landings", "path", "views"],
    "a total holds a day, a page and two counts, and nothing about who read it",
  );
  const today = await fleet.one("select (day = (now() at time zone 'utc')::date) as today from public.page_views where path = '/'");
  assert.equal(today.today, true);
});

test("member pages, other sites' addresses and nonsense are not counted", async () => {
  const before = (await fleet.one("select count(*)::int as pages from public.page_views")).pages;
  for (const path of [
    "/profile",
    "/operations/3c1d8a52-5e0f-4f6e-9d55-0a4f6e1f2b11",
    "/admin/logs",
    "/staff/applications",
    "/apply",
    "https://example.com/",
    "/roles/../admin",
    "/manual?volume=1",
    "/manual//command",
    "/manual/a/b/c/d",
    "/<script>",
    "",
    "/manual/" + "a".repeat(300),
  ]) {
    await tick(fleet.visitor(), path);
  }
  assert.equal((await fleet.one("select count(*)::int as pages from public.page_views")).pages, before);
});

test("made-up addresses cannot fill the table", async () => {
  await fleet.sql(
    `insert into public.page_views (day, path, views)
     select (now() at time zone 'utc')::date, '/roles/made-up-' || n, 1 from generate_series(1, 400) as n`,
  );
  await tick(fleet.visitor(), "/roles/one-more");
  await tick(fleet.visitor(), "/roles/and-another");
  assert.equal(await views("/roles/one-more"), undefined);
  assert.deepEqual(await views("(other)"), { views: 2, landings: 0 });
  // A page that already has a total today is still counted under its own name.
  await tick(fleet.visitor(), "/");
  assert.equal((await views("/")).views, 3);
});

test("only admins read the page views, and nobody writes a total directly", async () => {
  assert.ok((await fleet.as(who.admin).rows("select path from public.page_views")).length > 0);
  for (const reader of [who.command, who.staff, who.member, who.applicant]) {
    assert.deepEqual(await fleet.as(reader).rows("select path from public.page_views"), []);
  }
  await refusal(fleet.visitor().rows("select path from public.page_views"));
  await refusal(fleet.visitor().rows("select path from public.page_view_ticks"));
  await refusal(fleet.as(who.admin).rows("select path from public.page_view_ticks"));

  for (const writer of [fleet.visitor(), fleet.as(who.member), fleet.as(who.admin)]) {
    await refusal(writer.query("insert into public.page_views (day, path, views) values (current_date, '/', 1000000)"));
    await refusal(writer.query("update public.page_views set views = 1000000"));
    await refusal(writer.query("delete from public.page_views"));
  }
});

test("the totals by day and by page add up, and are for admins only", async () => {
  await fleet.sql(
    `insert into public.page_views (day, path, views, landings) values
       ((now() at time zone 'utc')::date - 1, '/joining', 5, 2),
       ((now() at time zone 'utc')::date - 2, '/joining', 3, 1),
       ((now() at time zone 'utc')::date - 40, '/joining', 100, 50)`,
  );
  const admin = fleet.as(who.admin);
  const yesterday = await admin.one(
    "select views, landings from public.page_views_by_day where day = (now() at time zone 'utc')::date - 1",
  );
  assert.deepEqual(yesterday, { views: 5, landings: 2 });
  // The page totals cover the last 30 days, so the old day is left out.
  assert.deepEqual(await admin.one("select views, landings from public.page_views_by_page where path = '/joining'"), {
    views: 8,
    landings: 3,
  });
  for (const reader of [who.command, who.staff, who.member]) {
    assert.deepEqual(await fleet.as(reader).rows("select * from public.page_views_by_day"), []);
    assert.deepEqual(await fleet.as(reader).rows("select * from public.page_views_by_page"), []);
  }
  await refusal(fleet.visitor().rows("select * from public.page_views_by_day"));
});

test("changes to grades and ranks are logged", async () => {
  // Nobody can change them through the API yet, so the database owner does.
  await fleet.sql("update public.ranks set name = 'Able Starman' where service = 'navy' and grade_code = 'E2'");
  await fleet.sql("update public.grades set typical_position = 'Section leader' where code = 'E5'");
  const logged = await fleet.rows(
    `select table_name, action, old_row ->> 'name' as was, new_row ->> 'name' as now
     from public.audit_log where table_name in ('grades', 'ranks') order by table_name`,
  );
  assert.equal(logged.length, 2);
  assert.deepEqual(
    logged.map((line) => `${line.table_name} ${line.action}`),
    ["grades update", "ranks update"],
  );
  assert.equal(logged[1].now, "Able Starman");
});
