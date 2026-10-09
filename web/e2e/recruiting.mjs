// Applies to join, and handles applications as staff, in a real browser
// against the fleet's real database rules.
//
// The stand-in for Supabase here runs the migrations in supabase/migrations in
// an in-memory PostgreSQL, so every refusal and every side effect in this test
// comes from the same rules the live database uses.
//
// Run it with `npm run e2e`. It builds nothing: run `npm run build` first.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createChecks, openBrowser, startSite } from "./harness.mjs";
import { startSupabaseWithDatabase } from "./supabase-with-database.mjs";

const SITE_PORT = 3112;
const DATABASE_PORT = 54398;
const DISCORD_PORT = 54399;

const founder = { discordId: "1", name: "ada_on_discord" };
const kit = { discordId: "7", name: "kit_on_discord" };
const jo = { discordId: "8", name: "jo_on_discord" };
const sam = { discordId: "9", name: "sam_on_discord" };
const lee = { discordId: "10", name: "lee_on_discord" };

const { check, finish } = createChecks();

const supabase = await startSupabaseWithDatabase(DATABASE_PORT);
await supabase.sql("update app.bootstrap set founder_discord_id = $1", [founder.discordId]);

const one = async (text, params) => (await supabase.sql(text, params))[0];
const memberOf = (person) =>
  one(
    `select m.id, m.status, m.service, m.character_name from public.members m
     join public.member_accounts a on a.member_id = m.id where a.discord_id = $1`,
    [person.discordId],
  );
const applicationsOf = async (person) =>
  supabase.sql(
    `select p.id, p.stage, p.preferred_service, p.answers, p.decided_by, p.submitted_at
     from public.applications p join public.member_accounts a on a.member_id = p.member_id
     where a.discord_id = $1 order by p.submitted_at desc`,
    [person.discordId],
  );

// A stand-in for the fleet's Discord channel. It keeps what the site posts to it,
// and can be told to turn the next post away.
const discord = { posts: [], failNext: false };
const discordServer = createServer((request, response) => {
  let text = "";
  request.on("data", (chunk) => (text += chunk));
  request.on("end", () => {
    if (discord.failNext) {
      discord.failNext = false;
      response.writeHead(500).end();
      return;
    }
    discord.posts.push({ path: request.url, body: JSON.parse(text || "{}") });
    response.writeHead(204).end();
  });
});
await new Promise((resolve) => discordServer.listen(DISCORD_PORT, "127.0.0.1", resolve));

