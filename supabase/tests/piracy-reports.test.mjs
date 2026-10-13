// The piracy report line: what a visitor may send, how much the line takes,
// who reads a report, and what command can do with one.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};

// Marks that hide or reorder what is written, made by number so that this file holds none of them.
const made = (code) => String.fromCharCode(code);
const OVERRIDE = made(0x202e);
const ISOLATE = made(0x2066);
const NO_WIDTH = made(0x200b);
const LINE_SEPARATOR = made(0x2028);
const WORD_JOINER = made(0x2060);
const BYTE_ORDER = made(0xfeff);
const ESCAPE = made(0x1b);
// Marks that are part of ordinary writing: the joiners, and the right-to-left mark.
const JOINER = made(0x200d);
const NON_JOINER = made(0x200c);
const RIGHT_TO_LEFT = made(0x200f);

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
    [{ details: "\n".repeat(2000) }, /details/],
    [{ details: `a b c d e f g h i j k l m n${"\n".repeat(40)}` }, /details/],
    [{ details: NO_WIDTH.repeat(20) }, /details/],
    [{ details: `A space of no width ${NO_WIDTH} in the middle of it.` }, /details/],
    [{ details: `A word joiner ${WORD_JOINER} in the middle of the words.` }, /details/],
    [{ details: `A byte order mark ${BYTE_ORDER} in the middle of it.` }, /details/],
    [{ details: "x".repeat(2001) }, /details/],
    [{ location: `Two${LINE_SEPARATOR}lines` }, /location/],
    [{ location: `No${NO_WIDTH}width` }, /location/],
    [{ evidence: `https://example.com/${OVERRIDE}gnp.exe` }, /evidence/],
    [{ evidence: `https://example.com/${ESCAPE}[2J` }, /evidence/],
    [{ evidence: `https://example.com/a${NO_WIDTH}b` }, /evidence/],
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
  const accented = String.fromCharCode(0xe9);
  const kanji = [0x65e5, 0x672c, 0x8a9e].map((code) => String.fromCharCode(code)).join("");
  const fine = await sent({ details: `Line one of what happened.\nLine two: caf${accented}, ${kanji}, 100% "quoted" <b>not markup</b>.` });
  assert.match(fine.details, /Line two/);
  assert.ok(fine.details.includes(kanji));
  // So are the joiners that some scripts and emoji are written with, and the plain right-to-left mark.
  const family = [0x1f468, 0x1f469, 0x1f467].map((code) => String.fromCodePoint(code)).join(JOINER);
  const joined = await sent({
    location: `Pyro ${RIGHT_TO_LEFT}near the gate`,
    details: `They were a family ${family} of pirates, m${NON_JOINER}n, and they took everything.`,
  });
  assert.ok(joined.details.includes(family));
  // A short report is still a report: fifteen characters that are not space.
  await send({ details: "Shot at near Yela." });
  assert.equal((await fleet.rows("select id from public.piracy_reports")).length, 3);
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
  await assert.rejects(send({ sender: "aaaa" }), /Five reports have come from your connection today\./);
  // A report that was refused is not counted, and another sender is not held up.
  assert.equal((await fleet.one("select reports from app.piracy_senders where mark = 'aaaa'")).reports, 5);
  await send({ sender: "bbbb" });
  assert.equal((await fleet.rows("select id from public.piracy_reports")).length, 6);

  // The next day the same mark counts from one.
  await fleet.sql("update app.piracy_senders set day = day - 1");
  await fleet.sql("update public.piracy_reports set received_at = received_at - interval '2 hours'");
  await send({ sender: "aaaa" });
  assert.deepEqual(await fleet.rows("select mark, reports from app.piracy_senders"), [{ mark: "aaaa", reports: 1 }]);
});

test("the count against a mark is kept for its day, and is gone when the next day's first report arrives", async () => {
  for (const sender of ["aaaa", "bbbb", "cccc"]) await send({ sender });
  assert.equal((await fleet.rows("select mark from app.piracy_senders")).length, 3);
  // A day on, a report from someone else arrives. Yesterday's marks are deleted, whoever they were.
  await fleet.sql("update app.piracy_senders set day = day - 1");
  await fleet.sql("update public.piracy_reports set received_at = received_at - interval '1 day'");
  await send({ sender: "dddd" });
  assert.deepEqual(await fleet.rows("select mark, reports from app.piracy_senders"), [{ mark: "dddd", reports: 1 }]);
  // A report that is refused clears nothing and counts nothing.
  await fleet.sql("update app.piracy_senders set day = day - 1");
  await assert.rejects(send({ sender: "eeee", details: "Too short." }), /details/);
  assert.deepEqual(await fleet.rows("select mark from app.piracy_senders"), [{ mark: "dddd" }]);
});

