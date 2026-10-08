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
  await check("an area lists its posts, their grades and when they open", async () => {
    await page.getByRole("link", { name: "Gunnery" }).click();
    await headingIs("Gunnery");
    await page.locator(".role-card").first().waitFor();
    assert.equal(await page.locator(".role-card").count(), 5);
    const open = await page.locator(".role-group", { hasText: "Training Ship" }).innerText();
    assert.match(open, /Open now/i);
    assert.match(open, /4 posts/);
    const turret = await page.locator(".role-card", { hasText: "Turret Gunner" }).innerText();
    assert.match(turret, /Opens at stage 2/i);
    assert.match(turret, /Entry post/i);
    assert.match(turret, /E2 to E4/);
    assert.match(turret, /7 posts/);
    await shot("roles-area");
  });
  await check("a role card shows the grade, what it needs and where it sits", async () => {
    await page.getByRole("link", { name: "Turret Gunner" }).click();
    await headingIs("Turret Gunner");
    const facts = await page.locator(".facts").innerText();
    assert.match(facts, /E2 to E4\s*Starman to Jr\. Petty Officer/);
    assert.match(facts, /UEE 9th Fleet › Task Force Jericho › UEES Nexus › Gunnery/);
    assert.match(facts, /At stage 2/);
    assert.match(facts, /Navy crew, Radio user/);
    assert.match(await page.locator(".cards").innerText(), /assessed radio exchange/);
    // What to read leads into the manual.
    await page.getByRole("link", { name: "Navy squadron" }).click();
    await headingIs("Navy squadron");
    await shot("roles-card");
  });
  await check("a duty is shown as a duty, with no rank", async () => {
    await page.goto(`${site}/roles/staff-duties/fleet-staff-recruiter`);
    await headingIs("Recruiter");
    const facts = await page.locator(".facts").innerText();
    assert.match(facts, /Secondary duty/);
    assert.match(facts, /E4\s+and above/);
    assert.doesNotMatch(await page.locator("main").innerText(), /Rank follows the post/);
  });
  await check("an area that opens later says so, and an unknown area is not found", async () => {
    await page.goto(`${site}/roles/boarding`);
    await headingIs("Boarding");
    await page.getByText("It opens at stage 6").waitFor();
    await page.goto(`${site}/roles/nothing-here`);
    await headingIs("Nothing heard.");
    await page.goto(`${site}/roles/gunnery/nothing-here`);
    await headingIs("Nothing heard.");
  });
  await check("the roles pages never name who holds a post", async () => {
    // Ada Vance holds Fleet Commander. A visitor is shown the post and not the person.
    await page.goto(`${site}/roles/command/fleet-command-fleet-commander`);
    await headingIs("Fleet Commander");
    await page.locator(".facts").waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /Ada|Vance|ada_on_discord/i);
    assert.match(await page.locator(".facts").innerText(), /Shown to serving members/);
  });
  await check("the database gives a visitor the structure and nothing about people", async () => {
    assert.ok((await asVisitor("units")).length > 0, "a visitor cannot read the units");
    assert.ok((await asVisitor("positions")).length > 0, "a visitor cannot read the posts");
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