let running;
let browser;
try {
  running = await startSite({
    port: SITE_PORT,
    env: {
      SUPABASE_URL: supabase.origin,
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_for_tests",
      DISCORD_ANNOUNCE_WEBHOOK: `http://127.0.0.1:${DISCORD_PORT}/api/webhooks/1/for-tests`,
    },
  });
  const { site } = running;
  const opened = await openBrowser();
  browser = opened.browser;
  const { context, page, pageErrors, shot, headingIs } = opened;

  // A page shows a holding line while its record is read, so wait for the
  // line that is expected instead of reading whichever is there first.
  const leadIs = (pattern) => page.locator(".page-head .lead:visible").filter({ hasText: pattern }).waitFor();
  const signInAs = async (person) => {
    await context.clearCookies();
    supabase.signInAs(person);
    await page.goto(`${site}/sign-in`);
    await page.getByRole("button", { name: "Sign in with Discord" }).click();
    await page.waitForURL(`${site}/profile`);
    await page.getByRole("heading", { name: "Where you stand" }).waitFor();
  };
  const setNames = async (name, handle) => {
    await page.goto(`${site}/profile`);
    await page.getByLabel("Character name").fill(name);
    await page.getByLabel("RSI handle").fill(handle);
    await page.getByRole("button", { name: "Save" }).click();
    await page.locator(".form-result").filter({ hasText: "Saved." }).waitFor();
  };
  const fillForm = async ({ confirm = true } = {}) => {
    await page.getByLabel("Why do you want to join the 9th Fleet?").fill("To crew a ship properly,\nwith people who turn up.");
    await page.getByLabel("What have you done in Star Citizen so far?").fill("Two years, mostly turrets and salvage.");
    await page.getByLabel("Which evenings can you usually make?").fill("Wednesday and Sunday, UK time.");
    for (const box of await page.getByRole("checkbox").all()) {
      if (confirm) await box.check();
    }
  };
  const send = () => page.getByRole("button", { name: "Send application" }).click();
  const apply = async () => {
    await page.goto(`${site}/apply`);
    await fillForm();
    await send();
    await page.getByText("Your application is with staff").waitFor();
  };
  const withdraw = async () => {
    await page.goto(`${site}/apply`);
    await page.locator("summary", { hasText: "Withdraw" }).click();
    await page.getByRole("button", { name: "Yes, withdraw it" }).click();
    await page.getByRole("button", { name: "Send application" }).waitFor();
  };
  const openApplication = async (name) => {
    await page.goto(`${site}/staff/applications`);
    await page.getByRole("link", { name, exact: true }).first().click();
    await headingIs(name);
  };
  const decide = async (button, confirmButton) => {
    await page.locator(".decisions summary", { hasText: new RegExp(`^${button}$`) }).click();
    await page.getByRole("button", { name: confirmButton }).click();
  };

  // The founder signs in once so the fleet has its admin, and is given a name.
  await signInAs(founder);
  await supabase.sql("update public.members set character_name = 'Ada Vance', rsi_handle = 'AdaVance' where id = $1", [
    (await memberOf(founder)).id,
  ]);

  console.log("Ranks");
  await check("a visitor who is not signed in can read every rank", async () => {
    await context.clearCookies();
    await page.goto(`${site}/ranks`);
    await page.getByRole("heading", { name: "Starman Recruit" }).waitFor();
    assert.equal(await page.locator(".rank").count(), 18);
    const tally = await page.locator(".tally").innerText();
    assert.match(tally, /18/);
    assert.match(tally, /Lt\. Commander/);
    // The top of the ladder opens with the fleet's stage.
    const commander = page.locator(".rank", { has: page.getByRole("heading", { name: "Commander", exact: true }) });
    assert.match(await commander.innerText(), /Opens at stage 4/);
    assert.doesNotMatch(await page.locator(".rank", { hasText: "Lt. Commander" }).innerText(), /Opens at stage/);
    await shot("ranks");
  });
  await check("the ranks page shows each service's own names, and when a closed service opens", async () => {
    await page.getByRole("button", { name: "Army" }).click();
    await page.getByRole("heading", { name: "Private", exact: true }).waitFor();
    assert.match(await page.locator(".ladder-note").innerText(), /Opens at stage 4/);
    await page.getByRole("button", { name: "Marines" }).click();
    await page.getByRole("heading", { name: "Trooper", exact: true }).waitFor();
    assert.match(await page.locator(".ladder-note").innerText(), /Opens at stage 5/);
  });

  console.log("Roles");
  // What the database gives someone who is not signed in.
  const asVisitor = async (table) => {
    const response = await fetch(`${supabase.origin}/rest/v1/${table}?select=*`, {
      headers: { apikey: "sb_publishable_for_tests" },
    });
    const body = await response.json().catch(() => null);
    return Array.isArray(body) ? body : [];
  };
  await check("a visitor can read every area of the fleet and filter them", async () => {
    await context.clearCookies();
    await page.goto(`${site}/roles`);
    await headingIs("Roles in the fleet");
    await page.locator(".tile").first().waitFor();
    assert.equal(await page.locator(".tile").count(), 15);
    const gunnery = await page.locator(".tile", { has: page.getByRole("link", { name: "Gunnery" }) }).innerText();
    assert.match(gunnery, /Open now/i);
    assert.match(gunnery, /17 posts/i);
    const lift = await page.locator(".tile", { has: page.getByRole("link", { name: "Lift" }) }).innerText();
    assert.match(lift, /Opens at stage 4/i);
    assert.match(await page.locator(".filter-count").innerText(), /15 areas · 5 open now/);

    await page.getByRole("button", { name: "Flight", exact: true }).click();
    assert.equal(await page.locator(".tile:visible").count(), 2);
    assert.match(await page.locator(".filter-count").innerText(), /2 areas · none open yet/);
    await page.getByRole("button", { name: "All areas" }).click();
    await shot("roles");
  });
  await check("an area lists its roles, not each ship's posts", async () => {
    await page.getByRole("link", { name: "Gunnery" }).click();
    await headingIs("Gunnery");
    await page.locator(".role-card").first().waitFor();
    // Two roles: the chief, and one Gunner role for every gunner on every ship.
    assert.deepEqual(await page.locator(".role-card h3").allInnerTexts(), ["Gunnery Chief", "Gunner"]);
    const gunner = await page.locator(".role-card", { has: page.getByRole("link", { name: "Gunner", exact: true }) }).innerText();
    assert.match(gunner, /Open now/i);
    assert.match(gunner, /Entry post/i);
    assert.match(gunner, /Mans a ship's weapons, from a turret or a remote weapons station\./);
    assert.match(gunner, /E2 to E4/);
    assert.match(gunner, /16 posts/);
    assert.match(gunner, /3 ships/);
    const chief = await page.locator(".role-card", { has: page.getByRole("link", { name: "Gunnery Chief" }) }).innerText();
    assert.match(chief, /Opens at stage 2/i);
    assert.match(chief, /UEES Nexus/);
    await shot("roles-area");
  });
  await check("a role's page is about the role, and lists every ship it is found on", async () => {
    await page.getByRole("link", { name: "Gunner", exact: true }).click();
    await headingIs("Gunner");
    await leadIs("Mans a ship's weapons, from a turret or a remote weapons station.");
    const facts = await page.locator(".facts:visible").innerText();
    assert.match(facts, /Primary role/);
    assert.match(facts, /E2 to E4/);
    assert.match(facts, /Training Ship, UEES Nexus and Escort One\s*16 posts/);
    assert.match(facts, /Open now/);
    assert.match(facts, /Leads to\s+Gunnery Chief/i);

    const places = page.locator(".places:visible .role-card");
    assert.deepEqual(await places.locator("h3").allInnerTexts(), ["Training Ship", "UEES Nexus", "Escort One"]);
    const nexus = await places.nth(1).innerText();
    assert.match(nexus, /Opens at stage 2/i);
    assert.match(nexus, /UEE 9th Fleet › Task Force Jericho › UEES Nexus › Gunnery/);
    // The posts keep the names of their stations, under the one role.
    assert.match(nexus, /7 Turret Gunner, 2 Remote Weapons Operator/);
    assert.match(nexus, /E2 to E4\s*Starman to Jr\. Petty Officer/);
    assert.match(nexus, /Stage 2 to 3/);
    assert.match(await places.nth(0).innerText(), /Open now[\s\S]*4 posts/i);

    const qualify = await page.locator(".cards:visible").innerText();
    assert.match(qualify, /assessed radio exchange/);
    assert.match(qualify, /Every Gunner post needs this/i);
    await shot("roles-card");
    // What to read leads into the manual.
    await page.getByRole("link", { name: "Navy squadron" }).click();
    await headingIs("Navy squadron");
  });
  await check("a role shows where it leads, so progression can be seen", async () => {
    await page.goto(`${site}/roles/engineering/engineer`);
    await headingIs("Engineer");
    const steps = page.locator(".progression:visible li");
    assert.deepEqual(await steps.allInnerTexts(), ["Engineer", "Senior Engineer", "Chief Engineer"]);
    assert.equal(await page.locator(".progression:visible [aria-current]").innerText(), "Engineer");
    // Engineer and Senior Engineer are roles of their own.
    await page.locator(".progression:visible").getByRole("link", { name: "Senior Engineer" }).click();
    await headingIs("Senior Engineer");
    assert.match(await page.locator(".facts:visible").innerText(), /Leads to\s+Chief Engineer\s*Comes from Engineer/i);
    // A pilot of the first flight is a Fighter Pilot, who can become a Flight Lead.
    await page.goto(`${site}/roles/fighters/fighter-pilot`);
    await headingIs("Fighter Pilot");
    assert.match(await page.locator(".facts:visible").innerText(), /A Flight\s*3 posts[\s\S]*Leads to\s+Flight Lead/i);
  });
  await check("a duty is shown as a duty, with no rank", async () => {
    await page.goto(`${site}/roles/staff-duties/recruiter`);
    await headingIs("Recruiter");
    await leadIs("Interviews the people who apply to join.");
    const facts = await page.locator(".facts:visible").innerText();
    assert.match(facts, /Secondary duty/);
    assert.match(facts, /E4\s+and above/);
    assert.doesNotMatch(await page.locator("main").innerText(), /Rank follows the post/);
    // What a post needs of its own is shown with the role.
    await page.goto(`${site}/roles/signals/signaller`);
    await headingIs("Signaller");
    assert.match(await page.locator(".facts:visible").innerText(), /Needs\s+Nothing of its own yet\s*Some posts need more/i);
    assert.match(await page.locator(".cards:visible").innerText(), /Net controller[\s\S]*Every Signaller post needs this/i);
  });
  await check("an area that opens later says so, and an unknown area or role is not found", async () => {
    await page.goto(`${site}/roles/boarding`);
    await headingIs("Boarding");
    await page.getByText("It opens at stage 6").waitFor();
    await page.goto(`${site}/roles/nothing-here`);
    await headingIs("Nothing heard.");
    await page.goto(`${site}/roles/gunnery/nothing-here`);
    await headingIs("Nothing heard.");
    // A role is no longer one ship's posts, so the old addresses are gone.
    await page.goto(`${site}/roles/gunnery/uees-nexus-turret-gunner`);
    await headingIs("Nothing heard.");
  });
  await check("the roles pages never name who holds a post", async () => {
    // Ada Vance holds Fleet Commander. A visitor is shown the role and not the person.
    await page.goto(`${site}/roles/command/fleet-commander`);
    await headingIs("Fleet Commander");
    await page.locator(".facts:visible").waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /Ada|Vance|ada_on_discord/i);
    assert.match(await page.locator(".facts:visible").innerText(), /Shown to serving members/);
  });
  await check("the database gives a visitor the structure and nothing about people", async () => {
    assert.ok((await asVisitor("units")).length > 0, "a visitor cannot read the units");
    assert.ok((await asVisitor("positions")).length > 0, "a visitor cannot read the posts");
    assert.equal((await asVisitor("areas")).length, 15, "a visitor cannot read the areas");
    assert.equal((await asVisitor("fleet_roles")).length, 30, "a visitor cannot read the roles");
    for (const table of [
      "members",
      "member_accounts",
      "member_roles",
      "roster",
      "assignments",
      "qualification_awards",
      "applications",
      "application_notes",
      "audit_log",
    ]) {
      assert.deepEqual(await asVisitor(table), [], `a visitor can read ${table}`);
    }
  });

  console.log("Fleet manual");
  await check("the manual lists ten volumes and publishes only the reviewed ones", async () => {
    await page.goto(`${site}/manual`);
    await headingIs("Fleet manual");
    assert.equal(await page.locator(".volume-card").count(), 10);
    assert.equal(await page.locator(".volume-card a").count(), 3, "only written volumes have a page");
    const figures = await page.locator(".figures").innerText();
    assert.match(figures, /Published\s+2/i);
    assert.match(figures, /In review\s+1/i);
    await shot("manual");
  });
  await check("a section reads as the volume wrote it, with its tables", async () => {
    await page.getByRole("navigation", { name: "Volumes" }).getByText("Organisation").click();
    await page.getByRole("navigation", { name: "Volumes" }).getByRole("link", { name: "Navy squadron" }).click();
    await headingIs("Navy squadron");
    assert.match(await page.locator(".panel-lead").innerText(), /124 primary posts/);
    const table = await page.locator(".manual-text table").first().innerText();
    assert.match(table, /Turret Gunner\s+E2 to E4\s+7/);
    await page.getByRole("link", { name: /Forward to\s*Patrol and support flotilla/ }).click();
    await headingIs("Patrol and support flotilla");
    await shot("manual-section");
  });
  await check("review notes are not published", async () => {
    await page.goto(`${site}/manual/organisation/decisions-on-this-volume`);
    await headingIs("Nothing heard.");
    for (const path of ["/manual/organisation", "/manual/organisation/primary-posts-and-secondary-duties", "/manual/command/command-at-launch"]) {
      const text = await (await fetch(`${site}${path}`)).text();
      assert.doesNotMatch(text, /my proposal|Decisions on this volume|Tom Bombadil/, path);
    }
  });
  await check("a volume still in review is named and shows none of its text", async () => {
    await page.goto(`${site}/manual/communications`);
    await headingIs("Communications");
    await page.getByText("the Fleet Commander is reviewing it").waitFor();
    assert.equal(await page.locator(".section-list").count(), 0);
    for (const path of ["/manual/communications/voice-procedure", "/manual/communications/nets", "/manual/personnel"]) {
      await page.goto(`${site}${path}`);
      await headingIs("Nothing heard.");
    }
  });

  console.log("Before recruitment opens");
  await check("an applicant is told when recruitment opens, and sees no form", async () => {
    await signInAs(kit);
    await page.goto(`${site}/apply`);
    await headingIs("Apply to join");
    await leadIs(/Recruitment opens on 6 February 2027/);
    assert.equal(await page.getByRole("button", { name: "Send application" }).count(), 0);
  });
  await check("an applicant is not shown the order of battle, though anyone may read the structure", async () => {
    await page.goto(`${site}/order-of-battle`);
    await leadIs(/for the serving fleet/);
    assert.equal(await page.locator(".posts").count(), 0);
  });
  await check("the staff pages are for staff", async () => {
    await page.goto(`${site}/staff/applications`);
    await leadIs(/for the fleet's staff/);
    await page.goto(`${site}/profile`);
    await page.getByRole("heading", { name: "Where you stand" }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Applications" }).count(), 0);
  });

  console.log("Opening recruitment");
  await check("the admin opens recruitment from the staff page, after being asked once more", async () => {
    await signInAs(founder);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await headingIs("Applications");
    await page.getByText("Recruitment is closed.").waitFor();
    await leadIs(/No application needs anything from staff/);
    await page.locator("summary", { hasText: "Open recruitment" }).click();
    assert.equal((await one("select recruitment_open from public.fleet_settings")).recruitment_open, false);
    await page.getByRole("button", { name: "Yes, open it" }).click();
    await page.getByText("Recruitment is open.").waitFor();
    assert.equal((await one("select recruitment_open from public.fleet_settings")).recruitment_open, true);
  });

  console.log("Applying");
  await check("an applicant sets their names before they can apply", async () => {
    await signInAs(kit);
    await page.getByRole("link", { name: "Apply, or see your application" }).click();
    await page.waitForURL(`${site}/apply`);
    await leadIs(/needs to know what to call you/);
    await page.getByRole("link", { name: "Set your names" }).click();
    await page.waitForURL(`${site}/profile#names`);
    await setNames("Kit Marlow", "Kit_Marlow");
    await page.goto(`${site}/apply`);
    await page.getByRole("button", { name: "Send application" }).waitFor();
    assert.match(await page.locator("main").innerText(), /The Navy is the only service open/);
    await shot("apply-form");
  });
  await check("an unfinished application is refused with the reason", async () => {
    // The browser's own checks are switched off so the server's answer is seen.
    await page.locator("form.fields").evaluate((form) => form.setAttribute("novalidate", ""));
    await send();
    await page.locator(".form-result").filter({ hasText: 'Answer the question "Why do you want to join the 9th Fleet?"' }).waitFor();

    await page.locator("form.fields").evaluate((form) => form.setAttribute("novalidate", ""));
    await fillForm({ confirm: false });
    await send();
    await page.locator(".form-result").filter({ hasText: "You need to confirm: I am 18 or over." }).waitFor();
    assert.deepEqual(await applicationsOf(kit), []);
  });
  await check("a finished application reaches the database as it was written", async () => {
    await fillForm();
    await send();
    await page.getByText("Your application is with staff").waitFor();
    const text = await page.locator("main").innerText();
    assert.match(text, /Service\s+Navy/i);
    assert.match(text, /Stage\s+Waiting to be read/i);

    const [stored] = await applicationsOf(kit);
    assert.equal(stored.stage, "submitted");
    assert.equal(stored.preferred_service, "navy");
    assert.deepEqual(stored.answers.answers[0], {
      question: "Why do you want to join the 9th Fleet?",
      answer: "To crew a ship properly,\nwith people who turn up.",
    });
    assert.equal(stored.answers.answers.length, 3, "the optional question was left out");
    assert.equal(stored.answers.confirmed.length, 3);
    assert.ok(Math.abs(Date.now() - new Date(stored.submitted_at).getTime()) < 60_000, "dated by the database");
    await shot("apply-waiting");
  });
  await check("an applicant can withdraw and apply again", async () => {
    await withdraw();
    assert.match(await page.locator("main").innerText(), /You withdrew your last application/);
    assert.equal((await applicationsOf(kit))[0].stage, "withdrawn");
    await apply();
    const stages = (await applicationsOf(kit)).map((row) => row.stage);
    assert.deepEqual(stages, ["submitted", "withdrawn"]);
  });

  console.log("Staff");
  await check("staff see who is waiting", async () => {
    await signInAs(founder);
    await page.goto(`${site}/staff/applications`);
    await headingIs("Applications");
    await leadIs(/1 waiting to be read\./);
    const waiting = page.locator("section.band", { has: page.getByRole("heading", { name: "Waiting to be read" }) });
    assert.match(await waiting.innerText(), /Kit Marlow[\s\S]*Kit_Marlow\. Navy\./);
    await page.getByText("Show the 1 closed application").waitFor();
    await shot("staff-applications");
  });
  await check("an application shows the applicant, their answers and what they confirmed", async () => {
    await openApplication("Kit Marlow");
    const text = await page.locator("main").innerText();
    assert.match(text, /Waiting to be read\. Sent on/);
    assert.match(text, /Discord\s+kit_on_discord/i);
    assert.match(text, /Status now\s+Applicant/i);
    assert.match(text, /To crew a ship properly,\nwith people who turn up\./);
    assert.match(text, /I am 18 or over\./);
    assert.equal(
      await page.getByRole("link", { name: "Kit_Marlow" }).getAttribute("href"),
      "https://robertsspaceindustries.com/en/citizens/Kit_Marlow",
    );
  });
  await check("staff keep interview notes in their own name", async () => {
    await page.getByLabel("Add a note").fill("Clear on the radio.\nKeen on engineering.");
    await page.getByRole("button", { name: "Save note" }).click();
    await page.locator(".notes li").filter({ hasText: "Clear on the radio." }).waitFor();
    assert.match(await page.locator(".notes").innerText(), /Ada Vance, /);
    const note = await one("select author_id, body from public.application_notes");
    assert.equal(note.author_id, (await memberOf(founder)).id);

    await page.getByRole("button", { name: "Remove this note" }).click();
    await page.getByText("No notes yet.").waitFor();
    await page.getByLabel("Add a note").fill("Second thoughts: a good candidate.");
    await page.getByRole("button", { name: "Save note" }).click();
    await page.locator(".notes li").filter({ hasText: "a good candidate" }).waitFor();
  });
  await check("staff move the application to interview, and the applicant is told", async () => {
    await page.getByRole("button", { name: "Move to interview" }).click();
    await leadIs("At interview.");
    assert.equal((await applicationsOf(kit))[0].stage, "interview");
    await shot("staff-application");

    await signInAs(kit);
    await page.goto(`${site}/apply`);
    await leadIs(/Your application is at interview/);
  });
  await check("an applicant cannot open their own application as staff see it", async () => {
    const [own] = await applicationsOf(kit);
    await page.goto(`${site}/staff/applications/${own.id}`);
    await leadIs(/for the fleet's staff/);
    assert.doesNotMatch(await page.locator("main").innerText(), /a good candidate/);
  });
  await check("accepting makes the applicant a recruit and records who decided", async () => {
    await signInAs(founder);
    await openApplication("Kit Marlow");
    await decide("Accept", "Yes, accept");
    await page.getByText(/Accepted on .* by Ada Vance\. A closed application stays closed\./).waitFor();
    const [decided] = await applicationsOf(kit);
    assert.equal(decided.stage, "accepted");
    assert.equal(decided.decided_by, (await memberOf(founder)).id);
    const member = await memberOf(kit);
    assert.deepEqual({ status: member.status, service: member.service }, { status: "recruit", service: "navy" });
    assert.equal(await page.locator(".decisions").count(), 0, "nothing more to decide");
  });
  await check("the new recruit has a rank, sees the fleet and has nothing left to apply for", async () => {
    await signInAs(kit);
    await headingIs("Starman Recruit Kit Marlow");
    await page.goto(`${site}/apply`);
    await leadIs(/already in the fleet/);
    await page.goto(`${site}/order-of-battle`);
    await page.locator(".tally").waitFor();
    await page.goto(`${site}/staff/applications`);
    await leadIs(/for the fleet's staff/);
  });

  console.log("Refusals");
  await check("an applicant using a serving member's name is accepted only once they change it", async () => {
    await signInAs(jo);
    await setNames("KIT MARLOW", "Jo_Reyes");
    await apply();

    await signInAs(founder);
    await openApplication("KIT MARLOW");
    await decide("Accept", "Yes, accept");
    await page.locator(".form-result").filter({ hasText: "A serving member already has this character name or RSI handle." }).waitFor();
    assert.equal((await applicationsOf(jo))[0].stage, "submitted");
    assert.equal((await memberOf(jo)).status, "applicant");

    await signInAs(jo);
    await setNames("Jo Reyes", "Jo_Reyes");
    await signInAs(founder);
    await openApplication("Jo Reyes");
    await decide("Accept", "Yes, accept");
    await page.getByText(/Accepted on .* by Ada Vance/).waitFor();
    assert.equal((await memberOf(jo)).status, "recruit");
  });
  await check("a declined applicant is told, and may apply again", async () => {
    await signInAs(sam);
    await setNames("Sam Okoro", "Sam_Okoro");
    await apply();

    await signInAs(founder);
    await openApplication("Sam Okoro");
    await decide("Decline", "Yes, decline");
    await page.getByText(/Declined on .* by Ada Vance/).waitFor();
    assert.equal((await memberOf(sam)).status, "applicant");

    await signInAs(sam);
    await page.goto(`${site}/apply`);
    await page.getByRole("button", { name: "Send application" }).waitFor();
    assert.match(await page.locator("main").innerText(), /Your last application was declined on/);
  });
  await check("three applications in 30 days is the limit", async () => {
    await apply();
    await withdraw();
    await apply();
    await page.locator("summary", { hasText: "Withdraw" }).click();
    await page.getByRole("button", { name: "Yes, withdraw it" }).click();
    await leadIs("You have applied three times in 30 days");
    assert.equal(await page.getByRole("button", { name: "Send application" }).count(), 0);
    assert.equal((await applicationsOf(sam)).length, 3);
  });
  await check("closing recruitment takes the form away again", async () => {
    await signInAs(founder);
    await page.goto(`${site}/staff/applications`);
    await page.locator("summary", { hasText: "Close recruitment" }).click();
    await page.getByRole("button", { name: "Yes, close it" }).click();
    await page.getByText("Recruitment is closed.").waitFor();

    await signInAs(lee);
    await setNames("Lee Tanaka", "Lee_Tanaka");
    await page.goto(`${site}/apply`);
    await leadIs(/Recruitment opens on/);
    assert.equal(await page.getByRole("button", { name: "Send application" }).count(), 0);
  });

  console.log("Operations");
  const patrol = () => one("select * from public.events where title = 'Patrol 001'");
  const lineOf = async (person) =>
    one("select * from public.attendance where event_id = $1 and member_id = $2", [(await patrol()).id, (await memberOf(person)).id]);
  const returnOf = async (person) =>
    one("select * from public.attendance_returns where event_id = $1 and member_id = $2", [(await patrol()).id, (await memberOf(person)).id]);
  const post = (title) => page.locator(".post", { has: page.locator(".post-title", { hasText: new RegExp(`^${title}$`) }) });
  const openPatrol = async () => {
    await page.goto(`${site}/operations/${(await patrol()).id}`);
    await headingIs("Patrol 001");
  };
  // An event's page and its editor are tabs of cards. Every tab is on the page, and only the one that is shown
  // can be worked on. Each has its own name, so asking for a tab also waits for the right page to arrive.
  const tabOf = (label) => async (name) => {
    const bar = page.locator(`nav[aria-label="${label}"]:visible`);
    // A tab is found by its own label, since it may carry a note beside it, such as how many tasks are withheld.
    const link = bar.locator("a", { has: page.locator(".subbar-label", { hasText: new RegExp(`^${name}$`) }) });
    if ((await link.getAttribute("aria-current")) !== "page") await link.click();
    await bar.locator('a[aria-current="page"]', { hasText: name }).waitFor();
  };
  const tab = tabOf("Parts of this event");
  const editPart = tabOf("Parts of the editor");
  // Look at every tab of an event in turn, for something that must be on none of them.
  const everyTab = async (look) => {
    const names = (await page.locator('nav[aria-label="Parts of this event"]:visible .subbar-label').allInnerTexts()).map((label) => label.trim());
    for (const name of names) {
      await tab(name);
      await look(name);
    }
  };
  await check("an applicant is not shown operations", async () => {
    await signInAs(sam);
    await page.goto(`${site}/operations`);
    await leadIs(/for the serving fleet/);
    assert.equal(await page.locator(".event").count(), 0);
  });
  await check("command drafts an event, and only the people working on it see the draft", async () => {
    await signInAs(founder);
    await page.goto(`${site}/operations`);
    await headingIs("Operations");
    await page.getByRole("link", { name: "Draft an event" }).click();
    await headingIs("Draft an event");
    await page.getByLabel("Title").waitFor();
    await shot("operation-new");
    await page.getByLabel("Type").selectOption({ label: "Patrol" });
    await page.getByLabel("Title").fill("Patrol 001");
    await page.getByLabel(/^Summary/).fill("The lane between ArcCorp and microTech");
    await page.getByLabel(/^Weapons state/).selectOption({ label: "Weapons tight: identified hostiles only" });
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await headingIs("Patrol 001");
    await page.getByText("This is a draft. Only you, its commander and command can see it.").waitFor();

    const event = await patrol();
    assert.equal(event.state, "draft");
    assert.equal(event.created_by, (await memberOf(founder)).id);
    assert.equal(event.commander_id, (await memberOf(founder)).id, "the form offers the person drafting as commander");

    await signInAs(kit);
    await page.goto(`${site}/operations`);
    await page.getByText("No event has been announced yet.").waitFor();
    await page.goto(`${site}/operations/${event.id}`);
    await headingIs("Nothing heard.");
  });
  await check("the commander writes the orders and announces the event", async () => {
    await signInAs(founder);
    await openPatrol();
    await page.getByRole("link", { name: "Change the details and orders" }).click();
    await editPart("Orders");
    await page.getByLabel("Warning order").fill("Patrol the lane at 1900 UTC.\nCommander: Ada Vance.");
    await page.getByLabel("2 Mission").fill("Task Force Jericho will patrol the lane in order to deter piracy against traders.");
    await page.getByRole("button", { name: "Save the orders" }).click();
    await page.locator(".form-result").filter({ hasText: "Saved." }).waitFor();
    await shot("operation-edit");

    await openPatrol();
    await tab("Orders");
    assert.match(await page.locator(".orders:visible").innerText(), /Commander: Ada Vance\./);
    await tab("Run it");
    await page.locator(".decisions summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
    await page.locator(".form-result").filter({ hasText: "Announced." }).waitFor();
    const event = await patrol();
    assert.equal(event.state, "announced");
    assert.ok(event.announced_at && event.roll_closes_at, "the database stamps the announcement and sets when the roll closes");
    await shot("operation-announced");
  });
  await check("members reply for themselves and can change their minds while the roll is open", async () => {
    await tab("Overview");
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result").filter({ hasText: "You are down as attending." }).waitFor();
    await tab("Roll");
    assert.match(await post("Fleet Commander").innerText(), /Confirmed/i);

    await signInAs(kit);
    await page.goto(`${site}/operations`);
    assert.match(await page.locator(".event", { hasText: "Patrol 001" }).innerText(), /Reply needed/i);
    await shot("operations");
    assert.match(await page.locator(".sequence").innerText(), /The roll closes 24 hours out/);
    await page.getByRole("link", { name: "Patrol 001" }).click();
    await headingIs("Patrol 001");
    await tab("Orders");
    assert.match(await page.locator(".orders:visible").innerText(), /in order to deter piracy/);
    await tab("Overview");
    await page.getByRole("button", { name: "Not attending" }).click();
    await page.locator(".form-result").filter({ hasText: "You are down as not attending." }).waitFor();
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result").filter({ hasText: "You are down as attending." }).waitFor();
    assert.equal((await lineOf(kit)).reply, "attending");
    // A recruit holds no post, so they attend as a spare hand.
    await tab("Roll");
    await page.locator(".names li", { hasText: "Kit Marlow" }).waitFor();
    // Nobody holds the training ship's six entry posts yet, so each is known to be empty.
    assert.equal(await page.getByRole("button", { name: "Stand in" }).count(), 6);

    await signInAs(jo);
    await openPatrol();
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result").filter({ hasText: "You are down as attending." }).waitFor();
  });
  await check("once the roll has closed a reply is fixed, and a spare hand stands in for an empty entry post", async () => {
    // Time cannot be wound on, so the event is moved instead: ten hours to go, announced three days ago.
    await supabase.sql(
      "update public.events set starts_at = now() + interval '10 hours', announced_at = now() - interval '3 days' where title = 'Patrol 001'",
    );
    await signInAs(kit);
    await openPatrol();
    await page.getByText("The roll has closed. You said you are attending.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Not attending" }).count(), 0);

    await tab("Roll");
    await post("Gunner 1").getByRole("button", { name: "Stand in" }).click();
    await tab("Overview");
    await page.getByText("You are standing in as Gunner 1 for the night.").waitFor();
    const line = await lineOf(kit);
    assert.equal(line.stand_in_set_by, (await memberOf(kit)).id);
    await tab("Roll");
    assert.match(await post("Gunner 1").innerText(), /Stand-in: Starman Recruit Kit Marlow/);
    // One post at a time.
    assert.equal(await page.getByRole("button", { name: "Stand in" }).count(), 0);
    await shot("operation-roll");
  });
  await check("whoever runs the event places a stand-in and takes one out", async () => {
    await signInAs(founder);
    await openPatrol();
    await tab("Roll");
    await post("Helmsman").getByLabel("Stand-in for Helmsman").selectOption({ label: "Starman Recruit Jo Reyes" });
    await post("Helmsman").getByRole("button", { name: "Place" }).click();
    await post("Helmsman").getByText("Stand-in: Starman Recruit Jo Reyes").waitFor();
    assert.equal((await lineOf(jo)).stand_in_set_by, (await memberOf(founder)).id);

    await post("Gunner 1").getByRole("button", { name: /Remove/ }).click();
    await post("Gunner 1").getByLabel("Stand-in for Gunner 1").waitFor();
    assert.equal((await lineOf(kit)).stand_in_position_id, null);
    const tally = await page.locator(".tally").innerText();
    assert.match(tally, /Confirmed\s+2/i);
    assert.match(tally, /Spare hands\s+1/i);
  });
  await check("after the start the commander makes the return and files the report, and the event closes", async () => {
    await supabase.sql("update public.events set starts_at = now() - interval '1 hour' where title = 'Patrol 001'");
    await openPatrol();
    await tab("Report");
    await page.getByLabel(/Jo Reyes/).selectOption({ label: "Absent, without notice" });
    await page.getByRole("button", { name: "Make the return and close the event" }).click();
    await page.locator(".form-result").filter({ hasText: "The attendance return is made." }).waitFor();
    assert.equal((await patrol()).state, "done");
    assert.equal((await returnOf(kit)).returned, "present");
    const absent = await returnOf(jo);
    assert.equal(absent.returned, "absent_without_notice");
    assert.equal(absent.returned_by, (await memberOf(founder)).id);

    await page.getByLabel("What happened").fill("Two contacts on the lane. Neither closed.\nNo engagement.");
    await page.getByLabel(/^What to change/).fill("Brief the fallback sooner.");
    await page.getByRole("button", { name: "File the report" }).click();
    await page.locator(".form-result").filter({ hasText: "The after-action report is filed." }).waitFor();
    const report = await one("select * from public.after_action_reports where event_id = $1", [(await patrol()).id]);
    assert.equal(report.author_id, (await memberOf(founder)).id);
    assert.equal(report.what_happened, "Two contacts on the lane. Neither closed.\nNo engagement.");
  });
  await check("the fleet reads the report, each member sees only their own attendance, and nothing more can be changed", async () => {
    await signInAs(kit);
    await page.goto(`${site}/operations`);
    assert.match(await page.locator(".event", { hasText: "Patrol 001" }).innerText(), /Done/i);
    await openPatrol();
    // Kit is told how they were recorded.
    await page.getByText("The operation commander recorded you as present.").waitFor();
    await tab("Report");
    await page.getByRole("heading", { name: "After-action report" }).waitFor();
    assert.match(await page.locator("main").innerText(), /Filed by Lt\. Commander Ada Vance/);
    assert.match(await page.locator("main").innerText(), /Brief the fallback sooner\./);
    await shot("operation-done");
    // On no tab is Kit shown that Jo was marked absent, or offered anything to change.
    await everyTab(async () => {
      assert.doesNotMatch(await page.locator("main").innerText(), /Absent|without notice/i);
      assert.equal(await page.getByRole("button").filter({ hasText: /Attending|Stand in|Place/ }).count(), 0);
    });
  });

  console.log("Admin");
  const adminPages = ["/admin", "/admin/people", "/admin/recruiting", "/admin/operations"];
  // A page left by a link stays in the document, hidden, so every one of these looks only at what is shown.
  const adminTabs = async () =>
    (await page.locator('nav[aria-label="Fleet admin"]:visible a').allInnerTexts()).map((label) => label.trim());
  const adminTab = (name) => page.locator('nav[aria-label="Fleet admin"]:visible').getByRole("link", { name, exact: true });
  // A headline figure, with the line under it.
  const stat = async (label) => {
    const tile = page.locator(".kpis:visible > div", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) });
    return (await tile.locator("dd").innerText()).replace(/\s+/g, " ").trim();
  };
  const chart = (title) => page.locator(".chart:visible", { has: page.getByRole("heading", { name: title, exact: true }) });
  const bar = async (title, label) =>
    (await chart(title).locator("tr", { has: page.locator("th", { hasText: new RegExp(`^${label}$`) }) }).locator(".bars-value").innerText()).trim();
  const record = (name) => page.locator(".data:visible tbody tr", { has: page.locator("th", { hasText: name }) });
  const cells = async (row) => (await row.locator("td").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
  const menuLabels = async () => {
    await page.goto(`${site}/`);
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    const menu = page.locator("dialog.menu[open]");
    await menu.waitFor();
    return (await menu.locator(".menu-column li a").allInnerTexts()).map((label) => label.trim());
  };
  const grant = async (person, role) =>
    supabase.sql("insert into public.member_roles (member_id, role) values ($1, $2)", [(await memberOf(person)).id, role]);

  await check("a visitor is sent to sign in, and nobody without a role is shown a figure", async () => {
    await context.clearCookies();
    for (const path of adminPages) {
      await page.goto(`${site}${path}`);
      assert.equal(new URL(page.url()).pathname, "/sign-in", path);
    }
    // An applicant, and a recruit who serves but holds no role.
    for (const person of [sam, kit]) {
      await signInAs(person);
      for (const path of adminPages) {
        await page.goto(`${site}${path}`);
        await leadIs(/for the people who run the fleet/);
        assert.equal(await page.locator(".kpis:visible, .chart:visible, .data:visible, .attention:visible").count(), 0, path);
        assert.deepEqual(await adminTabs(), [], path);
      }
      assert.ok(!(await menuLabels()).includes("Fleet admin"), "the menu offers the admin pages");
    }
  });
  await check("staff see the fleet's strength, its posts and what needs attention", async () => {
    // One application left waiting for nine days, so there is something to attend to.
    await supabase.sql("update public.fleet_settings set recruitment_open = true");
    await signInAs(lee);
    await apply();
    // The database fixes the day an application was sent, so its rule is set aside for this one change.
    await supabase.sql("alter table public.applications disable trigger applications_guard");
    await supabase.sql("update public.applications set submitted_at = now() - interval '9 days' where member_id = $1", [
      (await memberOf(lee)).id,
    ]);
    await supabase.sql("alter table public.applications enable trigger applications_guard");

    await grant(kit, "staff");
    await signInAs(kit);
    await page.getByRole("link", { name: "Fleet admin" }).click();
    await headingIs("Fleet admin");
    await leadIs(/Stage 1: Cadre\. 3 active, 1 of \d+ open posts filled\./);
    assert.deepEqual(await adminTabs(), ["Overview", "People", "Recruiting"]);

    assert.match(await stat("Active strength"), /^3 /);
    assert.match(await stat("Posts filled"), /^1 of \d+ \d+ vacant, 6 of them entry posts/);
    assert.equal(await stat("Applications open"), "1 1 to read, 0 at interview");
    assert.match(await stat("Recruitment"), /^Open/);
    // Operations and attendance are for command.
    assert.equal(await page.locator(".kpis:visible dt", { hasText: /turnout|Events/ }).count(), 0);

    const waiting = page.locator(".attention:visible li");
    assert.equal(await waiting.count(), 1);
    assert.match(await waiting.innerText(), /Lee Tanaka's application has waited 9 days\s+Not read yet\./);
    const [application] = await applicationsOf(lee);
    assert.equal(await waiting.getByRole("link").getAttribute("href"), `/staff/applications/${application.id}`);

    const meter = page.getByRole("meter");
    assert.equal(await meter.getAttribute("aria-valuenow"), "3");
    assert.equal(await meter.getAttribute("aria-valuemax"), "8");
    assert.match(await chart("Towards stage 2: Ship's company").innerText(), /3\s+of the 8 active that stage 2 needs/);
    assert.equal(await bar("Everyone on the books", "Recruit"), "2");
    assert.equal(await bar("Everyone on the books", "Applicant"), "2");
    assert.deepEqual(await cells(record("Cadre")), ["1", "1 to 7", "The fleet is here"]);
    assert.deepEqual(await cells(record("Ship's company")), ["2", "8 to 15", "5 more active"]);
    assert.match(await chart("By unit").innerText(), /1 of \d+/);
    await shot("admin-overview");
  });
  await check("staff see everyone on the books and can narrow the list, without attendance", async () => {
    await adminTab("People").click();
    await headingIs("People");
    await page.locator(".data-people:visible").waitFor();
    assert.equal(await stat("Recruits"), "2 In training");
    assert.equal(await bar("By service", "Navy"), "3");
    assert.match(await chart("Qualifications held").innerText(), /No qualification has been awarded yet\./);
    assert.match(await chart("Joined, month by month").innerText(), /2/);

    const rows = page.locator(".data-people:visible tbody tr");
    assert.equal(await rows.count(), 5);
    const mine = await record("Starman Recruit Kit Marlow").innerText();
    assert.match(mine, /Kit_Marlow · kit_on_discord/);
    assert.match(mine, /Recruit\s+Navy · E1 · Staff/);
    assert.equal(await page.locator(".data-people:visible thead th", { hasText: /Events|Absent|Last attended/ }).count(), 0);

    await page.getByLabel("Status").selectOption({ label: "Applicant" });
    assert.equal(await rows.count(), 2);
    assert.match(await page.locator(".filters-count:visible").innerText(), /2 of 5 people/);
    await page.getByLabel("Find").fill("tanaka");
    assert.equal(await rows.count(), 1);
    await page.getByLabel("Find").fill("nobody at all");
    await page.getByText("Nobody matches.").waitFor();
    await page.getByLabel("Find").fill("");
    await page.getByLabel("Status").selectOption({ label: "Everyone" });
    await shot("admin-people");
  });
  await check("staff see how recruiting is going, and are not shown operations", async () => {
    await adminTab("Recruiting").click();
    await headingIs("Recruiting");
    await leadIs(/Recruitment is open\. 1 application is waiting to be read and 0 are at interview\./);
    assert.equal(await stat("Applications"), "7 From 4 people, 2 of them more than once");
    assert.match(await stat("Acceptance rate"), /^67% /);
    assert.match(await stat("Time to decide"), /^Under a day /);
    assert.equal(await bar("How far applications get", "Applied"), "7");
    assert.equal(await bar("How far applications get", "Reached interview or a decision"), "3");
    assert.equal(await bar("How far applications get", "Accepted"), "2");
    assert.equal(await bar("Where they stand now", "Withdrawn"), "3");
    assert.equal(await bar("Service asked for", "Navy"), "7");
    // Six sent this week and one nine days ago.
    const weeks = await chart("Applications sent, week by week").locator("li .visually-hidden").allInnerTexts();
    assert.equal(weeks.length, 8);
    assert.match(weeks.at(-1), /: 6 applications$/);
    assert.equal(weeks.filter((week) => /: 1 application$/.test(week)).length, 1);
    assert.deepEqual((await cells(record("Lee Tanaka"))).slice(0, 1), ["Waiting to be read"]);
    assert.match((await cells(record("Lee Tanaka"))).at(-1), /^9 ?A week or more$/);
    await shot("admin-recruiting");

    await page.goto(`${site}/admin/operations`);
    await leadIs(/This page is for command\./);
    assert.equal(await page.locator(".kpis:visible, .chart:visible, .data:visible").count(), 0);
    assert.deepEqual(await adminTabs(), ["Overview", "People", "Recruiting"]);
  });
  await check("command also sees operations and attendance", async () => {
    await grant(jo, "command");
    await signInAs(jo);
    assert.ok((await menuLabels()).includes("Fleet admin"), "the menu does not offer the admin pages");
    await page.goto(`${site}/admin`);
    await leadIs(/Stage 1: Cadre\. 3 active/);
    assert.deepEqual(await adminTabs(), ["Overview", "People", "Recruiting", "Operations"]);
    assert.equal(await stat("Events in 30 days"), "1 0 coming up");
    assert.match(await stat("Average turnout"), /^67% /);

    await adminTab("Operations").click();
    await leadIs(/1 event held, 0 coming up and 0 in draft\./);
    assert.equal(await stat("Events held"), "1 1 in the last 30 days");
    assert.match(await stat("Reports on time"), /^1 of 1 /);
    assert.equal(await bar("By type", "Patrol"), "1");
    // Three said attending, one of them a stand-in. Two were present and one absent without notice.
    assert.deepEqual((await cells(record("Patrol 001"))).slice(1), ["Done", "3", "1", "2", "0", "1", "On time"]);
    assert.match(await record("Patrol 001").innerText(), /Patrol · Ada Vance/);
    assert.deepEqual((await cells(record("Jo Reyes"))).slice(0, 5), ["0", "0", "0", "1", "1"]);
    assert.deepEqual((await cells(record("Kit Marlow"))).slice(0, 5), ["1", "1", "1", "0", "0"]);
    await shot("admin-operations");

    await page.goto(`${site}/admin/people`);
    await page.locator(".data-people:visible").waitFor();
    assert.equal(await page.locator(".data-people:visible thead th", { hasText: "Events, 30 days" }).count(), 1);
    assert.deepEqual((await cells(record("Jo Reyes"))).slice(4, 8), ["0", "0", "0", "1"]);
  });

  console.log("Logs");
  const logText = async () => (await page.locator(".log:visible").allInnerTexts()).join("\n");
  // What to show is a row of links. Who and when are a plain form: choosing and pressing Apply loads the page again at a new address.
  const showLog = async ({ Show, ...rest }, address) => {
    if (Show) {
      const shows = page.locator('nav[aria-label="Show"]:visible');
      await shows.getByRole("link", { name: Show, exact: true }).click();
      // The link is marked as the one in use once the lines it asks for have arrived.
      await shows.locator("a[aria-current]", { hasText: Show }).waitFor();
    }
    if (Object.keys(rest).length > 0) {
      const filters = page.locator(".filters:visible");
      for (const [label, option] of Object.entries(rest)) await filters.getByLabel(label).selectOption({ label: option });
      await filters.getByRole("button", { name: "Apply" }).click();
    }
    await page.waitForURL(address);
    await page.locator('nav[aria-label="Show"]:visible').waitFor();
  };
  await check("the logs are for admins, and nobody else is shown a line", async () => {
    // Staff, then command. Both are left signed in by the checks above.
    for (const person of [kit, jo]) {
      await signInAs(person);
      await page.goto(`${site}/admin/logs`);
      await leadIs(/This page is for admins\./);
      assert.equal(await page.locator(".log:visible, .filters:visible, .log-shows:visible").count(), 0);
      assert.ok(!(await adminTabs()).includes("Logs"));
    }
    await page.goto(`${site}/profile`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${site}/`);
  });
  await check("an admin reads who signed in and out", async () => {
    // Lines from two days ago, so there is more than one page and something outside the last 24 hours.
    await supabase.sql(
      `insert into public.activity_log (actor, kind, at)
       select $1, 'sign_out', now() - interval '2 days' - n * interval '1 minute' from generate_series(1, 120) as n`,
      [(await memberOf(lee)).id],
    );
    await signInAs(founder);
    await page.goto(`${site}/admin`);
    await leadIs(/Stage 1: Cadre/);
    assert.deepEqual(await adminTabs(), ["Overview", "People", "Recruiting", "Operations", "Structure", "Logs"]);
    await adminTab("Logs").click();
    await headingIs("Logs");
    await page.locator(".log:visible").first().waitFor();

    await showLog({ Show: "Sign-ins and sign-outs", When: "The last 24 hours" }, /show=sign-ins/);
    const text = await logText();
    assert.match(text, /Ada Vance signed in\./);
    assert.match(text, /Jo Reyes signed out\./);
    assert.doesNotMatch(text, /Lee Tanaka signed out/, "a line from two days ago is in the last 24 hours");
    assert.doesNotMatch(text, /applied|status|Patrol/);
    // Each line names its type beside the type's picture, so the colour is never the only sign.
    const first = page.locator(".log-line:visible").first();
    assert.match(await first.innerText(), /^Sign-in\s+\d\d:\d\d:\d\d UTC\s+Ada Vance signed in\.$/i);
    assert.match(await first.getAttribute("class"), /log-kind-sign-ins/);
    assert.ok((await first.locator(".log-tile svg > *").count()) > 0, "a line's type has no picture");
  });
  await check("personnel actions read as sentences, and can be narrowed to one member", async () => {
    await showLog({ Show: "Personnel actions", Who: "Kit Marlow", When: "All time" }, /show=personnel/);
    const text = await logText();
    assert.match(text, /Ada Vance changed Kit Marlow's status from Applicant to Recruit, in the Navy\./);
    assert.match(text, /The database gave Kit Marlow the Staff role\./);
    assert.doesNotMatch(text, /Jo Reyes|Sam Okoro|signed in|applied/);
    await shot("admin-logs-personnel");
  });
  await check("what was refused is kept, with what the person was told", async () => {
    await showLog({ Show: "Refused and failed", Who: "Anyone" }, /show=refused/);
    const refused = page.locator(".log-refused:visible", { hasText: "Ada Vance was refused: tried to move an application on." });
    assert.match(await refused.first().innerText(), /Told: "A serving member already has this character name or RSI handle\. /);
    // Reaching a page that no link offered is a refusal too: staff tried the logs, and a recruit tried the staff pages.
    const text = await logText();
    assert.match(text, /Kit Marlow was refused: tried to open an admin page\.\s+Told: "\/admin\/logs is for admins\."/);
    assert.match(text, /Jo Reyes was refused: tried to open an admin page\./);
    assert.match(text, /Kit Marlow was refused: tried to open a staff page\.\s+Told: "The applications are for the fleet's staff\."/);
    const stored = await supabase.sql("select kind, action, shown from public.activity_log where kind in ('refused', 'failed') order by id");
    assert.ok(stored.length >= 1);
    assert.ok(stored.every((line) => line.action && line.shown), "a refusal says what was tried and what was said");
  });
  await check("every kind of line is in one list, a page at a time", async () => {
    await showLog({ Show: "Everything" }, (url) => !url.searchParams.has("show"));
    const latest = await logText();
    assert.match(latest, /Ada Vance signed in\./);
    assert.match(latest, /The database gave Jo Reyes the Command role\./);
    assert.match(latest, /Lee Tanaka applied to join the Navy\./);
    assert.match(latest, /Ada Vance filed the after-action report for Patrol 001\./);
    assert.match(latest, /Ada Vance recorded Jo Reyes as absent, without notice at Patrol 001\./);
    assert.match(latest, /Ada Vance closed Patrol 001\./);
    assert.equal(await page.locator(".log-line:visible").count(), 100);
    await shot("admin-logs");

    // The page before stays on screen until the next has been read, so wait for its first line to change.
    const firstLine = () => page.locator(".log-line:visible").first().innerText();
    const goOlder = async () => {
      const was = await firstLine();
      await page.getByRole("link", { name: "Older lines" }).click();
      for (let tries = 0; tries < 100; tries += 1) {
        if ((await page.locator(".log-line:visible").count()) > 0 && (await firstLine()) !== was) return;
        await page.waitForTimeout(100);
      }
      throw new Error("The older lines never came.");
    };
    await goOlder();
    await page.getByRole("heading", { name: "Older lines" }).waitFor();
    const seen = [latest, await logText()];
    assert.doesNotMatch(seen[1], /Ada Vance filed the after-action report/, "a line is on two pages");
    // Keep going back to the end of the log.
    for (let pages = 0; pages < 8 && (await page.getByRole("link", { name: "Older lines" }).count()) > 0; pages += 1) {
      await goOlder();
      seen.push(await logText());
    }
    // Every line is on exactly one page, back to the first thing that ever happened.
    const everything = seen.join("\n");
    assert.equal(everything.match(/Ada Vance signed in for the first time, and a record was made\./g)?.length, 1);
    assert.equal(everything.match(/Lee Tanaka signed out\./g)?.length, 120);
    assert.equal(everything.match(/Ada Vance closed Patrol 001\./g)?.length, 1);
    await page.getByRole("link", { name: "Back to the latest" }).click();
    await page.getByRole("heading", { name: "The latest lines" }).waitFor();
  });
  await check("the visitors view counts public pages by the day, and nothing about who read them", async () => {
    await showLog({ Show: "Visitors" }, /show=visitors/);
    await page.getByRole("heading", { name: "Visitors", exact: true }).waitFor();
    const pages = await chart("Pages read in the last 30 days").innerText();
    assert.match(pages, /\/ranks/);
    assert.match(pages, /\/roles/);
    assert.match(pages, /\/manual/);
    const read = await chart("Pages read in the last 30 days").locator("tbody th").allInnerTexts();
    assert.deepEqual(
      read.filter((path) => /^\/(profile|admin|operations|staff|apply|order-of-battle|visit|auth)(\/|$)/.test(path.trim())),
      [],
      "a member's page was counted",
    );
    assert.match(await stat("Page views today"), /^\d+ \d+ visits$/);
    assert.match(await chart("Page views, day by day").locator("li .visually-hidden").last().innerText(), /: \d+ page views?$/);
    await shot("admin-visitors");

    const totals = await supabase.sql("select path, views, landings from public.page_views");
    assert.ok(totals.find((row) => row.path === "/ranks").views >= 1);
    assert.ok(totals.every((row) => row.landings <= row.views));
    assert.deepEqual(await supabase.sql("select * from public.page_view_ticks"), [], "a row was kept for a page view");
  });

  console.log("Structure");
  // One record in an editor, by its title, opened.
  const openRecord = async (title) => {
    const record = page.locator("details.record:visible", {
      has: page.locator("summary strong", { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
    });
    if ((await record.getAttribute("open")) === null) await record.locator("summary").first().click();
    return record;
  };
  const addRecord = async (fill) => {
    const adding = page.locator("details.record-new:visible");
    if ((await adding.getAttribute("open")) === null) await adding.locator("summary").click();
    await fill(adding);
    await adding.getByRole("button", { name: /^Add the / }).click();
    return adding;
  };
  // Wait for a form to say something. If it says something else, the failure shows what.
  const told = async (within, text) => {
    try {
      await within.locator(".form-result").filter({ hasText: text }).first().waitFor({ timeout: 10_000 });
    } catch {
      const said = (await within.locator(".form-result").allInnerTexts()).filter(Boolean);
      throw new Error(`Expected a form to say ${text}. It said: ${JSON.stringify(said)}`);
    }
  };
  const openEditor = async (name) => {
    await page.goto(`${site}/admin/structure`);
    await headingIs("Structure");
    await page.locator(".role-card:visible").getByRole("link", { name, exact: true }).click();
    await headingIs(name);
    await page.locator("details.record-new:visible").waitFor();
  };
  const roleRow = (slug) => one("select * from public.fleet_roles where slug = $1", [slug]);

  await check("the editors are for admins", async () => {
    await signInAs(jo);
    for (const path of ["/admin/structure", "/admin/structure/roles", "/admin/structure/posts", "/admin/structure/ranks"]) {
      await page.goto(`${site}${path}`);
      await leadIs(/This page is for admins\./);
      assert.equal(await page.locator("details.record:visible, form:visible").count(), 0, path);
    }
    await signInAs(founder);
    await page.goto(`${site}/admin/structure`);
    await headingIs("Structure");
    const cards = await page.locator(".role-cards:visible").innerText();
    assert.match(cards, /15\s+Areas/);
    assert.match(cards, /30\s+Roles/);
    assert.match(cards, /14\s+Units/);
    assert.match(cards, /52\s+Posts/);
    assert.match(cards, /6\s+Qualifications/);
    assert.match(cards, /5\s+Event types/);
    assert.match(cards, /18 grades\s+Ranks and grades/i);
    await shot("structure");
  });
  await check("an admin rewrites a role, and its page follows", async () => {
    await openEditor("Roles");
    assert.equal(await page.locator("details.record:visible:not(.record-new)").count(), 30);
    const gunner = await openRecord("Gunner");
    await gunner.getByLabel("Summary").fill("Fights a ship's guns.");
    await gunner.getByLabel("What the role does").fill("Keep the turret ready to fire.\nCall targets to the Gunnery Chief.\n");
    await gunner.getByRole("button", { name: "Save", exact: true }).click();
    await told(gunner, "Saved.");
    const stored = await roleRow("gunner");
    assert.equal(stored.summary, "Fights a ship's guns.");
    assert.equal(stored.duties, "Keep the turret ready to fire.\nCall targets to the Gunnery Chief.");
    await shot("structure-roles");

    // Saving again changes nothing, and writes no line to the log.
    const before = await one("select count(*)::int as lines from public.audit_log where table_name = 'fleet_roles'");
    await gunner.getByRole("button", { name: "Save", exact: true }).click();
    await told(gunner, "Nothing was changed.");
    assert.deepEqual(await one("select count(*)::int as lines from public.audit_log where table_name = 'fleet_roles'"), before);

    await page.goto(`${site}/roles/gunnery/gunner`);
    await headingIs("Gunner");
    await leadIs("Fights a ship's guns.");
    assert.deepEqual(await page.locator(".duties:visible li").allInnerTexts(), ["Keep the turret ready to fire.", "Call targets to the Gunnery Chief."]);
  });
  await check("a save that is turned down says why, keeps what was typed, and is logged", async () => {
    await openEditor("Roles");
    const gunner = await openRecord("Gunner");
    await gunner.getByLabel("Address").fill("Bad Address");
    await gunner.getByLabel("Summary").fill("Half-written.");
    await gunner.getByRole("button", { name: "Save", exact: true }).click();
    await told(gunner, /lower-case letters and numbers/);
    assert.equal(await gunner.getByLabel("Address").inputValue(), "Bad Address");
    assert.equal(await gunner.getByLabel("Summary").inputValue(), "Half-written.");
    assert.equal((await roleRow("gunner")).summary, "Fights a ship's guns.", "a refused save changed the role");

    // The database's own rule: a role keeps its kind while it has posts.
    await gunner.getByLabel("Address").fill("gunner");
    await gunner.getByLabel("Summary").fill("Fights a ship's guns.");
    await gunner.getByLabel("Kind").selectOption({ label: "Secondary duty: held as well as a post" });
    await gunner.getByRole("button", { name: "Save", exact: true }).click();
    await told(gunner, "This role has positions. Move them to another role before changing its kind.");
    assert.equal((await roleRow("gunner")).kind, "primary");
    const logged = await one("select kind, action, shown from public.activity_log order by id desc limit 1");
    assert.deepEqual(logged, {
      kind: "refused",
      action: "structure.save",
      shown: "This role has positions. Move them to another role before changing its kind.",
    });

    // A role that still has posts cannot be removed.
    await gunner.locator("summary", { hasText: "Remove this role" }).click();
    await gunner.getByRole("button", { name: "Yes, remove it" }).click();
    await told(gunner, "This role still has posts. Move them to another role first.");
    assert.ok(await roleRow("gunner"));
  });
  await check("what a role needs is set in the editor, for every ship at once", async () => {
    await openEditor("Roles");
    const gunner = await openRecord("Gunner");
    const need = gunner.locator(".record-needs li", { hasText: "Net controller" });
    await need.getByRole("checkbox").first().check();
    await gunner.getByRole("button", { name: "Save what it needs" }).click();
    await told(gunner.locator(".record-needs"), "Saved.");
    const needs = await supabase.sql(
      `select q.code, n.waived_when_acting from public.fleet_role_qualifications n
       join public.qualifications q on q.id = n.qualification_id where n.role_id = $1`,
      [(await roleRow("gunner")).id],
    );
    assert.deepEqual(needs, [{ code: "net-controller", waived_when_acting: false }]);

    await page.goto(`${site}/roles/gunnery/gunner`);
    await headingIs("Gunner");
    assert.match(await page.locator(".facts:visible").innerText(), /Needs\s+Net controller\s*Some posts need more/i);
    assert.match(await page.locator(".cards:visible").innerText(), /Net controller[\s\S]*Every Gunner needs this/i);

    // Taking it away again.
    await openEditor("Roles");
    const again = await openRecord("Gunner");
    await again.locator(".record-needs li", { hasText: "Net controller" }).getByRole("checkbox").first().uncheck();
    await again.getByRole("button", { name: "Save what it needs" }).click();
    await told(again.locator(".record-needs"), "Saved.");
    assert.deepEqual(await supabase.sql("select 1 from public.fleet_role_qualifications where role_id = $1", [(await roleRow("gunner")).id]), []);
  });
  await check("an admin adds an area, a role and a post, and the site shows them", async () => {
    await openEditor("Areas");
    const area = await addRecord(async (form) => {
      await form.getByLabel("Name").fill("Sensors");
      await form.getByLabel("Address").fill("sensors");
      await form.getByLabel("Group").selectOption({ label: "Ship" });
      await form.getByLabel("Picture").selectOption({ label: "Spare" });
      await form.getByLabel("About").fill("The ship's sensor stations.");
      await form.getByLabel("What to read").fill("organisation/navy-squadron\n/manual/command/orders");
    });
    await told(area, "Added.");
    await page.locator("details.record:visible summary strong", { hasText: /^Sensors$/ }).waitFor();

    await openEditor("Roles");
    const role = await addRecord(async (form) => {
      await form.getByLabel("Name").fill("Sensors Operator");
      await form.getByLabel("Address").fill("sensors-operator");
      await form.getByLabel("Area").selectOption({ label: "Sensors" });
      await form.getByLabel("Kind").selectOption({ label: "Primary role: its post sets the holder's rank" });
      await form.getByLabel("Summary").fill("Finds what the ship cannot see.");
    });
    await told(role, "Added.");

    await openEditor("Posts");
    assert.equal(await page.locator("details.record:visible:not(.record-new)").count(), 52);
    // A primary post needs its grades.
    const post = await addRecord(async (form) => {
      await form.getByLabel("Title").fill("Sensors Operator 1");
      await form.getByLabel("Unit").selectOption({ label: "Task Force Jericho › UEES Nexus › Bridge" });
      await form.getByLabel("Role").selectOption({ label: "Sensors Operator" });
      await form.getByLabel("Opens at stage").fill("2");
    });
    await told(post, "A primary post needs its usual, lowest and highest grades.");
    assert.equal(await post.getByLabel("Title").inputValue(), "Sensors Operator 1", "the form lost what was typed");
    await post.getByLabel("Usual grade").selectOption({ label: "E4" });
    await post.getByLabel("Lowest grade").selectOption({ label: "E3" });
    await post.getByLabel("Highest grade").selectOption({ label: "E5" });
    await post.getByRole("button", { name: "Add the post" }).click();
    await told(post, "Added.");
    const stored = await one(
      `select p.kind, p.nominal_grade, p.min_grade, p.max_grade, p.is_entry, p.opens_at_stage, r.slug as role, u.name as unit
       from public.positions p join public.fleet_roles r on r.id = p.role_id join public.units u on u.id = p.unit_id
       where p.title = 'Sensors Operator 1'`,
    );
    assert.deepEqual(stored, {
      kind: "primary",
      nominal_grade: "E4",
      min_grade: "E3",
      max_grade: "E5",
      is_entry: false,
      opens_at_stage: 2,
      role: "sensors-operator",
      unit: "Bridge",
    });
    await shot("structure-posts");

    // The roles pages follow, for anyone.
    await page.goto(`${site}/roles`);
    await page.locator(".tile").first().waitFor();
    assert.equal(await page.locator(".tile").count(), 16);
    await page.goto(`${site}/roles/sensors/sensors-operator`);
    await headingIs("Sensors Operator");
    await leadIs("Finds what the ship cannot see.");
    assert.match(await page.locator(".places:visible").innerText(), /UEES Nexus[\s\S]*E3 to E5/);
    assert.deepEqual(await page.locator(".reading:visible a").allInnerTexts().then((links) => links.slice(0, 2)), ["Navy squadron", "Orders"]);
    // And the order of battle lists the new post.
    await page.goto(`${site}/order-of-battle`);
    await page.locator(".tally").waitFor();
    // It opens at stage 2, so it is listed with the posts that open later, folded away.
    assert.match(await page.locator("main").textContent(), /Sensors Operator 1/);
  });
  await check("a post, a role and an area with nothing hanging from them can be removed", async () => {
    for (const [editor, title, thing] of [
      ["Posts", "Sensors Operator 1", "post"],
      ["Roles", "Sensors Operator", "role"],
      ["Areas", "Sensors", "area"],
    ]) {
      await openEditor(editor);
      const record = await openRecord(title);
      await record.locator("summary", { hasText: `Remove this ${thing}` }).click();
      await record.getByRole("button", { name: "Yes, remove it" }).click();
      await page.locator("details.record:visible summary strong", { hasText: new RegExp(`^${title}$`) }).waitFor({ state: "detached" });
    }
    assert.deepEqual(await supabase.sql("select 1 from public.areas where slug = 'sensors'"), []);
    assert.deepEqual(await supabase.sql("select 1 from public.positions where title = 'Sensors Operator 1'"), []);
    // A post that someone holds is part of the service record.
    await openEditor("Posts");
    const held = await openRecord("Fleet Commander");
    await held.locator("summary", { hasText: "Remove this post" }).click();
    await held.getByRole("button", { name: "Yes, remove it" }).click();
    await told(held, /Someone holds or has held this post/);
  });
  await check("an admin renames a rank, and the ranks page follows", async () => {
    await page.goto(`${site}/admin/structure/ranks`);
    await headingIs("Ranks and grades");
    const grade = page.locator("details.record:visible", { has: page.locator("summary strong", { hasText: /^E2$/ }) });
    await grade.locator("summary").click();
    await grade.getByLabel("Navy rank").fill("Able Starman");
    await grade.getByLabel("What a member at this grade usually does").fill("Crew member");
    await grade.getByRole("button", { name: "Save", exact: true }).click();
    await told(grade, "Saved.");
    assert.equal((await one("select name from public.ranks where service = 'navy' and grade_code = 'E2'")).name, "Able Starman");

    await context.clearCookies();
    await page.goto(`${site}/ranks`);
    await page.getByRole("heading", { name: "Able Starman" }).waitFor();
  });
  await check("every change to the structure is in the logs, with who made it", async () => {
    await signInAs(founder);
    await page.goto(`${site}/admin/logs?show=structure`);
    await page.locator(".log:visible").first().waitFor();
    const text = await logText();
    assert.match(text, /Ada Vance renamed the Navy rank for E2 from Starman to Able Starman\./);
    assert.match(text, /Ada Vance removed the area Sensors\./);
    assert.match(text, /Ada Vance added the post Sensors Operator 1, Bridge\./);
    assert.match(text, /Ada Vance added the role Sensors Operator\./);
    assert.match(text, /Ada Vance made the Net controller qualification a need of every Gunner\./);
    assert.match(text, /Ada Vance stopped every Gunner needing the Net controller qualification\./);
    assert.match(text, /Ada Vance changed the role Gunner\.\s+duties changed\. summary changed\./);
    await shot("admin-logs-structure");
  });

  console.log("Event types");
  const typeRow = (key) => one("select * from public.event_types where key = $1", [key]);
  const eventTitled = (title) => one("select * from public.events where title = $1", [title]);
  const ordersOf = async (title) => one("select * from public.event_orders where event_id = $1", [(await eventTitled(title)).id]);
  const typeOptions = async () => (await page.getByLabel("Type").locator("option").allInnerTexts()).map((text) => text.trim());
  // The event form fills in a type's usual length when the type is chosen, which it can only do once the page's script runs.
  const eventFormReady = async () => {
    await page.locator("#title:visible").waitFor();
    await page.waitForFunction(() => {
      const list = document.querySelector("select#kind");
      return list !== null && Object.keys(list).some((key) => key.startsWith("__reactProps"));
    });
  };
  const openEvent = async (title) => {
    await page.goto(`${site}/operations/${(await eventTitled(title)).id}`);
    await headingIs(title);
  };

  await check("the types of event are records an admin edits, and a type names its own order sections", async () => {
    await signInAs(founder);
    await openEditor("Event types");
    assert.equal(await page.locator("details.record:visible:not(.record-new)").count(), 5);
    const training = await openRecord("Training evolution");
    assert.match(await training.locator("summary").first().innerText(), /Drafted by command and instructors/);
    assert.equal(await training.getByLabel("Code").count(), 0, "a type's code is set once, when it is added");
    await training.getByLabel("Usual length, in minutes").fill("90");
    await training.getByLabel("Usual weapons state").selectOption({ label: "Weapons hold: self-defence only" });
    await training.getByLabel("Section 2 is called").fill("2 Aim");
    await training.getByLabel("What section 2 holds").fill("What everyone will be able to do by the end.");
    await training.getByRole("button", { name: "Save", exact: true }).click();
    await told(training, "Saved.");
    const stored = await typeRow("training");
    assert.equal(stored.default_duration_minutes, 90);
    assert.equal(stored.default_weapons_state, "hold");
    assert.equal(stored.mission_name, "2 Aim");
    assert.equal(stored.situation_name, "", "a section left alone keeps Volume 2's name");
    await shot("structure-event-types");
  });
  await check("an admin adds a type of the fleet's own, and a name already taken is refused", async () => {
    const adding = await addRecord(async (form) => {
      await form.getByLabel("Name").fill("Patrol");
      await form.getByLabel("Code").fill("boarding-drill");
      await form.getByLabel("Usually run by").fill("Marine detachment");
      await form.getByLabel("Such as").fill("Clearing a Caterpillar deck by deck.");
      await form.getByLabel("Instructors may draft it, as well as command").check();
      assert.equal(await form.getByLabel("Usual length, in minutes").inputValue(), "120", "a new type starts at two hours");
      await form.getByLabel("Place in the list").fill("6");
    });
    await told(adding, "Another event type already has that name or code.");
    assert.equal(await adding.getByLabel("Code").inputValue(), "boarding-drill", "the form lost what was typed");
    assert.equal(await adding.getByLabel("Instructors may draft it, as well as command").isChecked(), true);
    await adding.getByLabel("Name").fill("Boarding drill");
    await adding.getByRole("button", { name: "Add the event type" }).click();
    await told(adding, "Added.");
    const stored = await typeRow("boarding-drill");
    assert.equal(stored.name, "Boarding drill");
    assert.equal(stored.instructors_may_draft, true);
    assert.equal(stored.run_by, "Marine detachment");
    assert.equal(stored.default_weapons_state, null);
  });
  await check("someone who may draft nothing is offered no form and no copy", async () => {
    // Kit is staff, and staff do not draft events.
    await signInAs(kit);
    await page.goto(`${site}/operations/new`);
    await leadIs(/instructors draft the types open to them/);
    assert.equal(await page.getByLabel("Title").count(), 0);
    await openPatrol();
    assert.equal(await page.getByRole("button", { name: "Draft another like this" }).count(), 0);
  });
  await check("an instructor is offered the types open to instructors, each with its usual length and weapons state", async () => {
    await grant(kit, "instructor");
    await signInAs(kit);
    await page.goto(`${site}/operations/new`);
    await eventFormReady();
    assert.deepEqual(await typeOptions(), ["Training evolution", "Boarding drill"]);
    assert.equal(await page.getByLabel("Minutes").inputValue(), "90");
    assert.equal(await page.getByLabel(/^Weapons state/).inputValue(), "hold");
    await page.getByLabel("Type").selectOption({ label: "Boarding drill" });
    await page.getByText("Usually run by: Marine detachment. Such as: Clearing a Caterpillar deck by deck.").waitFor();
    assert.equal(await page.getByLabel("Minutes").inputValue(), "120");
    assert.equal(await page.getByLabel(/^Weapons state/).inputValue(), "");
    await page.getByLabel("Type").selectOption({ label: "Training evolution" });
    await page.getByText("Usually run by: Training team.").waitFor();
    assert.equal(await page.getByLabel("Minutes").inputValue(), "90");
    await shot("operation-new-type");

    // A save that is turned down says why and keeps what was typed.
    await page.getByLabel("Title").fill("Training Night 001");
    await page.getByLabel("Repeats weekly").check();
    await page.getByLabel(/^Second-in-command/).selectOption({ label: "Starman Recruit Kit Marlow" });
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "The second-in-command is someone other than the commander." }).waitFor();
    assert.equal(await page.getByLabel("Title").inputValue(), "Training Night 001", "the form lost what was typed");
    assert.equal(await page.getByLabel("Repeats weekly").isChecked(), true);
    assert.equal(await page.getByLabel("Minutes").inputValue(), "90");
    await page.getByLabel(/^Second-in-command/).selectOption({ label: "Not named yet" });
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await headingIs("Training Night 001");

    const event = await eventTitled("Training Night 001");
    assert.equal(event.kind, "training");
    assert.equal(event.duration_minutes, 90);
    assert.equal(event.weapons_state, "hold");
    assert.equal(event.repeats_weekly, true);
    assert.equal(event.created_by, (await memberOf(kit)).id);
    const chips = await page.locator(".page-head:visible .chips").innerText();
    assert.match(chips, /Training evolution/i);
    assert.match(chips, /Weapons hold/i);
    assert.match(chips, /Weekly/i);
    // The event's page uses the type's own name for the section, and its own guidance.
    await tab("Orders");
    assert.match(await page.locator(".orders:visible").innerText(), /2 Aim\s+Not written yet\. What everyone will be able to do by the end\./i);
    assert.match(await page.locator(".orders:visible").innerText(), /1 Situation/i);
  });
  await check("the orders are written under the type's own headings", async () => {
    await page.getByRole("link", { name: "Change the details and orders" }).click();
    await eventFormReady();
    assert.equal(await page.getByLabel("Repeats weekly").isChecked(), true);
    await editPart("Orders");
    await page.getByLabel("2 Aim").fill("Every gunner hits a moving target from the dorsal turret.");
    await page.getByLabel("1 Situation").waitFor();
    await page.getByRole("button", { name: "Save the orders" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Saved." }).waitFor();
    assert.equal((await ordersOf("Training Night 001")).mission, "Every gunner hits a moving target from the dorsal turret.");
  });
  await check("closing a weekly event drafts next week's, with its details and orders, and announces nothing", async () => {
    const first = await eventTitled("Training Night 001");
    await openEvent("Training Night 001");
    await tab("Run it");
    await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();
    assert.deepEqual(await supabase.sql("select 1 from public.events where copied_from = $1", [first.id]), [], "announcing drafts nothing");

    await supabase.sql("update public.events set starts_at = now() - interval '1 hour' where id = $1", [first.id]);
    await openEvent("Training Night 001");
    await tab("Report");
    await page.getByRole("button", { name: "Make the return and close the event" }).click();
    const said = page.locator(".form-result:visible").filter({ hasText: "The attendance return is made." });
    await said.waitFor();
    await shot("operation-weekly-closed");
    await said.getByRole("link", { name: "Next week's is drafted: Training Night 002" }).click();
    await headingIs("Training Night 002");

    const next = await eventTitled("Training Night 002");
    assert.equal(next.state, "draft");
    assert.equal(next.announced_at, null);
    assert.equal(next.copied_from, first.id);
    assert.equal(next.repeats_weekly, true);
    assert.equal(next.duration_minutes, 90);
    assert.equal(next.created_by, (await memberOf(kit)).id, "whoever closed the last one drafted the next");
    const gap = await one(
      "select (n.starts_at - e.starts_at) = interval '7 days' as a_week from public.events e, public.events n where e.id = $1 and n.id = $2",
      [first.id, next.id],
    );
    assert.equal(gap.a_week, true);
    const facts = await page.locator(".facts:visible").innerText();
    assert.match(facts, /Repeats\s+Weekly/i);
    assert.match(facts, /Copied from\s+Training Night 001/i);
    await tab("Orders");
    assert.match(await page.locator(".orders:visible").innerText(), /Every gunner hits a moving target from the dorsal turret\./);
    await shot("operation-weekly-next");

    // Command sees every draft, and the list marks the ones that repeat.
    await signInAs(jo);
    await page.goto(`${site}/operations`);
    const listed = page.locator(".event:visible", { hasText: "Training Night 002" });
    await listed.waitFor();
    assert.match(await listed.innerText(), /Draft[\s\S]*Weekly/i);
  });
  await check("an event is copied into a new draft, with its orders, by someone who may draft its type", async () => {
    await signInAs(founder);
    await openPatrol();
    await page.getByRole("button", { name: "Draft another like this" }).click();
    await headingIs("Patrol 002");
    await eventFormReady();
    const source = await patrol();
    const copy = await eventTitled("Patrol 002");
    assert.equal(copy.state, "draft");
    assert.equal(copy.kind, "patrol");
    assert.equal(copy.copied_from, source.id);
    assert.equal(copy.summary, source.summary);
    assert.equal(copy.weapons_state, "tight");
    assert.equal(copy.repeats_weekly, false, "a copy is one night unless it is set to repeat");
    assert.equal(copy.commander_id, (await memberOf(founder)).id);
    assert.ok(Date.parse(copy.starts_at) > Date.now(), "a copy starts in the future");
    await editPart("Orders");
    assert.equal(await page.getByLabel("2 Mission").inputValue(), "Task Force Jericho will patrol the lane in order to deter piracy against traders.");
    assert.equal((await ordersOf("Patrol 002")).warning_order, (await ordersOf("Patrol 001")).warning_order);
    await shot("operation-copy");
  });
  await check("a type that has events cannot be removed, and one that has none can", async () => {
    await openEditor("Event types");
    const held = await openRecord("Patrol");
    await held.locator("summary", { hasText: "Remove this event type" }).click();
    await held.getByRole("button", { name: "Yes, remove it" }).click();
    await told(held, /Events of this type exist/);

    const spare = await openRecord("Strike");
    await spare.locator("summary", { hasText: "Remove this event type" }).click();
    await spare.getByRole("button", { name: "Yes, remove it" }).click();
    await page.locator("details.record:visible summary strong", { hasText: /^Strike$/ }).waitFor({ state: "detached" });
    assert.equal(await typeRow("strike"), undefined);

    await page.goto(`${site}/operations/new`);
    await eventFormReady();
    assert.deepEqual(await typeOptions(), ["Training evolution", "Patrol", "Response", "Tasked PvE", "Boarding drill"]);
    // The figures follow the types the fleet has.
    await page.goto(`${site}/admin/operations`);
    await leadIs(/event/);
    assert.equal(await bar("By type", "Boarding drill"), "0");
    assert.equal(await bar("By type", "Training evolution"), "1");
    assert.equal(await chart("By type").locator("th", { hasText: /^Strike$/ }).count(), 0);
  });
  await check("event types, copies and repeats are in the logs", async () => {
    await page.goto(`${site}/admin/logs?show=structure`);
    await page.locator(".log:visible").first().waitFor();
    const structure = await logText();
    assert.match(structure, /Ada Vance added the event type Boarding drill\./);
    assert.match(structure, /Ada Vance changed the event type Training evolution\./);
    assert.match(structure, /Ada Vance removed the event type Strike\./);

    await page.goto(`${site}/admin/logs?show=operations`);
    await page.locator(".log:visible").first().waitFor();
    const operations = await logText();
    assert.match(operations, /Kit Marlow drafted Training Night 001\.\s+Training evolution\. It repeats weekly\./);
    assert.match(operations, /Training Night 002 was drafted for next week when Kit Marlow ended Training Night 001\./);
    assert.match(operations, /Ada Vance drafted Patrol 002, as a copy of Patrol 001\.\s+Patrol\./);

    await page.goto(`${site}/admin/logs?show=refused`);
    await page.locator(".log:visible").first().waitFor();
    assert.match(await logText(), /Ada Vance was refused: tried to remove part of the fleet's structure\./);
  });

  console.log("Who takes part");
  const gunnery = () => eventTitled("Gunnery 001");
  const openGunnery = () => openEvent("Gunnery 001");
  const lineIn = async (title, person) =>
    one("select * from public.attendance where event_id = $1 and member_id = $2", [(await eventTitled(title)).id, (await memberOf(person)).id]);
  const manningSays = async () => (await page.locator(".manning:visible").innerText()).replace(/\s+/g, " ").trim();
  const extraPost = (title) => page.locator(".post:visible", { has: page.locator(".post-title", { hasText: new RegExp(`^${title}$`) }) });
  // Choose someone from a list by their name, whatever rank is written before it.
  const choosePerson = async (list, name) => {
    const value = await list.locator("option", { hasText: name }).first().getAttribute("value");
    await list.selectOption(value);
  };
  // Lee joins the Army as a full member with no role, so there is someone who runs nothing.
  await supabase.sql("update public.members set status = 'member', service = 'army' where id = $1", [(await memberOf(lee)).id]);

  await check("an event says who it is open to, how many places it has and how many it needs", async () => {
    await signInAs(founder);
    await page.goto(`${site}/operations/new`);
    await eventFormReady();
    await page.getByLabel("Type").selectOption({ label: "Training evolution" });
    await page.getByLabel("Title").fill("Gunnery 001");
    assert.equal(await page.getByLabel("Open to recruits").isChecked(), true, "an event is open to recruits unless it says otherwise");
    await page.getByLabel(/^Places/).fill("1");
    await page.getByLabel(/^Minimum/).fill("2");
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "The minimum cannot be more than the number of places." }).waitFor();
    await page.getByLabel(/^Places/).fill("2");
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await headingIs("Gunnery 001");
    const event = await gunnery();
    assert.equal(event.places, 2);
    assert.equal(event.minimum_attending, 2);
    assert.equal(event.open_to_recruits, true);
    const facts = await page.locator(".facts:visible").innerText();
    assert.match(facts, /Places\s+2/i);
    assert.match(facts, /Minimum\s+2 attending/i);
  });
  await check("whoever drafts an event names its units, the posts that must be filled and posts of its own", async () => {
    await page.getByRole("link", { name: "Change the details and orders" }).click();
    await editPart("Forces");
    const units = page.locator("form.force:visible");
    await units.getByLabel("Training Ship", { exact: true }).check();
    await units.getByRole("button", { name: "Save the force" }).click();
    await told(units, "Saved.");

    // The posts offered are the posts of the units taking part.
    const key = page.locator("form.picks:visible", { hasText: "Posts that must be filled" });
    await key.getByLabel("Helmsman").waitFor();
    assert.equal(await key.getByRole("checkbox").count(), 6);
    assert.equal(await key.getByLabel("Fleet Commander").count(), 0);
    await key.getByLabel("Helmsman").check();
    await key.getByRole("button", { name: "Save the posts" }).click();
    await told(key, "Saved.");

    const adding = page.locator("form:visible", { has: page.getByRole("button", { name: "Add the post" }) });
    await adding.getByLabel("Post title").fill("Range Safety Officer");
    await adding.getByLabel("Role").selectOption({ label: "Gunnery Chief" });
    await adding.getByLabel("It must be filled for the event to go ahead").check();
    await adding.getByRole("button", { name: "Add the post" }).click();
    await told(adding, "Added.");
    await adding.getByLabel("Post title").fill("Trainee");
    await adding.getByLabel("Role").selectOption({ label: "Gunner" });
    await adding.getByLabel("How many").fill("2");
    await adding.getByLabel("An attending member with no post on the night may take it").check();
    await adding.getByRole("button", { name: "Add the post" }).click();
    await told(adding, "2 posts added.");
    // The same title again is refused, and what was typed is kept.
    await adding.getByLabel("Post title").fill("Range Safety Officer");
    await adding.getByLabel("Role").selectOption({ label: "Gunner" });
    await adding.getByRole("button", { name: "Add the post" }).click();
    await told(adding, "The event already has a post with that title.");
    assert.equal(await adding.getByLabel("Post title").inputValue(), "Range Safety Officer");
    await shot("operation-taking-part");

    const id = (await gunnery()).id;
    assert.deepEqual(
      await supabase.sql("select u.name from public.event_units e join public.units u on u.id = e.unit_id where e.event_id = $1", [id]),
      [{ name: "Training Ship" }],
    );
    assert.deepEqual(
      await supabase.sql("select p.title from public.event_key_posts e join public.positions p on p.id = e.position_id where e.event_id = $1", [id]),
      [{ title: "Helmsman" }],
    );
    assert.deepEqual(
      await supabase.sql("select title, must_fill, open_to_volunteers from public.event_posts where event_id = $1 order by sort_order", [id]),
      [
        { title: "Range Safety Officer", must_fill: true, open_to_volunteers: false },
        { title: "Trainee 1", must_fill: false, open_to_volunteers: true },
        { title: "Trainee 2", must_fill: false, open_to_volunteers: true },
      ],
    );
  });
  await check("the roll shows only the units taking part, with the event's own posts, and says what it still needs", async () => {
    await openGunnery();
    await tab("Run it");
    await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();
    await tab("Overview");
    await page.locator(".manning:visible").waitFor();
    assert.match(await manningSays(), /Not yet manned 2 more are needed to reach the minimum of 2\. Posts that must be filled are empty: Helmsman, Range Safety Officer\. Members can still reply\./);
    assert.match(await page.locator(".facts:visible").innerText(), /Taking part\s+Training Ship/i);
    // Six posts on the training ship and three of the event's own. The Fleet Commander's post is not part of it.
    await tab("Roll");
    assert.match(await page.locator(".tally:visible").innerText(), /Posts\s+9/i);
    assert.equal(await post("Fleet Commander").count(), 0);
    assert.match(await extraPost("Range Safety Officer").innerText(), /Empty[\s\S]*Must be filled[\s\S]*Role: Gunnery Chief/i);
    await shot("operation-manning");
  });
  await check("a member with no post in the event takes one that is open to volunteers", async () => {
    await signInAs(kit);
    await openGunnery();
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result:visible").filter({ hasText: "You are down as attending." }).waitFor();
    await tab("Roll");
    await extraPost("Range Safety Officer").waitFor();
    assert.equal(await extraPost("Range Safety Officer").getByRole("button").count(), 0, "the commander fills that one");
    await extraPost("Trainee 1").getByRole("button", { name: "Take this post" }).click();
    await tab("Overview");
    await page.getByText("You are Trainee 1 for the night.").waitFor();
    await tab("Roll");
    assert.equal(await page.getByRole("button", { name: "Take this post" }).count(), 0, "one post at a time");
    const line = await lineIn("Gunnery 001", kit);
    assert.equal(line.place, "in");
    assert.equal(line.stand_in_set_by, (await memberOf(kit)).id);
    assert.match(await extraPost("Trainee 1").innerText(), /Filled[\s\S]*Kit Marlow/i);
  });
  await check("a reply past the last place goes on the reserve list, and moves up when a place opens", async () => {
    await signInAs(jo);
    await openGunnery();
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result:visible").filter({ hasText: "You are down as attending." }).waitFor();

    await signInAs(lee);
    await openGunnery();
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Every place is taken, so you are on the reserve list." }).waitFor();
    await page.getByText("number 1 on the reserve list").waitFor();
    assert.equal((await lineIn("Gunnery 001", lee)).place, "reserve");
    assert.match(await page.locator(".facts:visible").innerText(), /Places\s+2\s*2 taken, 1 on the reserve list/i);
    // Someone on the reserve list has no post until a place opens.
    await tab("Roll");
    await extraPost("Trainee 2").waitFor();
    assert.equal(await page.getByRole("button", { name: /Take this post|Stand in/ }).count(), 0);
    await page.goto(`${site}/operations`);
    assert.match(await page.locator(".event:visible", { hasText: "Gunnery 001" }).innerText(), /You are on the reserve list/i);
    await shot("operation-reserve");

    await signInAs(jo);
    await openGunnery();
    await page.getByRole("button", { name: "Not attending" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "You are down as not attending." }).waitFor();
    assert.equal((await lineIn("Gunnery 001", lee)).place, "in", "the first on the reserve list takes the place");
    assert.equal((await lineIn("Gunnery 001", jo)).place, null);
  });
  await check("whoever runs the event moves someone on or off the reserve list", async () => {
    // Jo comes back, to the end of the list.
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Every place is taken" }).waitFor();
    await signInAs(founder);
    await openGunnery();
    await tab("Roll");
    const reserve = page.locator(".unit-group:visible", { has: page.getByRole("heading", { name: "Reserve list" }) });
    assert.match(await reserve.locator(".reserve-list").innerText(), /Jo Reyes/);
    await choosePerson(reserve.getByLabel("Move to the reserve list"), "Lee Tanaka");
    await reserve.getByRole("button", { name: "Move to the reserve list" }).click();
    await reserve.locator(".reserve-list li", { hasText: "Lee Tanaka" }).waitFor();
    assert.equal((await lineIn("Gunnery 001", lee)).place, "reserve");
    assert.equal((await lineIn("Gunnery 001", jo)).place, "reserve", "nobody is moved up by that: the commander says who takes the place");
    await reserve.locator(".reserve-list li", { hasText: "Jo Reyes" }).getByRole("button", { name: /Give a place/ }).click();
    await reserve.locator(".reserve-list li", { hasText: "Jo Reyes" }).waitFor({ state: "detached" });
    assert.equal((await lineIn("Gunnery 001", jo)).place, "in");
  });
  await check("an event below its minimum when the roll closes is a no-go, and command is told", async () => {
    // The commander always has a place, however full the event is.
    await tab("Overview");
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result:visible").filter({ hasText: "You are down as attending." }).waitFor();
    assert.equal((await lineIn("Gunnery 001", founder)).place, "in");
    await supabase.sql(
      "update public.events set starts_at = now() + interval '10 hours', announced_at = now() - interval '3 days' where title = 'Gunnery 001'",
    );
    await openGunnery();
    assert.match(await manningSays(), /Below its minimum Posts that must be filled are empty: Helmsman, Range Safety Officer\. The roll has closed\. Whether it goes ahead is the operation commander's decision\./);
    await page.goto(`${site}/operations`);
    assert.match(await page.locator(".event:visible", { hasText: "Gunnery 001" }).innerText(), /Below its minimum/i);
    await page.goto(`${site}/admin`);
    await leadIs(/Stage 1/);
    assert.match(await page.locator("main").innerText(), /Gunnery 001 is below its minimum manning\s+Posts that must be filled are empty: Helmsman, Range Safety Officer\./);
    await shot("admin-attention-manning");
  });
  await check("the commander fills the posts that must be filled, and the event is a go", async () => {
    await openGunnery();
    await tab("Roll");
    // The commander's own post is not part of this event, so they are a spare hand like anyone else.
    await extraPost("Range Safety Officer").getByLabel("Stand-in for Range Safety Officer").selectOption({ label: "Lt. Commander Ada Vance" });
    await extraPost("Range Safety Officer").getByRole("button", { name: "Place" }).click();
    await extraPost("Range Safety Officer").getByText("Lt. Commander Ada Vance").waitFor();
    await post("Helmsman").getByLabel("Stand-in for Helmsman").selectOption({ label: "Starman Recruit Jo Reyes" });
    await post("Helmsman").getByRole("button", { name: "Place" }).click();
    await post("Helmsman").getByText("Stand-in: Starman Recruit Jo Reyes").waitFor();
    assert.match(await post("Helmsman").innerText(), /Must be filled/i);
    await tab("Overview");
    assert.match(await manningSays(), /^Go 3 attending, against a minimum of 2, and every post that must be filled has someone in it\./);
    await shot("operation-go");
    await page.goto(`${site}/admin`);
    await leadIs(/Stage 1/);
    assert.doesNotMatch(await page.locator("main").innerText(), /below its minimum manning/);
  });
  await check("an event for one service turns the others away, and takes their apologies", async () => {
    await page.goto(`${site}/operations/new`);
    await eventFormReady();
    await page.getByLabel("Type").selectOption({ label: "Patrol" });
    await page.getByLabel("Title").fill("Marine landing 001");
    await page.getByLabel("Service").selectOption({ label: "Marines only" });
    await page.getByLabel("Open to recruits").uncheck();
    await page.getByLabel(/^Qualification needed/).selectOption({ label: "Radio user" });
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await headingIs("Marine landing 001");
    assert.match(await page.locator(".facts:visible").innerText(), /Open to\s+Marines members who hold the Radio user qualification, but not recruits/i);
    await tab("Run it");
    await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();

    await signInAs(lee);
    await openEvent("Marine landing 001");
    await page.getByText("This event is for the Marines.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Attending", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Not attending" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "You are down as not attending." }).waitFor();
    assert.equal((await lineIn("Marine landing 001", lee)).reply, "not_attending");
  });
  await check("a copy carries who takes part, and nobody who was placed", async () => {
    await signInAs(founder);
    await openGunnery();
    await page.getByRole("button", { name: "Draft another like this" }).click();
    await headingIs("Gunnery 002");
    await editPart("Forces");
    const copy = await eventTitled("Gunnery 002");
    assert.equal(copy.places, 2);
    assert.equal(copy.minimum_attending, 2);
    assert.equal(await page.locator("form.force:visible").getByLabel("Training Ship", { exact: true }).isChecked(), true);
    assert.equal(await page.locator("form.picks:visible", { hasText: "Posts that must be filled" }).getByLabel("Helmsman").isChecked(), true);
    assert.deepEqual(
      (await supabase.sql("select title from public.event_posts where event_id = $1 order by sort_order", [copy.id])).map((row) => row.title),
      ["Range Safety Officer", "Trainee 1", "Trainee 2"],
    );
    assert.deepEqual(await supabase.sql("select 1 from public.attendance where event_id = $1", [copy.id]), []);
    // One of the event's own posts can be taken away again.
    const posts = page.locator(".extra-posts:visible");
    await posts.locator("li", { hasText: "Trainee 2" }).getByRole("button", { name: /Remove/ }).click();
    await posts.locator("li", { hasText: "Trainee 2" }).waitFor({ state: "detached" });
    assert.equal((await supabase.sql("select 1 from public.event_posts where event_id = $1", [copy.id])).length, 2);
  });
  await check("who takes part is in the logs", async () => {
    await page.goto(`${site}/admin/logs?show=operations`);
    await page.locator(".log:visible").first().waitFor();
    const text = await logText();
    assert.match(text, /Ada Vance named Training Ship as taking part in Gunnery 001\./);
    assert.match(text, /Ada Vance said Helmsman, Training Ship must be filled for Gunnery 001\./);
    assert.match(text, /Ada Vance added the post Range Safety Officer to Gunnery 001\.\s+Role: Gunnery Chief\. It must be filled\./);
    assert.match(text, /Kit Marlow took the post Trainee 1 for Gunnery 001\./);
    assert.match(text, /Lee Tanaka replied attending to Gunnery 001\.\s+Every place was taken, so they are on the reserve list\./);
    assert.match(text, /Lee Tanaka was given a place at Gunnery 001, from the reserve list\./);
    assert.match(text, /Ada Vance moved Lee Tanaka to the reserve list for Gunnery 001\./);
    assert.match(text, /Ada Vance placed Ada Vance as Range Safety Officer for Gunnery 001\.|Ada Vance took the post Range Safety Officer for Gunnery 001\./);
    assert.match(text, /Ada Vance removed the post Trainee 2 from Gunnery 002\./);
  });

  console.log("Fuller orders");
  const convoy = () => eventTitled("Convoy 001");
  const openConvoy = () => openEvent("Convoy 001");
  const planPart = (key) => page.locator(`#plan-${key}:visible`);
  // Add a record to one of the plan's lists: open its form, fill it, and send it.
  const addToPlan = async (key, values, button) => {
    // The report's records are on the event's page. The rest are in the editor, where the elements and their tasks have a tab of their own.
    if (key === "losses" || key === "mentions") await tab("Report");
    else await editPart(key === "elements" ? "Tasks" : "Orders");
    const adding = planPart(key).locator("details.record-new");
    if ((await adding.getAttribute("open")) === null) await adding.locator("summary").click();
    for (const [label, value] of Object.entries(values)) await adding.getByLabel(label).fill(value);
    await adding.getByRole("button", { name: button }).click();
    return adding;
  };
  const planRows = async (table, columns) =>
    supabase.sql(`select ${columns} from public.${table} where event_id = $1 order by 1`, [(await convoy()).id]);

  await check("an event says where to muster, and what to read before the night", async () => {
    await signInAs(founder);
    await page.goto(`${site}/operations/new`);
    await eventFormReady();
    await page.getByLabel("Type").selectOption({ label: "Patrol" });
    await page.getByLabel("Title").fill("Convoy 001");
    await page.getByLabel(/^Muster at/).fill("Baijini Point, pad 04; north side");
    await page.getByLabel(/^Area/).fill("ArcCorp to microTech");
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await headingIs("Convoy 001");
    const facts = await page.locator(".facts:visible").innerText();
    assert.match(facts, /Muster at\s+Baijini Point, pad 04; north side/i);
    assert.match(facts, /Area\s+ArcCorp to microTech/i);
    // The event starts at 19:00 UTC, so the timeline below is worked out against that.
    await supabase.sql("update public.events set starts_at = date_trunc('day', now()) + interval '3 days 19 hours' where title = 'Convoy 001'");

    await page.getByRole("link", { name: "Change the details and orders" }).click();
    await editPart("Orders");
    const reading = page.locator("form:visible", { has: page.getByRole("button", { name: "Save the reading" }) });
    await reading.getByLabel(/^Read before the night/).fill("the orders chapter");
    await reading.getByRole("button", { name: "Save the reading" }).click();
    await told(reading, /is not a section of the manual/);
    assert.equal(await reading.getByLabel(/^Read before the night/).inputValue(), "the orders chapter", "the form lost what was typed");
    // An address copied from the site is taken as it is.
    await reading.getByLabel(/^Read before the night/).fill("/manual/command/orders\norganisation/navy-squadron");
    await reading.getByRole("button", { name: "Save the reading" }).click();
    await told(reading, "Saved.");
    assert.deepEqual((await convoy()).reading, ["command/orders", "organisation/navy-squadron"]);
  });
  await check("the plan is written a record at a time: objectives, elements and tasks, the timeline, ships and nets", async () => {
    await told(await addToPlan("objectives", { Objective: "Hold the lane for one hour" }, "Add the objective"), "Added.");
    await told(await addToPlan("objectives", { Objective: "Bring every trader through" }, "Add the objective"), "Added.");
    await told(
      await addToPlan("elements", { Element: "UEES Nexus", Callsign: "Anvil", Task: "Screen the convoy from the sunward side." }, "Add the element"),
      "Added.",
    );
    const again = await addToPlan("elements", { Element: "UEES Nexus", Task: "Something else." }, "Add the element");
    await told(again, "The event already has an element with that name.");
    assert.equal(await again.getByLabel("Task").inputValue(), "Something else.", "the form lost what was typed");
    await again.getByLabel("Element").fill("A Flight");
    await again.getByLabel("Callsign").fill("Hornet");
    await again.getByRole("button", { name: "Add the element" }).click();
    await told(again, "Added.");

    // A time is given as the time of day in UTC, and kept against the start.
    await told(await addToPlan("timings", { "Time, in UTC": "18:45", "What happens": "Muster" }, "Add the timing"), "Added.");
    await told(await addToPlan("timings", { "Time, in UTC": "20:30", "What happens": "Hot debrief" }, "Add the timing"), "Added.");
    await told(await addToPlan("ships", { Ship: "Hammerhead", Note: "Flagship for the night" }, "Add the ship"), "Added.");
    await told(await addToPlan("ships", { Ship: "Gladius" }, "Add the ship"), "Added.");
    await told(await addToPlan("nets", { Net: "Command", "What it is for": "Orders and reports", "Who controls it": "Zero" }, "Add the net"), "Added.");

    assert.deepEqual(await planRows("event_timings", "offset_minutes, label"), [
      { offset_minutes: -15, label: "Muster" },
      { offset_minutes: 90, label: "Hot debrief" },
    ]);
    assert.deepEqual(await planRows("event_elements", "name, callsign, task"), [
      { name: "A Flight", callsign: "Hornet", task: "Something else." },
      { name: "UEES Nexus", callsign: "Anvil", task: "Screen the convoy from the sunward side." },
    ]);

    // A record is changed in place, and one that is not wanted is removed.
    await editPart("Tasks");
    const flight = planPart("elements").locator("details.record:not(.record-new)", { has: page.locator("summary strong", { hasText: /^A Flight$/ }) });
    await flight.locator("summary").click();
    await flight.getByLabel("Task").fill("Top cover for the Nexus.");
    await flight.getByRole("button", { name: "Save", exact: true }).click();
    await told(flight, "Saved.");
    await editPart("Orders");
    const gladius = planPart("ships").locator("details.record:not(.record-new)", { has: page.locator("summary strong", { hasText: /^Gladius$/ }) });
    await gladius.locator("summary").click();
    await gladius.getByRole("button", { name: /Remove this ship/ }).click();
    await gladius.waitFor({ state: "detached" });
    assert.deepEqual(await planRows("event_ships", "ship, note"), [{ ship: "Hammerhead", note: "Flagship for the night" }]);
    assert.equal((await planRows("event_elements", "name, task"))[0].task, "Top cover for the Nexus.");
    await shot("operation-plan-edit");
  });
  await check("the event's page lays the plan out with the orders, in the reader's own time as well as UTC", async () => {
    await openConvoy();
    assert.deepEqual(await page.locator(".reading:visible a").allInnerTexts(), ["Orders", "Navy squadron"]);
    await tab("Orders");
    const orders = (await page.locator(".orders:visible").innerText()).replace(/\s+/g, " ");
    assert.match(orders, /3 Execution .*4 Support .*5 Command and signal/i);
    assert.match(orders, /Objectives Hold the lane for one hour Bring every trader through/i);
    assert.match(orders, /Timeline .*18:45 UTC.*H-15 Muster .*20:30 UTC.*H\+90 Hot debrief/i);
    assert.match(orders, /Ships .*Hammerhead Flagship for the night/i);
    assert.match(orders, /Comms plan .*Command Orders and reports Zero .*UEES Nexus Anvil A Flight Hornet/i);
    // Each element's task is on the Tasks tab.
    await tab("Tasks");
    const tasks = (await page.locator(".task-list:visible").innerText()).replace(/\s+/g, " ");
    assert.match(tasks, /UEES Nexus ?Callsign Anvil Everyone Screen the convoy from the sunward side\. A Flight ?Callsign Hornet Everyone Top cover for the Nexus\./i);

    // Someone reading this in Sydney is shown their own clock beside UTC.
    const starts = (await convoy()).starts_at;
    const inSydney = (iso) =>
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(new Date(iso));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "Australia/Sydney" });
    try {
      await openConvoy();
      await page.locator(".facts:visible").getByText(`${inSydney(starts)} your time`).waitFor();
      await tab("Orders");
      const muster = new Date(Date.parse(starts) - 15 * 60_000).toISOString();
      await page.locator(".plan-table:visible").getByText(`${inSydney(muster)} your time`).waitFor();
      await shot("operation-plan");
    } finally {
      await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "" });
      await cdp.detach();
    }
  });
  await check("an amendment is numbered and dated, and everyone attending is asked to acknowledge it", async () => {
    await openConvoy();
    assert.equal(await page.getByLabel("Issue an amendment").count(), 0, "a draft's orders are simply changed");
    await tab("Run it");
    await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();

    await signInAs(kit);
    await openConvoy();
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result:visible").filter({ hasText: "You are down as attending." }).waitFor();
    assert.equal(await page.getByLabel("Issue an amendment").count(), 0, "only whoever runs the event issues one");

    await signInAs(founder);
    await openConvoy();
    await tab("Run it");
    await page.getByLabel("Issue an amendment").fill("Muster moved to pad 06.\nStart is unchanged.");
    await page.getByRole("button", { name: "Issue the amendment" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Amendment 1 is issued." }).waitFor();
    await page.getByText("Not yet acknowledged amendment 1: Starman Recruit Kit Marlow.").waitFor();
    const issued = await one("select * from public.event_amendments where event_id = $1", [(await convoy()).id]);
    assert.equal(issued.number, 1);
    assert.equal(issued.issued_by, (await memberOf(founder)).id);
    await tab("Orders");
    assert.match(await page.locator(".amendment-list:visible").innerText(), /Amendment 1[\s\S]*by Lt\. Commander Ada Vance[\s\S]*Muster moved to pad 06\./);

    await signInAs(kit);
    await openConvoy();
    await page.getByText("It changes the orders. Read it, then acknowledge it.").waitFor();
    await shot("operation-amendment");
    await page.getByRole("button", { name: "Acknowledge amendment 1" }).click();
    await page.getByText("You have acknowledged amendment 1.").waitFor();
    const line = await one("select * from public.event_acknowledgements where event_id = $1 and member_id = $2", [(await convoy()).id, (await memberOf(kit)).id]);
    assert.equal(line.amendment_number, 1);

    // Someone who has not said they are attending reads it, and is not asked.
    await signInAs(lee);
    await openConvoy();
    await page.getByRole("heading", { name: "Latest amendment" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Acknowledge amendment/ }).count(), 0);
    await tab("Orders");
    await page.locator(".amendment-list:visible").waitFor();

    await signInAs(founder);
    await openConvoy();
    await tab("Run it");
    await page.getByText("Everyone attending has acknowledged amendment 1.").waitFor();
    await page.getByLabel("Issue an amendment").fill("Weapons tight throughout.");
    await page.getByRole("button", { name: "Issue the amendment" }).click();
    await page.getByText("Not yet acknowledged amendment 2: Starman Recruit Kit Marlow.").waitFor();
    // The latest is first.
    await tab("Orders");
    assert.match((await page.locator(".amendment-list:visible li").first().innerText()), /Amendment 2/);
  });
  await check("a copy carries the plan, and none of the amendments", async () => {
    await tab("Overview");
    await page.getByRole("button", { name: "Draft another like this" }).click();
    await headingIs("Convoy 002");
    await eventFormReady();
    assert.equal(await page.getByLabel(/^Muster at/).inputValue(), "Baijini Point, pad 04; north side");
    await editPart("Orders");
    await planPart("objectives").locator("details.record:not(.record-new)").first().waitFor();
    assert.equal(await planPart("objectives").locator("details.record:not(.record-new)").count(), 2);
    assert.equal(await planPart("timings").locator("details.record:not(.record-new)").count(), 2);
    // A timing shows as its time of day, a week on.
    assert.match(await planPart("timings").locator("details.record:not(.record-new) summary").first().innerText(), /Muster\s+18:45/);
    assert.equal(await page.getByLabel(/^Read before the night/).inputValue(), "command/orders\norganisation/navy-squadron");
    const copy = await eventTitled("Convoy 002");
    assert.deepEqual(await supabase.sql("select 1 from public.event_amendments where event_id = $1", [copy.id]), []);
    assert.equal((await supabase.sql("select 1 from public.event_nets where event_id = $1", [copy.id])).length, 1);
  });
  await check("the plan and its amendments are in the logs", async () => {
    await page.goto(`${site}/admin/logs?show=operations`);
    await page.locator(".log:visible").first().waitFor();
    const text = await logText();
    assert.match(text, /Ada Vance added the objective Hold the lane for one hour to the plan of Convoy 001\./);
    assert.match(text, /Ada Vance added the element UEES Nexus to the plan of Convoy 001\./);
    assert.match(text, /Ada Vance added H-15 Muster to the timeline of Convoy 001\./);
    assert.match(text, /Ada Vance removed the ship Gladius from the plan of Convoy 001\./);
    assert.match(text, /Ada Vance added the net Command to the plan of Convoy 001\./);
    assert.match(text, /Ada Vance issued amendment 1 to the orders of Convoy 001\.\s+Muster moved to pad 06\./);
    assert.match(text, /Kit Marlow acknowledged amendment 1 to the orders of Convoy 001\./);
  });

  console.log("Training and the report");
  const course = () => eventTitled("Radio course 001");
  const openCourse = () => openEvent("Radio course 001");
  const radioUser = async () => (await one("select id from public.qualifications where code = 'radio-user'")).id;
  const reportText = async () => {
    await tab("Report");
    return (await page.locator("section:visible", { has: page.locator("#report") }).innerText()).replace(/\s+/g, " ");
  };

  await check("a training event names the qualification it teaches", async () => {
    await signInAs(founder);
    await page.goto(`${site}/operations/new`);
    await eventFormReady();
    await page.getByLabel("Type").selectOption({ label: "Training evolution" });
    await page.getByLabel("Title").fill("Radio course 001");
    await page.getByLabel(/^Qualification taught/).selectOption({ label: "Radio user" });
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await headingIs("Radio course 001");
    assert.equal((await course()).teaches_qualification_id, await radioUser());
    assert.match(await page.locator(".facts:visible").innerText(), /Teaches\s+Radio user/i);
    assert.equal(await page.getByRole("heading", { name: "Signed off" }).count(), 0, "nobody is signed off before the event");

    await page.getByRole("link", { name: "Change the details and orders" }).click();
    await editPart("Orders");
    const adding = planPart("objectives").locator("details.record-new");
    await adding.locator("summary").click();
    await adding.getByLabel("Objective").fill("Everyone passes the radio check");
    await adding.getByRole("button", { name: "Add the objective" }).click();
    await told(adding, "Added.");
    await openCourse();
    await tab("Run it");
    await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();
    for (const person of [kit, lee]) {
      await signInAs(person);
      await openCourse();
      await page.getByRole("button", { name: "Attending", exact: true }).click();
      await page.locator(".form-result:visible").filter({ hasText: "You are down as attending." }).waitFor();
    }
    await supabase.sql("update public.events set starts_at = now() - interval '1 hour', announced_at = now() - interval '3 days' where title = 'Radio course 001'");
  });
  await check("an instructor signs off who passed, in their own name", async () => {
    // Jo is command, and not an instructor, so has nobody to sign off.
    await signInAs(jo);
    await openCourse();
    await tab("Report");
    await page.getByRole("heading", { name: "Signed off" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("button", { name: "Sign off the passes" }).count(), 0);

    await signInAs(kit);
    await openCourse();
    await tab("Report");
    const form = page.locator("form.picks:visible", { hasText: "Who passed" });
    // An instructor does not sign off their own pass, so Kit is not on the list.
    assert.deepEqual((await form.locator("li").allInnerTexts()).map((text) => text.trim()), ["Private First Class Lee Tanaka"]);
    await form.getByRole("button", { name: "Sign off the passes" }).click();
    await told(form, "Tick who passed first.");
    await form.getByLabel(/Lee Tanaka/).check();
    await form.getByRole("button", { name: "Sign off the passes" }).click();
    await page.getByText("Signed off here: Private First Class Lee Tanaka.").waitFor();
    const award = await one("select * from public.qualification_awards where member_id = $1 and qualification_id = $2", [(await memberOf(lee)).id, await radioUser()]);
    assert.equal(award.awarded_by, (await memberOf(kit)).id);
    assert.equal(award.event_id, (await course()).id);
    // Signed off once: the box is ticked and cannot be ticked again.
    await page.locator("form.picks:visible li", { hasText: "Holds it already" }).waitFor();
    assert.equal(await page.locator("form.picks:visible").getByLabel(/Lee Tanaka/).isDisabled(), true);
    await shot("operation-sign-off");

    // Everyone else reads who was signed off, and the member finds it on their own record.
    await signInAs(jo);
    await openCourse();
    await tab("Report");
    await page.getByText("Signed off here: Private First Class Lee Tanaka.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Sign off the passes" }).count(), 0);
    await signInAs(lee);
    await page.goto(`${site}/profile`);
    await page.getByRole("heading", { name: "What you have earned" }).waitFor();
    assert.match((await page.locator(".earned:visible").innerText()).replace(/\s+/g, " "), /Radio user .*, at Radio course 001/i);
  });
  await check("whoever ran the event answers each objective, and records losses and mentions", async () => {
    await signInAs(founder);
    await openCourse();
    await tab("Report");
    await page.getByLabel(/Ada Vance/).selectOption({ label: "Present" });
    await page.getByRole("button", { name: "Make the return and close the event" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "The attendance return is made." }).waitFor();
    await page.getByLabel("What happened").fill("Three sat the radio check. Two passed.");
    await page.getByRole("button", { name: "File the report" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "The after-action report is filed." }).waitFor();

    const outcomes = page.locator("form.outcomes:visible");
    assert.match(await outcomes.innerText(), /Everyone passes the radio check/);
    await outcomes.getByLabel("Outcome").selectOption({ label: "Partly achieved" });
    await outcomes.getByLabel(/^Note/).fill("Two of three passed.");
    await outcomes.getByRole("button", { name: "Save the outcomes" }).click();
    await told(outcomes, "Saved.");

    await told(await addToPlan("losses", { "What was lost": "Pisces", "How many": "2", Note: "Lost on approach to the pad." }, "Add the loss"), "Added.");
    const mentioning = planPart("mentions").locator("details.record-new");
    await mentioning.locator("summary").click();
    // Whoever writes the report mentions someone who was there, and never themselves.
    assert.deepEqual(
      (await mentioning.getByLabel("Member").locator("option:not([disabled])").allInnerTexts()).map((text) => text.trim()),
      ["Starman Recruit Kit Marlow", "Private First Class Lee Tanaka"],
    );
    await mentioning.getByLabel("Member").selectOption({ label: "Starman Recruit Kit Marlow" });
    await mentioning.getByLabel("For what").fill("Kept the net clear for the whole course.");
    await mentioning.getByRole("button", { name: "Add the mention" }).click();
    await told(mentioning, "Added.");
    // One mention for each member: Kit is no longer offered.
    await planPart("mentions").locator("details.record:not(.record-new) summary strong", { hasText: "Kit Marlow" }).waitFor();
    assert.equal(await mentioning.getByLabel("Member").locator("option", { hasText: "Kit Marlow" }).count(), 0);
    await shot("operation-report-edit");

    const id = (await course()).id;
    const outcome = await one("select outcome, note, set_by from public.event_objective_outcomes where event_id = $1", [id]);
    assert.deepEqual(outcome, { outcome: "partly", note: "Two of three passed.", set_by: (await memberOf(founder)).id });
    assert.deepEqual(await supabase.sql("select item, quantity, note from public.event_losses where event_id = $1", [id]), [
      { item: "Pisces", quantity: 2, note: "Lost on approach to the pad." },
    ]);
    const mention = await one("select member_id, mentioned_by, citation from public.event_mentions where event_id = $1", [id]);
    assert.deepEqual(mention, {
      member_id: (await memberOf(kit)).id,
      mentioned_by: (await memberOf(founder)).id,
      citation: "Kept the net clear for the whole course.",
    });
  });
  await check("the fleet reads the fuller report, and a mention is on the member's own record", async () => {
    await signInAs(lee);
    await openCourse();
    const report = await reportText();
    assert.match(report, /Filed by Lt\. Commander Ada Vance/);
    assert.match(report, /Objectives Everyone passes the radio check ?Partly achieved ?Two of three passed\./i);
    assert.match(report, /Losses .*Pisces 2 Lost on approach to the pad\./i);
    assert.match(report, /Mentions Starman Recruit Kit Marlow Kept the net clear for the whole course\./i);
    await shot("operation-report");

    await signInAs(kit);
    await openCourse();
    assert.match(await reportText(), /Kit Marlow ?You Kept the net clear/i);
    await page.goto(`${site}/profile`);
    await page.getByRole("heading", { name: "What you have earned" }).waitFor();
    const earned = (await page.locator(".earned:visible").innerText()).replace(/\s+/g, " ");
    assert.match(earned, /Mentions Kept the net clear for the whole course\. Radio course 001,/i);
    await shot("profile-earned");
  });
  await check("sign-off and the report's records are in the logs", async () => {
    await signInAs(founder);
    await page.goto(`${site}/admin/logs?show=personnel`);
    await page.locator(".log:visible").first().waitFor();
    const personnel = await logText();
    assert.match(personnel, /Kit Marlow signed Lee Tanaka off for the Radio user qualification at Radio course 001\./);
    assert.match(personnel, /Ada Vance mentioned Kit Marlow in the report of Radio course 001\.\s+Kept the net clear for the whole course\./);
    await page.goto(`${site}/admin/logs?show=operations`);
    await page.locator(".log:visible").first().waitFor();
    const operations = await logText();
    assert.match(operations, /Ada Vance recorded "Everyone passes the radio check" as partly achieved at Radio course 001\.\s+Two of three passed\./);
    assert.match(operations, /Ada Vance recorded the loss of 2 × Pisces at Radio course 001\./);
  });

  console.log("Approval, the opposing force and reach");
  const announceNow = async () => {
    await tab("Run it");
    await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
  };
  const draftEvent = async (type, title, more = async () => {}) => {
    await page.goto(`${site}/operations/new`);
    await eventFormReady();
    await page.getByLabel("Type").selectOption({ label: type });
    await page.getByLabel("Title").fill(title);
    await more();
    await page.getByRole("button", { name: "Save as a draft" }).click();
    await headingIs(title);
  };

  await check("an announcement is posted to Discord with the bare facts, and none of the orders", async () => {
    const posted = discord.posts.find((post) => post.body.content?.includes("Patrol 001"));
    assert.ok(posted, "the first announcement was not posted");
    const event = await patrol();
    assert.equal(posted.path, "/api/webhooks/1/for-tests");
    assert.match(
      posted.body.content,
      new RegExp(`^\\*\\*Patrol: Patrol 001\\*\\*\\n<t:\\d+:F> \\(<t:\\d+:R>\\)\\n${site}/operations/${event.id}$`),
    );
    // Whatever a title says, the post pings nobody.
    assert.deepEqual(posted.body.allowed_mentions, { parse: [] });
    // The summary and the orders are for the serving fleet, behind sign-in.
    const everything = discord.posts.map((post) => JSON.stringify(post.body)).join("\n");
    assert.doesNotMatch(everything, /ArcCorp|deter piracy|Commander: Ada Vance|Baijini|Ambush/);
    // One post for each announcement, and none for a draft, a cancellation or a closed event.
    const announced = await supabase.sql("select count(*)::int as n from public.events where announced_at is not null");
    assert.equal(discord.posts.length, announced[0].n);
  });
  await check("an announcement still goes through when Discord does not answer, and says so", async () => {
    await signInAs(founder);
    await draftEvent("Patrol", "Patrol 090 @everyone");
    discord.failNext = true;
    await announceNow();
    await page.locator(".form-result:visible").filter({ hasText: "It could not be posted to Discord, so tell the fleet yourself." }).waitFor();
    assert.equal((await eventTitled("Patrol 090 @everyone")).state, "announced");
    assert.equal(discord.posts.filter((post) => post.body.content?.includes("Patrol 090")).length, 0);
  });
  await check("a member takes one event away as a calendar file, and nobody else can", async () => {
    await signInAs(kit);
    const event = await convoy();
    await openConvoy();
    assert.equal(await page.getByRole("link", { name: "Add to calendar" }).getAttribute("href"), `/operations/${event.id}/calendar`);
    const file = await page.request.get(`${site}/operations/${event.id}/calendar`);
    assert.equal(file.status(), 200);
    assert.match(file.headers()["content-type"], /^text\/calendar/);
    assert.match(file.headers()["content-disposition"], /attachment; filename="convoy-001\.ics"/);
    assert.match(file.headers()["cache-control"], /no-store/);
    const text = await file.text();
    assert.match(text, /BEGIN:VCALENDAR\r\n[\s\S]*BEGIN:VEVENT\r\n[\s\S]*END:VEVENT\r\nEND:VCALENDAR\r\n$/);
    assert.match(text, /SUMMARY:Convoy 001\r\n/);
    const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    assert.ok(text.includes(`DTSTART:${stamp(event.starts_at)}\r\n`));
    assert.ok(text.includes(`DTEND:${stamp(Date.parse(event.starts_at) + event.duration_minutes * 60_000)}\r\n`));
    // A comma and a semicolon are written the way a calendar file needs them.
    assert.ok(text.includes("LOCATION:Baijini Point\\, pad 04\\; north side\r\n"));
    assert.ok(text.replace(/\r\n /g, "").includes(`URL:${site}/operations/${event.id}`));
    // The orders, the plan and the roll are not in it.
    assert.doesNotMatch(text, /Hold the lane|Screen the convoy|Anvil|Kit Marlow|pad 06/);

    // An event the member cannot see is not found, and nobody signed out gets a file.
    const draft = await eventTitled("Gunnery 002");
    assert.equal((await page.request.get(`${site}/operations/${draft.id}/calendar`)).status(), 404);
    await context.clearCookies();
    const refused = await page.request.get(`${site}/operations/${event.id}/calendar`, { maxRedirects: 0 });
    assert.equal(refused.status(), 307);
    assert.match(refused.headers().location, /\/sign-in$/);
  });
  await check("a type of event can need command's approval, and a draft of it waits until command gives it", async () => {
    await signInAs(founder);
    await openEditor("Event types");
    const training = await openRecord("Training evolution");
    await training.getByLabel("A draft by anyone but command needs command's approval before it is announced").check();
    await training.getByRole("button", { name: "Save", exact: true }).click();
    await told(training, "Saved.");
    assert.equal((await typeRow("training")).needs_approval, true);

    // Kit is an instructor, and not command.
    await signInAs(kit);
    await draftEvent("Training evolution", "Approval drill 001");
    await tab("Run it");
    await page.getByText("This type of event needs command's approval before it is announced.").waitFor();
    assert.equal(await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).count(), 0);
    await page.getByRole("button", { name: "Ask command to approve it" }).click();
    await page.getByText("Waiting for command's approval.").waitFor();
    const waiting = await eventTitled("Approval drill 001");
    assert.equal(waiting.approval, "asked");
    await shot("operation-awaiting-approval");
    // A draft's date is not settled, so it has no calendar file, even for whoever wrote it.
    await tab("Overview");
    await page.getByRole("heading", { name: "At a glance" }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Add to calendar" }).count(), 0);
    assert.equal((await page.request.get(`${site}/operations/${waiting.id}/calendar`)).status(), 404);

    await signInAs(jo);
    await page.goto(`${site}/admin`);
    await leadIs(/Stage 1/);
    assert.match(await page.locator("main").innerText(), /Approval drill 001 is waiting for command's approval/);
    await openEvent("Approval drill 001");
    await tab("Run it");
    await page.getByRole("button", { name: "Approve it" }).click();
    await page.getByText("Command has approved this draft.").waitFor();
    const approved = await eventTitled("Approval drill 001");
    assert.equal(approved.approval, "approved");
    assert.equal(approved.approved_by, (await memberOf(jo)).id);
    assert.ok(approved.approved_at);

    await signInAs(kit);
    await openEvent("Approval drill 001");
    await tab("Run it");
    await page.getByText("Command has approved this draft.").waitFor();
    await announceNow();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();
    assert.equal((await eventTitled("Approval drill 001")).state, "announced");
    // Command needs nobody's approval for a draft of its own.
    await signInAs(jo);
    await draftEvent("Training evolution", "Approval drill 002");
    await tab("Run it");
    await page.locator(".decisions:visible summary", { hasText: /^Announce$/ }).waitFor();
  });
  await check("command sets up an opposing force, and the side being exercised is shown none of it", async () => {
    await signInAs(founder);
    await draftEvent("Patrol", "Wargame 001", async () => {
      // Lee commands the side being exercised, and is not command.
      await choosePerson(page.getByLabel("Operation commander"), "Lee Tanaka");
    });
    await tab("Opposing force");
    const section = page.locator("section:visible", { has: page.locator("#opfor") });
    await section.getByText("Nobody has been named yet.").waitFor();
    await choosePerson(section.getByLabel("Name to the opposing force"), "Kit Marlow");
    await section.getByLabel("Leads it").check();
    await section.getByRole("button", { name: "Name to the opposing force" }).click();
    await section.locator(".opfor-roll li", { hasText: "Kit Marlow" }).waitFor();
    assert.match(await section.locator(".opfor-roll").innerText(), /Kit Marlow\s*Leads/i);
    // Whoever runs the event is on the other side, so is not offered.
    assert.equal(await section.getByLabel("Name to the opposing force").locator("option", { hasText: "Lee Tanaka" }).count(), 0);
    await section.getByLabel("The opposing force's plan").fill("Ambush at the second waypoint.");
    await section.getByRole("button", { name: "Save the plan" }).click();
    await told(section, "Saved.");
    await announceNow();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();
    await tab("Opposing force");
    await shot("operation-opfor");

    // The event's own commander runs it, and sees neither the plan nor who is against them.
    await signInAs(lee);
    await openEvent("Wargame 001");
    await tab("Run it");
    await page.getByRole("heading", { name: "Decisions" }).waitFor();
    assert.equal(await page.locator("#opfor").count(), 0);
    await everyTab(async () => {
      assert.doesNotMatch(await page.locator("main").innerText(), /Opposing force|Ambush|Kit Marlow/i);
    });

    // The member who leads it reads it, writes its plan, and is not on the roll.
    await signInAs(kit);
    await openEvent("Wargame 001");
    await tab("Opposing force");
    const mine = page.locator("section:visible", { has: page.locator("#opfor") });
    await mine.getByText("You are on the opposing force for this event.").first().waitFor();
    assert.equal(await mine.getByLabel("Name to the opposing force").count(), 0, "who is on it is command's to say");
    await mine.getByLabel("The opposing force's plan").fill("Ambush at the third waypoint instead.");
    await mine.getByRole("button", { name: "Save the plan" }).click();
    await told(mine, "Saved.");
    assert.equal((await one("select plan from public.event_opfor where event_id = $1", [(await eventTitled("Wargame 001")).id])).plan, "Ambush at the third waypoint instead.");
    await tab("Overview");
    await page.getByText("so you are not on its roll and have nothing to reply to").waitFor();
    assert.equal(await page.getByRole("button", { name: "Attending", exact: true }).count(), 0);

    // Taken off it, they are an ordinary member of the event again.
    await signInAs(founder);
    await openEvent("Wargame 001");
    await tab("Opposing force");
    await page.locator(".opfor-roll:visible li", { hasText: "Kit Marlow" }).getByRole("button", { name: /Take off/ }).click();
    await page.locator("section:visible", { has: page.locator("#opfor") }).getByText("Nobody has been named yet.").waitFor();
    await signInAs(kit);
    await openEvent("Wargame 001");
    assert.equal(await page.locator("#opfor").count(), 0);
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result:visible").filter({ hasText: "You are down as attending." }).waitFor();
  });
  await check("approval, the opposing force and a failed post are in the logs", async () => {
    await signInAs(founder);
    await page.goto(`${site}/admin/logs?show=operations`);
    await page.locator(".log:visible").first().waitFor();
    const text = await logText();
    assert.match(text, /Kit Marlow asked command to approve Approval drill 001\./);
    assert.match(text, /Jo Reyes approved Approval drill 001\./);
    assert.match(text, /Ada Vance named Kit Marlow to the opposing force of Wargame 001, to lead it\./);
    assert.match(text, /Kit Marlow wrote the opposing force's plan for Wargame 001\./);
    assert.match(text, /Ada Vance took Kit Marlow off the opposing force of Wargame 001\./);
    // The plan's words are not in the list.
    assert.doesNotMatch(text, /Ambush/);
    await page.goto(`${site}/admin/logs?show=refused`);
    await page.locator(".log:visible").first().waitFor();
    assert.match(await logText(), /Ada Vance tried to post an announcement to Discord, and it failed\./);
  });

  console.log("Unit tasks");
  const escort = () => eventTitled("Escort 001");
  const openEscort = () => openEvent("Escort 001");
  const taskRow = async () => one("select * from public.event_unit_tasks where event_id = $1", [(await escort()).id]);
  const taskCard = () => page.locator(".unit-task:visible", { has: page.locator("h3", { hasText: "Training Ship" }) });
  // Kit takes the helm of the training ship and Lee a turret. Sam joins the fleet and holds no post.
  for (const person of [kit, lee, sam]) {
    const member = await memberOf(person);
    await supabase.sql("update public.members set status = 'member', service = 'navy', character_name = coalesce(character_name, 'Sam Okoro') where id = $1", [member.id]);
    await supabase.sql("insert into public.qualification_awards (member_id, qualification_id) select $1, id from public.qualifications on conflict do nothing", [member.id]);
  }
  for (const [person, title] of [[kit, "Helmsman"], [lee, "Gunner 1"]]) {
    await supabase.sql(
      `insert into public.assignments (member_id, position_id, kind)
       select $1, p.id, 'primary' from public.positions p join public.units u on u.id = p.unit_id where u.name = 'Training Ship' and p.title = $2`,
      [(await memberOf(person)).id, title],
    );
  }

  await check("an admin says which post commands a unit, and which posts lead", async () => {
    await signInAs(founder);
    await openEditor("Units");
    const ship = await openRecord("Task Force Jericho › Training Ship");
    // A crew of entry posts starts with nobody to command it.
    assert.equal(await ship.getByLabel("Commanded by").inputValue(), "");
    await ship.getByLabel("Commanded by").selectOption({ label: "Task Force Jericho › Training Ship: Helmsman" });
    await ship.getByRole("button", { name: "Save", exact: true }).click();
    await told(ship, "Saved.");
    const stored = await one(
      "select p.title from public.units u join public.positions p on p.id = u.commander_position_id where u.name = 'Training Ship'",
    );
    assert.equal(stored.title, "Helmsman");
    await openEditor("Posts");
    const chief = await openRecord("Gunnery Chief");
    assert.equal(await chief.getByLabel(/^A leader, who reads/).isChecked(), false, "a department's chief leads by commanding it");
    const boat = await openRecord("Chief of the Boat");
    assert.equal(await boat.getByLabel(/^A leader, who reads/).isChecked(), true);
  });
  await check("whoever writes the orders gives a unit its task, and is told who will read it", async () => {
    await draftEvent("Patrol", "Escort 001");
    await page.getByRole("link", { name: "Change the details and orders" }).click();
    await editPart("Forces");
    const units = page.locator("form.force:visible");
    await units.getByLabel("Training Ship", { exact: true }).check();
    await units.getByRole("button", { name: "Save the force" }).click();
    await told(units, "Saved.");

    await editPart("Tasks");
    const giving = page.locator("form.task-form:visible", { has: page.getByRole("button", { name: "Give the task" }) });
    // Only the units taking part are offered.
    assert.deepEqual(
      (await giving.getByLabel("Unit", { exact: true }).locator("option").allInnerTexts()).map((text) => text.trim()),
      ["Task Force Jericho › Training Ship"],
    );
    await giving.getByLabel("Task", { exact: true }).fill("Hold the lane until the convoy is through.");
    await giving.getByLabel(/^Callsign/).fill("Trainer");
    // A new task starts as the unit's own.
    assert.equal(await giving.getByLabel("The unit", { exact: true }).isChecked(), true);
    const reads = giving.locator(".levels-reads");
    assert.match(await reads.innerText(), /Read by everyone posted in Training Ship, which is 6 posts\. Above them: Fleet Commander\./);
    await giving.getByLabel("Its commander").check();
    assert.match(await reads.innerText(), /Read by Helmsman, Training Ship alone\. Above them: Fleet Commander\. Everyone else is shown that it is withheld\./);
    await giving.getByRole("button", { name: "Give the task" }).click();
    // It now has its own card, and no unit is left without a task.
    await page.getByRole("heading", { name: "Task Force Jericho › Training Ship" }).waitFor();
    await page.getByText("Every unit taking part has its task.").waitFor();
    const stored = await taskRow();
    assert.equal(stored.level, "commander");
    assert.equal(stored.callsign, "Trainer");
    assert.equal(stored.set_by, (await memberOf(founder)).id);
    await shot("operation-task-edit");

    await page.goto(`${site}/operations/${(await escort()).id}`);
    await headingIs("Escort 001");
    await announceNow();
    await page.locator(".form-result:visible").filter({ hasText: "Announced." }).waitFor();
    // Whoever runs the event reads it, and its callsign is in the comms plan.
    await tab("Tasks");
    assert.match(await taskCard().innerText(), /Its commander[\s\S]*Hold the lane until the convoy is through\./i);
    await tab("Orders");
    assert.match((await page.locator(".orders:visible").innerText()).replace(/\s+/g, " "), /Comms plan .*Training Ship Trainer/i);
  });
  await check("a withheld task is listed for everyone, and its words are for those it is for", async () => {
    // Lee is in the unit, and the task is for its commander alone. Sam is not in it at all.
    for (const person of [lee, sam]) {
      await signInAs(person);
      await openEscort();
      await page.locator('nav[aria-label="Parts of this event"]:visible a', { hasText: "1 withheld" }).waitFor();
      await tab("Tasks");
      assert.match(await taskCard().innerText(), /Its commander[\s\S]*This task is held by the commander of Training Ship\./i);
      await everyTab(async () => {
        assert.doesNotMatch(await page.locator("main").innerText(), /until the convoy is through/);
      });
    }
    await shot("operation-task-withheld");

    // Kit holds the post that commands the ship: the task is theirs to read, and to pass down.
    await signInAs(kit);
    await openEscort();
    const mine = page.locator("section:visible", { has: page.locator("#your-task") });
    assert.match(await mine.innerText(), /Training Ship[\s\S]*Hold the lane until the convoy is through\./);
    await mine.getByRole("link", { name: "Every unit's task" }).click();
    await taskCard().waitFor();
    assert.equal(await page.locator('nav[aria-label="Parts of this event"]:visible a', { hasText: "withheld" }).count(), 0);
    // The key beside the tasks draws each level's picture.
    assert.ok((await page.locator(".task-key:visible li svg > *").count()) >= 4, "a level in the key has no picture");
    await shot("operation-task-commander");
    await taskCard().getByRole("button", { name: /^Open to my unit/ }).click();
    await taskCard().locator(".chip.level", { hasText: "The unit" }).waitFor();
    assert.equal((await taskRow()).level, "unit");
    // Once it is the unit's, there is nothing further down to pass it to.
    assert.equal(await taskCard().getByRole("button", { name: /^Open to my/ }).count(), 0);

    await signInAs(lee);
    await openEscort();
    await tab("Tasks");
    assert.match(await taskCard().innerText(), /Yours[\s\S]*The unit[\s\S]*Hold the lane until the convoy is through\./i);
    await signInAs(sam);
    await openEscort();
    await tab("Tasks");
    assert.match(await taskCard().innerText(), /This task is for Training Ship only\./);
  });
  await check("every task opens once the event is closed", async () => {
    await supabase.sql("update public.events set starts_at = now() - interval '1 hour', announced_at = now() - interval '3 days' where title = 'Escort 001'");
    await signInAs(founder);
    await openEscort();
    await tab("Report");
    await page.getByRole("button", { name: "Make the return and close the event" }).click();
    await page.locator(".form-result:visible").filter({ hasText: "The attendance return is made." }).waitFor();
    assert.equal((await escort()).state, "done");
    await signInAs(sam);
    await openEscort();
    await tab("Tasks");
    assert.match(await taskCard().innerText(), /Hold the lane until the convoy is through\./);
    assert.equal(await page.locator('nav[aria-label="Parts of this event"]:visible a', { hasText: "withheld" }).count(), 0);
  });
  await check("a task, and each change to who reads it, is in the logs without its words", async () => {
    await signInAs(founder);
    await page.goto(`${site}/admin/logs?show=operations`);
    await page.locator(".log:visible").first().waitFor();
    const text = await logText();
    assert.match(text, /Ada Vance gave Training Ship its task for Escort 001\.\s+Read by the unit's commander\./);
    assert.match(text, /Kit Marlow changed who reads the task of Training Ship for Escort 001\.\s+Now the unit\. Before, the unit's commander\./);
    assert.doesNotMatch(text, /until the convoy is through/);
  });

  console.log("The force chart");
  const force = () => page.locator("form.force:visible");
  const forceNode = (name) =>
    force().locator(".force-node", { has: page.locator(".force-node-name b", { hasText: new RegExp(`^${name}`) }) });
  const tally = async () =>
    Object.fromEntries(
      (await force().locator(".force-tally div").allInnerTexts()).map((text) => {
        const [label, number] = text.trim().split(/\s+/);
        return [label.toLowerCase(), Number(number)];
      }),
    );
  await check("an admin says what a unit brings, and gives it one of the site's pictures", async () => {
    await signInAs(founder);
    await openEditor("Units");
    const ship = await openRecord("Task Force Jericho › Training Ship");
    assert.equal(await ship.getByLabel(/^What it brings/).inputValue(), "");
    assert.equal(await ship.getByLabel(/^Picture/).inputValue(), "");
    await ship.getByLabel(/^What it brings/).fill("Four turrets\nA medical bed");
    await ship.getByLabel(/^Picture/).selectOption({ label: "Helm" });
    await ship.getByRole("button", { name: "Save", exact: true }).click();
    await told(ship, "Saved.");
    assert.deepEqual(await one("select brings, picture from public.units where name = 'Training Ship'"), {
      brings: "Four turrets\nA medical bed",
      picture: "areaHelm",
    });
  });
  await check("an event's force is chosen from a chart of the order of battle, which adds up what it brings", async () => {
    await draftEvent("Patrol", "Escort 002");
    await page.getByRole("link", { name: "Change the details and orders" }).click();
    await editPart("Forces");
    await force().waitFor();
    const filled = async (where) =>
      (
        await one(
          `select count(distinct p.id)::int as n from public.positions p
           join public.units u on u.id = p.unit_id
           join public.assignments a on a.position_id = p.id and a.ended_on is null
           where p.kind = 'primary' and ${where}`,
        )
      ).n;
    const aboard = await filled("u.name = 'Training Ship'");
    const everyone = await filled("p.opens_at_stage <= 1 and u.opens_at_stage <= 1");
    assert.equal(aboard, 2);

    // With nothing added, the whole fleet takes part, and the sums are the fleet's.
    assert.match(await force().locator(".force-sum").innerText(), /No unit is added, so the whole fleet takes part\./);
    assert.deepEqual(await tally(), { posts: 7, filled: everyone, empty: 7 - everyone });
    assert.match(await forceNode("UEE 9th Fleet").innerText(), /Fleet\. 7 posts/);
    assert.equal(await forceNode("UEE 9th Fleet").getByRole("checkbox").count(), 0, "the fleet itself is not added: it is what none means");
    // A unit that opens at a later stage is drawn, and cannot be added.
    assert.match(await forceNode("UEES Nexus").innerText(), /Ship\. Opens at stage 2/);
    assert.equal(await forceNode("UEES Nexus").getByRole("checkbox").count(), 0);
    assert.equal(await forceNode("Gunnery").count(), 0, "what is under a unit that is not open yet is left off");

    // A unit with a picture is drawn with it, and its author is named. One without has the symbol for its kind.
    const ship = forceNode("Training Ship");
    assert.match(await ship.innerText(), /Ship\. 6 posts, 2 filled/);
    assert.equal(await ship.locator(".force-picture img").count(), 1);
    assert.match(await ship.locator(".force-picture .credit").innerText(), /Picture: Jon-Rellim/i);
    assert.equal(await ship.locator(".force-symbol").count(), 0);
    assert.ok((await forceNode("Task Force Jericho").locator(".force-symbol svg > *").count()) > 0, "a unit with no picture has no symbol");

    // Its posts, who fills them and what it brings open beneath it, before it is added.
    await ship.locator("summary").click();
    const more = (await ship.locator("details").innerText()).replace(/\s+/g, " ");
    assert.match(more, /Four turrets A medical bed/);
    assert.match(more, /Helmsman .*Kit Marlow/);
    assert.match(more, /Gunner 2 Empty/);

    await ship.getByLabel("Training Ship", { exact: true }).check();
    assert.deepEqual(await tally(), { posts: 6, filled: 2, empty: 4 });
    const sum = force().locator(".force-sum");
    assert.match((await sum.locator(".force-units").innerText()).replace(/\s+/g, " "), /^Training Ship 6 posts, 2 filled$/);
    assert.deepEqual(await sum.locator(".force-brings li").allInnerTexts(), ["Four turrets", "A medical bed"]);
    await told(force(), "Not saved yet.");
    await shot("operation-force");

    // Adding the formation above brings the ship with it, and takes over from it.
    await force().getByLabel("Task Force Jericho", { exact: true }).check();
    const carried = ship.getByRole("checkbox");
    assert.equal(await carried.isChecked(), true);
    assert.equal(await carried.isDisabled(), true);
    assert.match(await ship.locator(".force-pick").innerText(), /With Task Force Jericho/i);
    assert.match((await sum.locator(".force-units").innerText()).replace(/\s+/g, " "), /^Task Force Jericho 6 posts, 2 filled$/);
    await force().getByLabel("Task Force Jericho", { exact: true }).uncheck();
    assert.equal(await carried.isChecked(), false);
    assert.match(await sum.innerText(), /the whole fleet takes part/);

    await ship.getByLabel("Training Ship", { exact: true }).check();
    await force().getByRole("button", { name: "Save the force" }).click();
    await told(force(), "Saved.");
    const event = await eventTitled("Escort 002");
    assert.deepEqual(
      await supabase.sql("select u.name from public.event_units e join public.units u on u.id = e.unit_id where e.event_id = $1", [event.id]),
      [{ name: "Training Ship" }],
    );
    // The posts that can be marked as key are now the ship's.
    const key = page.locator("form.picks:visible", { hasText: "Posts that must be filled" });
    await key.getByLabel("Helmsman").waitFor();
    assert.equal(await key.getByRole("checkbox").count(), 6);
  });

  await check("no page raised a script error", async () => {
    assert.deepEqual(pageErrors, []);
  });
  await check("the stand-in understood every request the site made", async () => {
    const refused = await fetch(`${supabase.origin}/rest/v1/members?select=id&id=like.x`).then((r) => r.status);
    assert.equal(refused, 501, "an unknown kind of filter is refused, not guessed at");
    assert.equal(supabase.state.unsupported.length, 1, supabase.state.unsupported.join("\n"));
  });
} finally {
  await browser?.close();
  running?.stop();
  discordServer.close();
  await supabase.close();
}

finish(running?.log());
