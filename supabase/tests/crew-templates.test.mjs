// Crew templates in depth: groups of command's own choosing, stations with a
// name, a minimum to sail, a brief and a stand-in, and a source per template.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { newFleet } from "./helpers.mjs";

let fleet;
const who = {};
const role = {};
let idris;
let hammerhead;

const stationsOf = (templateId) =>
  fleet.rows(
    `select r.slug as role, s.name, s.count, s.minimum, g.name as "group", (select n.name from public.crew_template_stations n where n.id = s.stand_in_id) as stand_in
     from public.crew_template_stations s join public.fleet_roles r on r.id = s.role_id
     left join public.crew_template_groups g on g.id = s.group_id
     where s.template_id = $1 order by s.sort_order, r.slug, s.name`,
    [templateId],
  );

before(async () => {
  fleet = await newFleet();
  await fleet.sql("update app.bootstrap set founder_discord_id = '1'");
  who.admin = await fleet.signIn("1", "Founder");
  who.staff = await fleet.person("2", "Staff", { roles: ["staff"] });
  who.command = await fleet.person("3", "Command", { roles: ["command"] });
  who.member = await fleet.person("4", "Member");
  who.applicant = await fleet.applicant("7", "Applicant");
  for (const row of await fleet.rows("select id, slug from public.fleet_roles")) role[row.slug] = row.id;
  idris = await fleet.one("select t.id from public.crew_templates t join public.ship_models m on m.id = t.model_id where m.slug = 'idris-m' and t.is_default");
  hammerhead = await fleet.one("select t.id from public.crew_templates t join public.ship_models m on m.id = t.model_id where m.slug = 'hammerhead' and t.is_default");
  await fleet.setStage(3);
});
after(() => fleet.close());

test("the Idris is grouped and marked as Volume 1 sets it out, and the fleet reads it", async () => {
  const groups = await fleet.as(who.member).rows("select name from public.crew_template_groups where template_id = $1 order by sort_order", [idris.id]);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["Command", "Bridge", "Gunnery", "Engineering", "Flight deck", "Security", "Medical"],
  );
  const stations = await stationsOf(idris.id);
  const byRole = new Map(stations.map((station) => [station.role, station]));
  assert.equal(byRole.get("commanding-officer").group, "Command");
  assert.equal(byRole.get("gunner").group, "Gunnery");
  assert.equal(byRole.get("medic").group, "Medical");
  assert.ok(stations.every((station) => station.group !== null), "every Idris station is in a group");
  // The watch bill: eight to sail.
  assert.equal(stations.reduce((sum, station) => sum + station.minimum, 0), 8);
  assert.deepEqual([byRole.get("gunner").minimum, byRole.get("engineer").minimum, byRole.get("helm").minimum, byRole.get("executive-officer").minimum], [4, 1, 1, 0]);
  // The Navigator is the backup helm.
  assert.equal(byRole.get("helm").stand_in, "");
  assert.equal(
    (await fleet.one("select n.role_id = $2 as navigator from public.crew_template_stations s join public.crew_template_stations n on n.id = s.stand_in_id where s.template_id = $1 and s.role_id = $3", [idris.id, role.navigator, role.helm])).navigator,
    true,
  );
  assert.equal((await fleet.one("select source from public.crew_templates where id = $1", [idris.id])).source, "Volume 1, Organisation: Flagship crew");
  assert.equal((await fleet.one("select source from public.crew_templates where id = $1", [hammerhead.id])).source, "Volume 1, Organisation: The rest of the squadron");
  // Staff read them too; an applicant and a visitor do not.
  assert.ok((await fleet.as(who.staff).rows("select id from public.crew_template_groups")).length >= 14);
  assert.deepEqual(await fleet.as(who.applicant).rows("select id from public.crew_template_groups"), []);
  await assert.rejects(fleet.visitor().query("select id from public.crew_template_groups"), /permission denied/);
});

test("command keeps the groups; a group stays with its template and goes with it, leaving its stations ungrouped", async () => {
  for (const actor of [who.member, who.staff]) {
    await assert.rejects(fleet.as(actor).query("insert into public.crew_template_groups (template_id, name) values ($1, 'Theirs')", [hammerhead.id]), /row-level security/);
    assert.equal(await fleet.as(actor).changed("update public.crew_template_groups set name = 'Changed' where template_id = $1", [idris.id]), 0);
    assert.equal(await fleet.as(actor).changed("delete from public.crew_template_groups where template_id = $1", [idris.id]), 0);
  }
  const bridge = await fleet.as(who.command).one("insert into public.crew_template_groups (template_id, name, sort_order) values ($1, 'Bridge', 1) returning id", [hammerhead.id]);
  await assert.rejects(fleet.as(who.command).query("insert into public.crew_template_groups (template_id, name) values ($1, 'Bridge')", [hammerhead.id]), /duplicate key/);
  await assert.rejects(fleet.as(who.command).query("insert into public.crew_template_groups (template_id, name) values ($1, ' Padded')", [hammerhead.id]), /name_check/);
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_groups set template_id = $2 where id = $1", [bridge.id, idris.id]), /permission denied|cannot be moved/);
  assert.equal(await fleet.as(who.command).changed("update public.crew_template_stations set group_id = $2 where template_id = $1 and role_id = $3", [hammerhead.id, bridge.id, role["commanding-officer"]]), 1);
  // A station is grouped within its own template.
  await assert.rejects(
    fleet.as(who.command).query("update public.crew_template_stations set group_id = $2 where template_id = $1 and role_id = $3", [idris.id, bridge.id, role["commanding-officer"]]),
    /within its own template/,
  );
  assert.equal(await fleet.as(who.command).changed("delete from public.crew_template_groups where id = $1", [bridge.id]), 1);
  assert.equal((await fleet.one("select group_id from public.crew_template_stations where template_id = $1 and role_id = $2", [hammerhead.id, role["commanding-officer"]])).group_id, null);
});

