// The hostile list: who puts a name forward, who decides, how long an entry
// stands, and who is sent it.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
let nextDiscordId = 100;
const fresh = (name, options) => fleet.person(String(nextDiscordId++), name, options);

let nextName = 1;
/** A name nobody has used yet in this file. */
const handle = (prefix = "Raider") => `${prefix}_${nextName++}`;

const propose = (actor, fields = {}) => {
  const row = { kind: "individual", handle: handle(), reason: "Attacked a mining ship at Yela with no warning.", ...fields };
  const columns = Object.keys(row);
  return fleet.as(actor).one(
    `insert into public.hostiles (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
};
const entry = (id) => fleet.one("select * from public.hostiles where id = $1", [id]);
const sees = async (actor, id) => (await fleet.as(actor).rows("select id from public.hostiles where id = $1", [id])).length === 1;
const change = (actor, id, set, params = []) => fleet.as(actor).changed(`update public.hostiles set ${set} where id = $1`, [id, ...params]);
const inDays = async (days) => (await fleet.one("select ((now() at time zone 'utc')::date + $1::int)::text as day", [days])).day;
const day = (value) => (value === null ? null : new Date(value).toISOString().slice(0, 10));

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.other = await fleet.person("5", "Other");
  who.recruit = await fleet.person("6", "Recruit", { status: "recruit" });
  who.reserve = await fleet.person("7", "Reserve", { status: "reserve" });
  who.applicant = await fleet.applicant("8", "Applicant");
  who.discharged = await fleet.person("9", "Discharged", { status: "discharged" });
});
after(() => fleet.close());

test("a serving member puts a name forward, in their own name and dated by the database", async () => {
  const made = await propose(who.member, { name: "Known as Red", evidence: "https://example.com/clip\nhttps://example.com/shot.png" });
  assert.equal(made.state, "proposed");
  assert.equal(made.reported_by, who.member);
  assert.equal(made.level, "hostile");
  assert.equal(made.expires_on, null);
  assert.equal(made.decided_by, null);
  assert.ok(Date.now() - new Date(made.reported_at).getTime() < 60_000);

  // A recruit and a reservist serve, so they may too.
  for (const actor of [who.recruit, who.reserve]) assert.equal((await propose(actor)).reported_by, actor);
});

test("nobody outside the fleet puts a name forward or reads the list", async () => {
  for (const actor of [who.applicant, who.discharged]) {
    await assert.rejects(propose(actor), /row-level security|Only a serving member/);
    assert.deepEqual(await fleet.as(actor).rows("select id from public.hostiles"), []);
  }
  await assert.rejects(fleet.visitor().query("select * from public.hostiles"), /permission denied/);
  await assert.rejects(
    fleet.visitor().query("insert into public.hostiles (kind, handle, reason) values ('individual', 'Anyone', 'Something that happened.')"),
    /permission denied/,
  );
});

test("a member cannot list a name themselves, sign it as someone else or choose its dates", async () => {
  await assert.rejects(propose(who.member, { state: "listed" }), /Command decides/);
  await assert.rejects(propose(who.staff, { state: "listed" }), /Command decides/);
  for (const [column, value] of [
    ["reported_by", who.other],
    ["decided_by", who.command],
    ["expires_on", "2099-01-01"],
    ["reported_at", "2001-01-01"],
    ["decision_note", "Approved."],
  ]) {
    await assert.rejects(propose(who.member, { [column]: value }), /permission denied/, column);
  }
});

test("a name that waits is seen by whoever put it forward and by command, and by nobody else", async () => {
  const made = await propose(who.member);
  assert.equal(await sees(who.member, made.id), true);
  assert.equal(await sees(who.command, made.id), true);
  assert.equal(await sees(who.admin, made.id), true);
  for (const actor of [who.other, who.staff, who.recruit, who.reserve, who.applicant, who.discharged]) {
    assert.equal(await sees(actor, made.id), false);
  }
});

test("command lists a name, and then the whole serving fleet reads it", async () => {
  const made = await propose(who.member);
  assert.equal(await change(who.command, made.id, "state = 'listed', decision_note = 'Seen the clip.'"), 1);
  const listed = await entry(made.id);
  assert.equal(listed.state, "listed");
  assert.equal(listed.decided_by, who.command);
  assert.ok(listed.decided_at);
  assert.equal(listed.reported_by, who.member, "the reporter stays the reporter");
  assert.equal(day(listed.expires_on), await inDays(90), "an individual lapses after 90 days");

  for (const actor of [who.member, who.other, who.staff, who.recruit, who.reserve, who.command]) {
    assert.equal(await sees(actor, made.id), true);
  }
  for (const actor of [who.applicant, who.discharged]) assert.equal(await sees(actor, made.id), false);
});

test("only command decides", async () => {
  const made = await propose(who.member);
  for (const actor of [who.member, who.other, who.staff, who.recruit]) {
    assert.equal(await change(actor, made.id, "state = 'listed'"), 0, "the access rules hide the row from the change");
    assert.equal(await change(actor, made.id, "reason = 'Rewritten by someone else entirely.'"), 0);
  }
  assert.equal((await entry(made.id)).state, "proposed");
});

test("command declines a name with a word of why, and the reporter still reads the answer", async () => {
  const made = await propose(who.member);
  assert.equal(await change(who.command, made.id, "state = 'declined', decision_note = 'One clip, no context.'"), 1);
  const declined = await entry(made.id);
  assert.equal(declined.state, "declined");
  assert.equal(declined.decided_by, who.command);
  assert.equal(declined.expires_on, null);
  assert.equal(await sees(who.member, made.id), true);
  assert.equal(await sees(who.other, made.id), false);
});

test("a declared hostile organisation stands until it is lifted, and anything on watch lapses", async () => {
  const hostileOrg = await propose(who.command, { kind: "organisation", handle: handle("ORG"), state: "listed" });
  assert.equal(hostileOrg.state, "listed", "command lists a name outright");
  assert.equal(hostileOrg.decided_by, who.command);
  assert.equal(hostileOrg.reported_by, who.command);
  assert.equal(hostileOrg.expires_on, null);

  const watchedOrg = await propose(who.command, { kind: "organisation", handle: handle("ORG"), state: "listed", level: "watch" });
  assert.equal(day(watchedOrg.expires_on), await inDays(90));
  const watchedPlayer = await propose(who.command, { state: "listed", level: "watch" });
  assert.equal(day(watchedPlayer.expires_on), await inDays(90));
});

test("a renewal runs 90 days from today, whatever day is asked for", async () => {
  const made = await propose(who.command, { state: "listed" });
  // Sixty days on, as only the database owner can arrange.
  await fleet.sql("update public.hostiles set expires_on = (now() at time zone 'utc')::date + 30 where id = $1", [made.id]);
  assert.equal(await change(who.command, made.id, "expires_on = '2099-01-01'"), 1);
  const renewed = await entry(made.id);
  assert.equal(day(renewed.expires_on), await inDays(90));
  assert.equal(renewed.renewed_by, who.command);
  assert.ok(renewed.renewed_at);

  // A hostile organisation has no last day to move.
  const org = await propose(who.command, { kind: "organisation", handle: handle("ORG"), state: "listed" });
  assert.equal(await change(who.command, org.id, "expires_on = '2099-01-01'"), 1);
  assert.equal((await entry(org.id)).expires_on, null);
});

test("moving an entry between hostile and watch starts its time again", async () => {
  const org = await propose(who.command, { kind: "organisation", handle: handle("ORG"), state: "listed" });
  assert.equal(await change(who.command, org.id, "level = 'watch'"), 1);
  assert.equal(day((await entry(org.id)).expires_on), await inDays(90));
  assert.equal(await change(who.command, org.id, "level = 'hostile'"), 1);
  assert.equal((await entry(org.id)).expires_on, null);

  const player = await propose(who.command, { state: "listed" });
  await fleet.sql("update public.hostiles set expires_on = (now() at time zone 'utc')::date + 5 where id = $1", [player.id]);
  assert.equal(await change(who.command, player.id, "level = 'watch'"), 1);
  assert.equal(day((await entry(player.id)).expires_on), await inDays(90));
});

test("an entry that has lapsed is off the fleet's list, and command still reads it", async () => {
  const made = await propose(who.member);
  await change(who.command, made.id, "state = 'listed'");
  assert.equal(await sees(who.other, made.id), true);
  await fleet.sql("update public.hostiles set expires_on = (now() at time zone 'utc')::date where id = $1", [made.id]);
  assert.equal(await sees(who.other, made.id), true, "it stands through its last day");
  await fleet.sql("update public.hostiles set expires_on = (now() at time zone 'utc')::date - 1 where id = $1", [made.id]);
  assert.equal(await sees(who.other, made.id), false);
  assert.equal(await sees(who.staff, made.id), false);
  assert.equal(await sees(who.command, made.id), true);
  assert.equal(await sees(who.member, made.id), true, "whoever put it forward still reads it");

  // Command renews it, and it is back on the list.
  assert.equal(await change(who.command, made.id, "expires_on = (now() at time zone 'utc')::date"), 1);
  assert.equal(await sees(who.other, made.id), true);
});

test("command lifts an entry, and a closed entry cannot be changed or reopened", async () => {
  const made = await propose(who.member);
  await change(who.command, made.id, "state = 'listed'");
  assert.equal(await change(who.command, made.id, "state = 'lifted', decision_note = 'Made amends.'"), 1);
  const lifted = await entry(made.id);
  assert.equal(lifted.lifted_by, who.command);
  assert.ok(lifted.lifted_at);
  assert.equal(await sees(who.other, made.id), false);

  const command = fleet.as(who.command);
  await assert.rejects(command.query("update public.hostiles set state = 'listed' where id = $1", [made.id]), /entry is closed/);
  await assert.rejects(command.query("update public.hostiles set reason = 'Changed after the fact.' where id = $1", [made.id]), /entry is closed/);

  const declined = await propose(who.member);
  await change(who.command, declined.id, "state = 'declined'");
  await assert.rejects(command.query("update public.hostiles set state = 'listed' where id = $1", [declined.id]), /entry is closed/);
});

test("an entry moves forward only: put forward, then listed or declined, then lifted", async () => {
  const made = await propose(who.member);
  const command = fleet.as(who.command);
  await assert.rejects(command.query("update public.hostiles set state = 'lifted' where id = $1", [made.id]), /put forward, then listed or declined/);
  await change(who.command, made.id, "state = 'listed'");
  await assert.rejects(command.query("update public.hostiles set state = 'proposed' where id = $1", [made.id]), /put forward, then listed or declined/);
  await assert.rejects(command.query("update public.hostiles set state = 'declined' where id = $1", [made.id]), /put forward, then listed or declined/);
});

test("a name has one open entry at a time, whatever case it is written in", async () => {
  const name = handle("Twice");
  const made = await propose(who.member, { handle: name });
  await assert.rejects(propose(who.other, { handle: name.toUpperCase() }), /duplicate key/);
  // An organisation of the same ID is another matter.
  await propose(who.other, { kind: "organisation", handle: name });

  await change(who.command, made.id, "state = 'declined'");
  const again = await propose(who.other, { handle: name });
  assert.equal(again.state, "proposed", "a name that was declined can be put forward again");
});

test("an entry stays about the name it was made for", async () => {
  const made = await propose(who.member);
  const command = fleet.as(who.command);
  await assert.rejects(command.query("update public.hostiles set handle = 'Someone_Else' where id = $1", [made.id]), /permission denied/);
  await assert.rejects(command.query("update public.hostiles set kind = 'organisation' where id = $1", [made.id]), /permission denied/);
  await assert.rejects(fleet.sql("update public.hostiles set handle = 'Someone_Else' where id = $1", [made.id]), /about one name/);
});

test("a serving member of the fleet cannot be listed", async () => {
  const mate = await fresh("Shipmate");
  await fleet.sql("update public.members set rsi_handle = 'Ship_Mate' where id = $1", [mate]);
  await assert.rejects(propose(who.member, { handle: "ship_mate" }), /serves in this fleet/);
  await assert.rejects(propose(who.command, { handle: "Ship_Mate", state: "listed" }), /serves in this fleet/);
  // An organisation is not a member, whatever its ID.
  await propose(who.member, { kind: "organisation", handle: "Ship_Mate" });

  // Someone put forward who has since joined cannot then be listed.
  const made = await propose(who.member, { handle: "Late_Joiner" });
  const joiner = await fresh("Late joiner");
  await fleet.sql("update public.members set rsi_handle = 'late_joiner' where id = $1", [joiner]);
  await assert.rejects(fleet.as(who.command).query("update public.hostiles set state = 'listed' where id = $1", [made.id]), /serves in this fleet/);
  assert.equal(await change(who.command, made.id, "state = 'declined'"), 1);
});

test("whoever put a name forward takes it back while it waits, and nobody else does", async () => {
  const made = await propose(who.member);
  const remove = (actor, id) => fleet.as(actor).changed("delete from public.hostiles where id = $1", [id]);
  assert.equal(await remove(who.other, made.id), 0);
  assert.equal(await remove(who.staff, made.id), 0);
  assert.equal(await remove(who.command, made.id), 0, "command declines a name, and does not delete it");
  assert.equal(await remove(who.member, made.id), 1);

  const listed = await propose(who.member);
  await change(who.command, listed.id, "state = 'listed'");
  assert.equal(await remove(who.member, listed.id), 0, "once it is decided it is part of the record");
  assert.equal(await remove(who.admin, listed.id), 1, "an admin removes one made by mistake");
});

test("an entry holds a name from the game, what happened and web addresses, and nothing else gets in", async () => {
  for (const bad of ["a", "Has Space", "semi;colon", "<script>", "x".repeat(61), ""]) {
    await assert.rejects(propose(who.member, { handle: bad }), /violates check constraint/, bad);
  }
  await assert.rejects(propose(who.member, { reason: "Too short" }), /violates check constraint/);
  await assert.rejects(propose(who.member, { reason: "x".repeat(2001) }), /violates check constraint/);
  for (const bad of ["not an address", "javascript:alert(1)", "https://ok.example\nfile:///etc/passwd", "https://two.example https://on-one-line.example", "ftp://old.example/file"]) {
    await assert.rejects(propose(who.member, { evidence: bad }), /violates check constraint/, bad);
  }
  const fine = await propose(who.member, { evidence: "https://example.com/a\nhttp://example.org/b?c=d#e" });
  assert.equal(fine.evidence, "https://example.com/a\nhttp://example.org/b?c=d#e");
  await assert.rejects(propose(who.member, { name: " padded " }), /violates check constraint/);
});

test("command rewrites a listed entry's words without moving its last day", async () => {
  const made = await propose(who.command, { state: "listed" });
  await fleet.sql("update public.hostiles set expires_on = (now() at time zone 'utc')::date + 10 where id = $1", [made.id]);
  assert.equal(await change(who.command, made.id, "reason = 'Attacked two more ships the week after.', name = 'Also flies as Blue'"), 1);
  const after = await entry(made.id);
  assert.equal(day(after.expires_on), await inDays(10));
  assert.equal(after.renewed_by, null);
});

test("every step is in the audit log", async () => {
  const made = await propose(who.member);
  await change(who.command, made.id, "state = 'listed'");
  await change(who.command, made.id, "state = 'lifted'");
  const lines = await fleet.rows(
    "select action, actor, new_row ->> 'state' as state from public.audit_log where table_name = 'hostiles' and new_row ->> 'id' = $1 order by id",
    [made.id],
  );
  assert.deepEqual(lines, [
    { action: "insert", actor: who.member, state: "proposed" },
    { action: "update", actor: who.command, state: "listed" },
    { action: "update", actor: who.command, state: "lifted" },
  ]);
});