test("the line takes ten reports an hour from everyone together", async () => {
  for (let n = 0; n < 10; n++) await send();
  await assert.rejects(send(), /The report line is full for now\. Try again in an hour\./);
  // An hour on, it takes reports again.
  await fleet.sql("update public.piracy_reports set received_at = received_at - interval '61 minutes'");
  await send();
});

test("the limits hold for reports sent together in one request", async () => {
  // Straight to the database, eleven rows at once, each with a mark of its own.
  const rows = Array.from({ length: 11 }, (_, n) => `('Burst_${n}', 'Stanton', 'Something that happened in the game.', '${mark()}')`).join(", ");
  await assert.rejects(
    fleet.visitor().query(`insert into public.piracy_reports (reporter_handle, location, details, sender) values ${rows}`),
    /The report line is full for now\./,
  );
  // All of them are refused together, and none is counted.
  assert.equal((await fleet.rows("select id from public.piracy_reports")).length, 0);
  assert.equal((await fleet.rows("select mark from app.piracy_senders")).length, 0);
  // Six at once under one mark: the sixth is the sender's limit.
  const same = Array.from({ length: 6 }, (_, n) => `('Same_${n}', 'Stanton', 'Something that happened in the game.', 'ffff')`).join(", ");
  await assert.rejects(
    fleet.visitor().query(`insert into public.piracy_reports (reporter_handle, location, details, sender) values ${same}`),
    /Five reports have come from your connection today\./,
  );
  assert.equal((await fleet.rows("select id from public.piracy_reports")).length, 0);
});

test("the line takes thirty reports a day from everyone together", async () => {
  for (let n = 0; n < 30; n++) {
    await fleet.sql(
      "insert into public.piracy_reports (reporter_handle, location, details, received_at) values ($1, 'Stanton', 'Something that happened in the game.', now() - interval '3 hours')",
      [`Earlier_${n}`],
    );
  }
  await assert.rejects(send(), /The report line is full for today\. Try again tomorrow\./);
  await fleet.sql("update public.piracy_reports set received_at = received_at - interval '22 hours'");
  await send();
});

test("a report twelve months old is sent to nobody, and is deleted the next time the line is used", async () => {
  const old = async (handle) =>
    (
      await fleet.one(
        `insert into public.piracy_reports (reporter_handle, location, details, received_at, suspect_kind, suspect_handle)
         values ($1, 'Stanton, long ago', 'Something that happened a long time ago.', now() - interval '12 months 1 hour', 'individual', 'Old_Enemy')
         returning id`,
        [handle],
      )
    ).id;
  const first = await old("Long_Ago");
  const recent = await fleet.one(
    `insert into public.piracy_reports (reporter_handle, location, details, received_at)
     values ('Nearly_A_Year', 'Stanton', 'Something that happened nearly a year ago.', now() - interval '12 months' + interval '1 hour') returning id`,
  );
  // Command is sent the one that is not yet twelve months old, and not the other, by any road.
  for (const actor of [who.command, who.admin]) {
    assert.deepEqual((await fleet.as(actor).rows("select reporter_handle from public.piracy_reports")).map((row) => row.reporter_handle), ["Nearly_A_Year"]);
    assert.equal((await fleet.as(actor).rows("select id from public.piracy_reports where id = $1", [first])).length, 0);
    assert.equal(await fleet.as(actor).changed("delete from public.piracy_reports where id = $1", [first]), 0);
  }
  assert.equal((await report(first)).reporter_handle, "Long_Ago");

  // The next report to arrive clears it, and its words go from the log of changes.
  await send();
  assert.equal(await report(first), undefined);
  assert.equal((await report(recent.id)).reporter_handle, "Nearly_A_Year");
  const kept = JSON.stringify(await fleet.rows("select old_row, new_row from public.audit_log where coalesce(new_row ->> 'id', old_row ->> 'id') = $1", [first]));
  assert.doesNotMatch(kept, /Long_Ago|long ago|Old_Enemy/);
  assert.match(kept, /received_at/);

  // So does command marking a report.
  const second = await old("Longer_Ago");
  assert.equal(await change(who.command, recent.id, "state = 'handled'"), 1);
  assert.equal(await report(second), undefined);
  assert.equal((await report(recent.id)).state, "handled");
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