test("a station carries a name, a minimum within its count, a brief and a stand-in of the same template; two stations may share a role", async () => {
  const gunner = role.gunner;
  // Volume 1's split: seven turret gunners and two remote weapons operators, both Gunner stations.
  await fleet.as(who.command).query("update public.crew_template_stations set name = 'Turret gunner', count = 7, minimum = 4 where template_id = $1 and role_id = $2", [idris.id, gunner]);
  const remote = await fleet.as(who.command).one(
    "insert into public.crew_template_stations (template_id, role_id, name, count, minimum, brief, sort_order) values ($1, $2, 'Remote weapons operator', 2, 0, 'Works the remote turrets from the bridge.', 15) returning id",
    [idris.id, gunner],
  );
  await assert.rejects(
    fleet.as(who.command).query("insert into public.crew_template_stations (template_id, role_id, name, count) values ($1, $2, 'Remote weapons operator', 1)", [idris.id, gunner]),
    /duplicate key/,
  );
  const gunners = (await stationsOf(idris.id)).filter((station) => station.role === "gunner");
  assert.deepEqual(
    gunners.map((station) => [station.name, station.count, station.minimum]),
    [
      ["Turret gunner", 7, 4],
      ["Remote weapons operator", 2, 0],
    ],
  );
  // The minimum is within the count, and the brief and name are plain.
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_stations set minimum = 3 where id = $1", [remote.id]), /minimum_within_count/);
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_stations set count = 1 where template_id = $1 and role_id = $2 and name = 'Turret gunner'", [idris.id, gunner]), /minimum_within_count/);
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_stations set brief = $2 where id = $1", [remote.id, "x".repeat(301)]), /brief_check/);
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_stations set name = ' Padded' where id = $1", [remote.id]), /name_check/);
  // A stand-in is another station of the same template, never itself.
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_stations set stand_in_id = $1 where id = $1", [remote.id]), /not_own_stand_in/);
  const hammerheadCo = (await fleet.one("select id from public.crew_template_stations where template_id = $1 and role_id = $2", [hammerhead.id, role["commanding-officer"]])).id;
  await assert.rejects(fleet.as(who.command).query("update public.crew_template_stations set stand_in_id = $2 where id = $1", [remote.id, hammerheadCo]), /same template/);
  const turret = (await fleet.one("select id from public.crew_template_stations where template_id = $1 and role_id = $2 and name = 'Turret gunner'", [idris.id, gunner])).id;
  assert.equal(await fleet.as(who.command).changed("update public.crew_template_stations set stand_in_id = $2 where id = $1", [remote.id, turret]), 1);
  // The stand-in goes with the station it pointed at.
  await fleet.as(who.command).query("delete from public.crew_template_stations where id = $1", [turret]);
  assert.equal((await fleet.one("select stand_in_id from public.crew_template_stations where id = $1", [remote.id])).stand_in_id, null);
  // Nobody else writes a station's new facts.
  assert.equal(await fleet.as(who.member).changed("update public.crew_template_stations set brief = 'Mine' where id = $1", [remote.id]), 0);
  assert.equal(await fleet.as(who.staff).changed("update public.crew_template_stations set minimum = 1 where id = $1", [remote.id]), 0);
  // Put the Idris back as the seed has it.
  await fleet.as(who.command).query("delete from public.crew_template_stations where id = $1", [remote.id]);
  await fleet.as(who.command).query("insert into public.crew_template_stations (template_id, role_id, count, minimum, sort_order) values ($1, $2, 9, 4, 14)", [idris.id, gunner]);
});

test("a template's source is command's, and is logged", async () => {
  assert.equal(await fleet.as(who.member).changed("update public.crew_templates set source = 'Mine' where id = $1", [hammerhead.id]), 0);
  assert.equal(await fleet.as(who.command).changed("update public.crew_templates set source = 'Approved by the Fleet Commander, October 2026' where id = $1", [hammerhead.id]), 1);
  await assert.rejects(fleet.as(who.command).query("update public.crew_templates set source = $2 where id = $1", [hammerhead.id, "x".repeat(301)]), /source_check/);
  const logged = await fleet.rows(
    "select new_row ->> 'source' as source, actor from public.audit_log where table_name = 'crew_templates' and action = 'update' and (new_row ->> 'id')::uuid = $1 order by at desc limit 1",
    [hammerhead.id],
  );
  assert.deepEqual(logged, [{ source: "Approved by the Fleet Commander, October 2026", actor: who.command }]);
});
