// The piracy report line: what a visitor may send, how much the line takes,
// who reads a report, and what command can do with one.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

// Two of the marks that turn text right to left, made by number so that this file holds neither.
const OVERRIDE = String.fromCharCode(0x202e);
const ISOLATE = String.fromCharCode(0x2066);

let nextMark = 0;
/** A sender's mark nobody has used yet in this file. */
const mark = () => (nextMark++).toString(16).padStart(4, "0");

const words = (fields = {}) => ({
  reporter_handle: "Lost_Miner",
  location: "Stanton, the ring at Yela",
  details: "Two ships jumped my Prospector while it was mining and shot it down.",
  sender: mark(),
  ...fields,
});
/** Send a report as a visitor, the way the site does: nothing is read back. */
const send = (fields = {}, actor = fleet.visitor()) => {
  const row = words(fields);
  const columns = Object.keys(row);
  return actor.query(
    `insert into public.piracy_reports (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    Object.values(row),
  );
};
/** Send a report and read it back as the database owner. */
const sent = async (fields = {}) => {
  const handle = `Sender_${nextMark}`;
  await send({ reporter_handle: handle, ...fields });
  return fleet.one("select * from public.piracy_reports where reporter_handle = $1 order by received_at desc limit 1", [handle]);
};
const report = (id) => fleet.one("select * from public.piracy_reports where id = $1", [id]);
const change = (actor, id, set, params = []) => fleet.as(actor).changed(`update public.piracy_reports set ${set} where id = $1`, [id, ...params]);
const inDays = async (days) => (await fleet.one("select ((now() at time zone 'utc')::date + $1::int)::text as day", [days])).day;

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.applicant = await fleet.applicant("5", "Applicant");
});
after(() => fleet.close());
// The line takes ten reports an hour, so each test starts with none.
beforeEach(async () => {
  await fleet.sql("delete from public.hostiles");
  await fleet.sql("delete from public.piracy_reports");
  await fleet.sql("delete from app.piracy_senders");
});

test("a visitor sends a report, and the database dates it and files it as new", async () => {
  const made = await sent({
    urgent: true,
    suspect_kind: "individual",
    suspect_handle: "Red_Raider",
    evidence: "https://example.com/clip\nhttps://example.com/shot.png",
    details: "They opened fire without a word.\nI lost the ship and the cargo.",
  });
  assert.equal(made.state, "new");
  assert.equal(made.urgent, true);
  assert.equal(made.suspect_handle, "Red_Raider");
  assert.equal(made.handled_by, null);
  assert.equal(made.handled_at, null);
  assert.equal(made.outcome_note, "");
  assert.equal(made.event_id, null);
  assert.ok(Date.now() - new Date(made.received_at).getTime() < 60_000);
  assert.equal(new Date(made.happened_on).toISOString().slice(0, 10), await inDays(0));
});

test("a visitor reads nothing: not the list, not their own report as it is sent", async () => {
  await send();
  await assert.rejects(fleet.visitor().query("select id from public.piracy_reports"), /permission denied/);
  await assert.rejects(fleet.visitor().query("select count(*) from public.piracy_reports"), /permission denied/);
  const row = words();
  await assert.rejects(
    fleet.visitor().query(
      "insert into public.piracy_reports (reporter_handle, location, details, sender) values ($1, $2, $3, $4) returning id",
      [row.reporter_handle, row.location, row.details, row.sender],
    ),
    /permission denied/,
  );
  await assert.rejects(fleet.visitor().query("update public.piracy_reports set details = details"), /permission denied/);
  await assert.rejects(fleet.visitor().query("delete from public.piracy_reports"), /permission denied/);
  await assert.rejects(fleet.visitor().query("select * from app.piracy_senders"), /permission denied/);
});

test("a visitor sends the words of a report and nothing command writes", async () => {
  for (const [column, value] of [
    ["state", "handled"],
    ["handled_by", who.command],
    ["handled_at", new Date().toISOString()],
    ["outcome_note", "Dealt with."],
    ["received_at", "2020-01-01T00:00:00Z"],
    ["id", "00000000-0000-4000-8000-000000000001"],
    ["updated_at", "2020-01-01T00:00:00Z"],
  ]) {
    await assert.rejects(send({ [column]: value }), /permission denied/, column);
  }
  assert.equal((await fleet.rows("select id from public.piracy_reports")).length, 0);
});

test("what a report holds is checked: names from the game, one line for the place, plain words", async () => {
  const bad = [
    [{ reporter_handle: "has space" }, /reporter_handle/],
    [{ reporter_handle: "x" }, /reporter_handle/],
    [{ reporter_handle: "someone@example.com" }, /reporter_handle/],
    [{ location: " padded" }, /location/],
    [{ location: "two\nlines" }, /location/],
    [{ location: `over${OVERRIDE}ride` }, /location/],
    [{ location: "x" }, /location/],
    [{ location: "x".repeat(121) }, /location/],
    [{ details: "Too short." }, /details/],
    [{ details: `${" ".repeat(30)}short` }, /details/],
    [{ details: "x".repeat(2001) }, /details/],
    [{ details: "A tab\tin the middle of the words." }, /details/],
    [{ details: "A return\r\nin the middle of the words." }, /details/],
    [{ details: `An over${OVERRIDE}ride in the middle of it.` }, /details/],
    [{ details: `An iso${ISOLATE}late in the middle of it.` }, /details/],
    [{ details: "A C1 control \u0085 in the middle." }, /details/],
    [{ suspect_kind: "individual" }, /piracy_reports_suspect_named/],
    [{ suspect_handle: "Red_Raider" }, /piracy_reports_suspect_named/],
    [{ suspect_kind: "organisation", suspect_handle: "has space" }, /suspect_handle/],
    [{ evidence: "not an address" }, /evidence/],
    [{ evidence: "javascript:alert(1)" }, /evidence/],
    [{ evidence: "https://example.com/a https://example.com/b" }, /evidence/],
  ];
  for (const [fields, expected] of bad) {
    await assert.rejects(send(fields), expected, JSON.stringify(fields));
  }
  // Lines may break, and ordinary marks and letters of any alphabet are plain words.
  const fine = await sent({ details: "Line one of what happened.\nLine two: éè 日本語, 100% \"quoted\" <b>not markup</b>." });
  assert.match(fine.details, /Line two/);
  assert.equal((await fleet.rows("select id from public.piracy_reports")).length, 1);
});

test("the day it happened is within the last 90 days", async () => {
  await assert.rejects(send({ happened_on: await inDays(2) }), /Give a day in the last 90 days\./);
  await assert.rejects(send({ happened_on: await inDays(-91) }), /Give a day in the last 90 days\./);
  // Tomorrow is today somewhere ahead of UTC.
  for (const days of [1, 0, -90]) {
    const made = await sent({ happened_on: await inDays(days) });
    assert.equal(new Date(made.happened_on).toISOString().slice(0, 10), await inDays(days));
  }
});

test("a report comes with a sender's mark, which is counted and never stored", async () => {
  for (const sender of [null, "", "xyz", "ABCD", "12345", "12g4"]) {
    await assert.rejects(send({ sender }), /A report is sent through the fleet's own form\./, String(sender));
  }
  const made = await sent({ sender: "ab12" });
  assert.equal(made.sender, null);
  assert.deepEqual(await fleet.rows("select mark, reports from app.piracy_senders"), [{ mark: "ab12", reports: 1 }]);
  // Nothing in the log of changes holds the mark either.
  const logged = await fleet.rows("select new_row from public.audit_log where table_name = 'piracy_reports' and new_row ->> 'id' = $1", [made.id]);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].new_row.sender, null);
  assert.doesNotMatch(JSON.stringify(logged), /ab12/);
});

test("one sender sends five reports a day, and starts again the next day", async () => {
  for (let n = 0; n < 5; n++) await send({ sender: "aaaa" });
  await assert.rejects(send({ sender: "aaaa" }), /You have sent five reports today\./);
  // A report that was refused is not counted, and another sender is not held up.
  assert.equal((await fleet.one("select reports from app.piracy_senders where mark = 'aaaa'")).reports, 5);
  await send({ sender: "bbbb" });
  assert.equal((await fleet.rows("select id from public.piracy_reports")).length, 6);

  // The next day the same mark counts from one, in the same row.
  await fleet.sql("update app.piracy_senders set day = day - 1 where mark = 'aaaa'");
  await fleet.sql("update public.piracy_reports set received_at = received_at - interval '2 hours'");
  await send({ sender: "aaaa" });
  assert.deepEqual(await fleet.rows("select reports from app.piracy_senders where mark = 'aaaa'"), [{ reports: 1 }]);
});

test("the line takes ten reports an hour from everyone together", async () => {
  for (let n = 0; n < 10; n++) await send();
  await assert.rejects(send(), /The report line is full for now\./);
  // An hour on, it takes reports again.
  await fleet.sql("update public.piracy_reports set received_at = received_at - interval '61 minutes'");
  await send();
});

test("the line takes thirty reports a day from everyone together", async () => {
  for (let n = 0; n < 30; n++) {
    await fleet.sql(
      "insert into public.piracy_reports (reporter_handle, location, details, received_at) values ($1, 'Stanton', 'Something that happened in the game.', now() - interval '3 hours')",
      [`Earlier_${n}`],
    );
  }
  await assert.rejects(send(), /The report line is full for now\./);
  await fleet.sql("update public.piracy_reports set received_at = received_at - interval '22 hours'");
  await send();
});

test("only command reads reports", async () => {
  const made = await sent();
  for (const actor of [who.command, who.admin]) {
    assert.equal((await fleet.as(actor).rows("select id from public.piracy_reports where id = $1", [made.id])).length, 1);
  }
  for (const actor of [who.staff, who.member, who.applicant]) {
    assert.deepEqual(await fleet.as(actor).rows("select id from public.piracy_reports"), []);
    assert.equal(await change(actor, made.id, "state = 'dismissed'"), 0);
    assert.equal(await fleet.as(actor).changed("delete from public.piracy_reports where id = $1", [made.id]), 0);
  }
  assert.equal((await report(made.id)).state, "new");
});

test("a signed-in user does not send a report as themselves, whoever they are", async () => {
  for (const actor of [who.member, who.command, who.admin]) {
    await assert.rejects(send({}, fleet.as(actor)), /permission denied/);
  }
});

test("command marks a report handled or dismissed, signed and dated by the database", async () => {
  const made = await sent();
  assert.equal(await change(who.command, made.id, "state = 'handled', outcome_note = $2", ["Escorted them out."]), 1);
  let now = await report(made.id);
  assert.equal(now.state, "handled");
  assert.equal(now.handled_by, who.command);
  assert.ok(Date.now() - new Date(now.handled_at).getTime() < 60_000);
  assert.equal(now.outcome_note, "Escorted them out.");

  // Reopened, it is nobody's again. Dismissed by someone else, it is theirs.
  assert.equal(await change(who.command, made.id, "state = 'new'"), 1);
  now = await report(made.id);
  assert.equal(now.handled_by, null);
  assert.equal(now.handled_at, null);
  assert.equal(await change(who.admin, made.id, "state = 'dismissed'"), 1);
  assert.equal((await report(made.id)).handled_by, who.admin);
});

test("command cannot change the words of a report, its dates or who handled it", async () => {
  const made = await sent();
  for (const set of [
    "details = 'Something else entirely happened here.'",
    "reporter_handle = 'Someone_Else'",
    "location = 'Elsewhere'",
    "suspect_handle = 'Framed'",
    "evidence = 'https://example.com/other'",
    "urgent = true",
    "received_at = now() - interval '1 year'",
    "handled_at = now()",
  ]) {
    await assert.rejects(change(who.command, made.id, set), /permission denied/, set);
  }
  await assert.rejects(change(who.command, made.id, "handled_by = $2", [who.member]), /permission denied/);
});

test("a Response event drafted from a report is linked to it, and the link goes when the event does", async () => {
  const made = await sent();
  const event = await fleet.as(who.command).one(
    "insert into public.events (kind, title, starts_at, commander_id) values ('response', 'Response: Yela', now() + interval '1 hour', $1) returning id",
    [who.command],
  );
  assert.equal(await change(who.command, made.id, "event_id = $2", [event.id]), 1);
  assert.equal((await report(made.id)).event_id, event.id);
  // Someone who cannot read reports cannot link one.
  assert.equal(await change(who.member, made.id, "event_id = null"), 0);

  await change(who.command, made.id, "state = 'handled'");
  await fleet.sql("delete from public.events where id = $1", [event.id]);
  const now = await report(made.id);
  assert.equal(now.event_id, null);
  assert.equal(now.state, "handled");
  assert.equal(now.handled_by, who.command);
});

test("only command starts a hostile-list entry from a report", async () => {
  const made = await sent({ suspect_kind: "individual", suspect_handle: "Red_Raider" });
  const reason = "Shot down a mining ship at Yela with no warning.";
  await assert.rejects(
    fleet.as(who.member).query(
      "insert into public.hostiles (kind, handle, reason, report_id) values ('individual', 'Red_Raider', $1, $2)",
      [reason, made.id],
    ),
    /Only command starts an entry from a piracy report\./,
  );
  // A report nobody sent tells a member nothing either: the answer is the same.
  await assert.rejects(
    fleet.as(who.member).query(
      "insert into public.hostiles (kind, handle, reason, report_id) values ('individual', 'Red_Raider', $1, '00000000-0000-4000-8000-000000000001')",
      [reason],
    ),
    /Only command starts an entry from a piracy report\./,
  );
  const entry = await fleet.as(who.command).one(
    "insert into public.hostiles (kind, handle, reason, report_id, state) values ('individual', 'Red_Raider', $1, $2, 'listed') returning id, report_id",
    [reason, made.id],
  );
  assert.equal(entry.report_id, made.id);
  // The link is made when the entry is, and not changed after.
  await assert.rejects(
    fleet.as(who.command).query("update public.hostiles set report_id = null where id = $1", [entry.id]),
    /permission denied/,
  );
});

test("deleting a report clears the link from an entry, whatever state the entry is in", async () => {
  const reason = "Shot down a mining ship at Yela with no warning.";
  const states = {};
  for (const [handle, then] of [
    ["Still_Waiting", null],
    ["Now_Listed", "state = 'listed'"],
    ["Was_Declined", "state = 'declined'"],
  ]) {
    const made = await sent();
    const entry = await fleet.as(who.command).one(
      "insert into public.hostiles (kind, handle, reason, report_id) values ('individual', $1, $2, $3) returning id",
      [handle, reason, made.id],
    );
    if (then) await fleet.as(who.command).query(`update public.hostiles set ${then} where id = $1`, [entry.id]);
    states[handle] = { report: made.id, entry: entry.id };
  }
  // A lifted entry too.
  const made = await sent();
  const lifted = await fleet.as(who.command).one(
    "insert into public.hostiles (kind, handle, reason, report_id, state) values ('organisation', 'LIFTED', $1, $2, 'listed') returning id",
    [reason, made.id],
  );
  await fleet.as(who.command).query("update public.hostiles set state = 'lifted', lift_note = 'Made peace.' where id = $1", [lifted.id]);
  states.Lifted = { report: made.id, entry: lifted.id };

  for (const [name, ids] of Object.entries(states)) {
    const before = await fleet.one("select state, decided_by, lifted_by, lift_note, expires_on from public.hostiles where id = $1", [ids.entry]);
    assert.equal(await fleet.as(who.command).changed("delete from public.piracy_reports where id = $1", [ids.report]), 1, name);
    const after = await fleet.one("select state, decided_by, lifted_by, lift_note, expires_on, report_id from public.hostiles where id = $1", [ids.entry]);
    assert.equal(after.report_id, null, name);
    // Nothing else about the entry moved, and nobody signed anything.
    const { report_id: _gone, ...rest } = after;
    assert.deepEqual(rest, before, name);
  }
});

test("deleting a member clears their name from an entry, even one that could not be changed by hand", async () => {
  const reporter = await fleet.person("20", "Leaver");
  const joiner = await fleet.person("21", "Joiner");
  const reason = "Shot down a mining ship at Yela with no warning.";
  const closed = await fleet.as(reporter).one("insert into public.hostiles (kind, handle, reason) values ('individual', 'Closed_Case', $1) returning id", [reason]);
  await fleet.as(who.command).query("update public.hostiles set state = 'declined' where id = $1", [closed.id]);
  const standing = await fleet.as(reporter).one("insert into public.hostiles (kind, handle, reason) values ('individual', 'Later_Joined', $1) returning id", [reason]);
  await fleet.as(who.command).query("update public.hostiles set state = 'listed' where id = $1", [standing.id]);
  // The listed name has since joined the fleet. The entry can now only be lifted by hand.
  await fleet.sql("update public.members set rsi_handle = 'Later_Joined' where id = $1", [joiner]);
  await assert.rejects(
    fleet.as(who.command).query("update public.hostiles set decision_note = 'Checked.' where id = $1", [standing.id]),
    /serves in this fleet/,
  );

  await fleet.sql("delete from auth.users where id = $1", [reporter]);
  for (const id of [closed.id, standing.id]) {
    assert.equal((await fleet.one("select reported_by from public.hostiles where id = $1", [id])).reported_by, null);
  }
  await fleet.sql("delete from auth.users where id = $1", [joiner]);
});

test("the housekeeping door is not one a person can walk through", async () => {
  // An ordinary change by a member is still refused, and one by command to a closed entry too.
  const reason = "Shot down a mining ship at Yela with no warning.";
  const entry = await fleet.as(who.member).one("insert into public.hostiles (kind, handle, reason) values ('individual', 'Door_Test', $1) returning id", [reason]);
  assert.equal(await fleet.as(who.member).changed("update public.hostiles set level = 'watch' where id = $1", [entry.id]), 0);
  assert.equal((await fleet.one("select level from public.hostiles where id = $1", [entry.id])).level, "hostile");
  await fleet.as(who.command).query("update public.hostiles set state = 'declined' where id = $1", [entry.id]);
  await assert.rejects(
    fleet.as(who.command).query("update public.hostiles set decision_note = 'Again.' where id = $1", [entry.id]),
    /This entry is closed/,
  );
});

test("deleting a report takes its words out of the log of changes", async () => {
  const made = await sent({ suspect_kind: "organisation", suspect_handle: "REDFLAG", evidence: "https://example.com/clip" });
  await change(who.command, made.id, "state = 'handled', outcome_note = $2", ["Listed the organisation."]);
  assert.equal(await fleet.as(who.command).changed("delete from public.piracy_reports where id = $1", [made.id]), 1);

  const lines = await fleet.rows(
    "select action, old_row, new_row from public.audit_log where table_name = 'piracy_reports' and coalesce(new_row ->> 'id', old_row ->> 'id') = $1 order by id",
    [made.id],
  );
  assert.deepEqual(lines.map((line) => line.action), ["insert", "update", "delete"]);
  const kept = JSON.stringify(lines);
  for (const word of [made.reporter_handle, "Yela", "Prospector", "REDFLAG", "example.com", "Listed the organisation"]) {
    assert.doesNotMatch(kept, new RegExp(word), word);
  }
  // That it arrived, and who handled it, stay.
  assert.equal(lines[1].new_row.state, "handled");
  assert.equal(lines[1].new_row.handled_by, who.command);
});

test("a visitor's only way in is the columns of a report and the page counter", async () => {
  const grants = await fleet.rows(
    `select table_name, privilege_type, string_agg(column_name, ', ' order by column_name) as columns
     from information_schema.column_privileges
     where grantee = 'anon' and table_schema in ('public', 'app') and privilege_type <> 'SELECT'
     group by 1, 2 order by 1, 2`,
  );
  assert.deepEqual(grants, [
    { table_name: "page_view_ticks", privilege_type: "INSERT", columns: "landing, path" },
    {
      table_name: "piracy_reports",
      privilege_type: "INSERT",
      columns: "details, evidence, happened_on, location, reporter_handle, sender, suspect_handle, suspect_kind, urgent",
    },
  ]);
});

test("the report page is a public page, so its views are counted with the rest", async () => {
  await fleet.visitor().query("insert into public.page_view_ticks (path, landing) values ('/piracy', true)");
  await fleet.visitor().query("insert into public.page_view_ticks (path) values ('/piracy/')");
  // Command's page of reports is not a public page.
  await fleet.visitor().query("insert into public.page_view_ticks (path) values ('/admin/piracy')");
  assert.deepEqual(await fleet.rows("select path, views, landings from public.page_views where path like '%piracy%'"), [
    { path: "/piracy", views: 2, landings: 1 },
  ]);
});
