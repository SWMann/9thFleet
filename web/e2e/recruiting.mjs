// Applies to join, and handles applications as staff, in a real browser
// against the fleet's real database rules.
//
// The stand-in for Supabase here runs the migrations in supabase/migrations in
// an in-memory PostgreSQL, so every refusal and every side effect in this test
// comes from the same rules the live database uses.
//
// Run it with `npm run e2e`. It builds nothing: run `npm run build` first.

import assert from "node:assert/strict";
import { createChecks, openBrowser, startSite } from "./harness.mjs";
import { startSupabaseWithDatabase } from "./supabase-with-database.mjs";

const SITE_PORT = 3112;
const DATABASE_PORT = 54398;

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

let running;
let browser;
try {
  running = await startSite({
    port: SITE_PORT,
    env: { SUPABASE_URL: supabase.origin, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_for_tests" },
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
    await page.getByLabel("Warning order").fill("Patrol the lane at 1900 UTC.\nCommander: Ada Vance.");
    await page.getByLabel("2 Mission").fill("Task Force Jericho will patrol the lane in order to deter piracy against traders.");
    await page.getByRole("button", { name: "Save the orders" }).click();
    await page.locator(".form-result").filter({ hasText: "Saved." }).waitFor();
    await shot("operation-edit");

    await openPatrol();
    assert.match(await page.locator(".orders").innerText(), /Commander: Ada Vance\./);
    await page.locator(".decisions summary", { hasText: /^Announce$/ }).click();
    await page.getByRole("button", { name: "Yes, announce it" }).click();
    await page.locator(".form-result").filter({ hasText: "Announced." }).waitFor();
    const event = await patrol();
    assert.equal(event.state, "announced");
    assert.ok(event.announced_at && event.roll_closes_at, "the database stamps the announcement and sets when the roll closes");
    await shot("operation-announced");
  });
  await check("members reply for themselves and can change their minds while the roll is open", async () => {
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result").filter({ hasText: "You are down as attending." }).waitFor();
    assert.match(await post("Fleet Commander").innerText(), /Confirmed/i);

    await signInAs(kit);
    await page.goto(`${site}/operations`);
    assert.match(await page.locator(".event", { hasText: "Patrol 001" }).innerText(), /Reply needed/i);
    await shot("operations");
    assert.match(await page.locator(".sequence").innerText(), /The roll closes 24 hours out/);
    await page.getByRole("link", { name: "Patrol 001" }).click();
    await headingIs("Patrol 001");
    assert.match(await page.locator(".orders").innerText(), /in order to deter piracy/);
    await page.getByRole("button", { name: "Not attending" }).click();
    await page.locator(".form-result").filter({ hasText: "You are down as not attending." }).waitFor();
    await page.getByRole("button", { name: "Attending", exact: true }).click();
    await page.locator(".form-result").filter({ hasText: "You are down as attending." }).waitFor();
    assert.equal((await lineOf(kit)).reply, "attending");
    // A recruit holds no post, so they attend as a spare hand.
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

    await post("Gunner 1").getByRole("button", { name: "Stand in" }).click();
    await page.getByText("You are standing in as Gunner 1 for the night.").waitFor();
    const line = await lineOf(kit);
    assert.equal(line.stand_in_set_by, (await memberOf(kit)).id);
    assert.match(await post("Gunner 1").innerText(), /Stand-in: Starman Recruit Kit Marlow/);
    // One post at a time.
    assert.equal(await page.getByRole("button", { name: "Stand in" }).count(), 0);
    await shot("operation-roll");
  });
  await check("whoever runs the event places a stand-in and takes one out", async () => {
    await signInAs(founder);
    await openPatrol();
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
    await page.getByRole("heading", { name: "After-action report" }).waitFor();
    assert.match(await page.locator("main").innerText(), /Filed by Lt\. Commander Ada Vance/);
    assert.match(await page.locator("main").innerText(), /Brief the fallback sooner\./);
    // Kit is told how they were recorded, and is not shown that Jo was marked absent.
    await page.getByText("The operation commander recorded you as present.").waitFor();
    assert.doesNotMatch(await page.locator("main").innerText(), /Absent|without notice/i);
    assert.equal(await page.getByRole("button").filter({ hasText: /Attending|Stand in|Place/ }).count(), 0);
    await shot("operation-done");
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
  // The filters are a plain form: choosing and pressing Show loads the page again at a new address.
  const showLog = async (choices, address) => {
    const filters = page.locator(".filters:visible");
    for (const [label, option] of Object.entries(choices)) await filters.getByLabel(label).selectOption({ label: option });
    await filters.getByRole("button", { name: "Show" }).click();
    await page.waitForURL(address);
    await page.locator(".filters:visible").waitFor();
  };
  await check("the logs are for admins, and nobody else is shown a line", async () => {
    // Staff, then command. Both are left signed in by the checks above.
    for (const person of [kit, jo]) {
      await signInAs(person);
      await page.goto(`${site}/admin/logs`);
      await leadIs(/This page is for admins\./);
      assert.equal(await page.locator(".log:visible, .filters:visible").count(), 0);
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
    assert.match(await page.locator(".log-line:visible").first().innerText(), /^\d\d:\d\d:\d\d UTC\s+Sign-in\s+Ada Vance signed in\.$/);
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
    await showLog({ Show: "Everything" }, /show=all/);
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
  await supabase.close();
}

finish(running?.log());
