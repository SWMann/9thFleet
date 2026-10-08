// Signs in and out of the built site in a real browser, against a stand-in for
// Supabase. It proves the parts that only show up end to end: the hand-off to
// Discord and back, the session cookies, the redirects, and saving names.
//
// Run it with `npm run e2e`. It builds nothing: run `npm run build` first.

import assert from "node:assert/strict";
import { createChecks, openBrowser, startSite } from "./harness.mjs";
import { startMockSupabase } from "./mock-supabase.mjs";

const SITE_PORT = 3111;
const MOCK_PORT = 54399;

const { check, finish } = createChecks();

const mock = await startMockSupabase(MOCK_PORT);
const setMock = (body) =>
  fetch(`${mock.origin}/__mock/set`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());

let running;
let browser;
try {
  running = await startSite({
    port: SITE_PORT,
    env: { SUPABASE_URL: mock.origin, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_for_tests" },
  });
  const { site } = running;
  const opened = await openBrowser();
  browser = opened.browser;
  const { context, page, pageErrors, shot, headingIs, nav } = opened;

  const signIn = async () => {
    await page.goto(`${site}/sign-in`);
    await page.getByRole("button", { name: "Sign in with Discord" }).click();
    await page.waitForURL(`${site}/profile`);
  };

  console.log("Signed out");
  await check("the member page sends a signed-out visitor to sign-in", async () => {
    await page.goto(`${site}/profile`);
    assert.equal(new URL(page.url()).pathname, "/sign-in");
    await headingIs("Sign in");
    assert.match(await nav(), /Sign in/i);
    await shot("sign-in");
  });
  await check("the order of battle sends a signed-out visitor to sign-in", async () => {
    await page.goto(`${site}/order-of-battle`);
    assert.equal(new URL(page.url()).pathname, "/sign-in");
    assert.doesNotMatch(await nav(), /Fleet/i);
  });
  // The full-screen menu's links, read with it open.
  const menuLinks = async () => {
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    const menu = page.locator("dialog.menu[open]");
    await menu.waitFor();
    const labels = await menu.locator(".menu-column li a").allInnerTexts();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" }).catch(() => {});
    return labels.map((label) => label.trim());
  };
  await check("the full menu offers a signed-out visitor sign-in, not the member pages", async () => {
    await page.goto(`${site}/`);
    const labels = await menuLinks();
    assert.ok(labels.includes("Sign in"), `no Sign in among ${labels.join(", ")}`);
    assert.ok(!labels.includes("Your record") && !labels.includes("Order of battle"), labels.join(", "));
  });
  await check("leaving Discord early is explained", async () => {
    await page.goto(`${site}/auth/callback?error=access_denied`);
    assert.equal(new URL(page.url()).pathname, "/sign-in");
    assert.match(await page.locator(".notice").innerText(), /left Discord before finishing/);
  });
  await check("a fault in the sign-in service is not blamed on the visitor", async () => {
    // What Supabase sends back when Discord refuses its Client Secret.
    await page.goto(
      `${site}/auth/callback?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code`,
    );
    assert.equal(new URL(page.url()).pathname, "/sign-in");
    const notice = await page.locator(".notice").innerText();
    assert.match(notice, /fault on our side/);
    assert.doesNotMatch(notice, /left Discord/);
  });
  await check("a made-up code does not sign anyone in", async () => {
    await page.goto(`${site}/auth/callback?code=made-up`);
    assert.equal(new URL(page.url()).pathname, "/sign-in");
    assert.match(await page.locator(".notice").innerText(), /could not be completed/);
    await page.goto(`${site}/profile`);
    assert.equal(new URL(page.url()).pathname, "/sign-in");
  });

  console.log("The hand-off to Discord");
  const startButton = () => page.getByRole("button", { name: "Sign in with Discord" });
  const handOffs = () => mock.state.requests.filter((line) => line.endsWith(" /auth/v1/authorize"));
  await check("the button is a plain form post that the site answers with a redirect", async () => {
    await page.goto(`${site}/sign-in`);
    const form = page.locator("form", { has: startButton() });
    assert.equal(await form.getAttribute("method"), "post");
    assert.equal(await form.getAttribute("action"), "/auth/discord");
    const response = await fetch(`${site}/auth/discord`, { method: "POST", redirect: "manual", headers: { origin: site } });
    assert.equal(response.status, 303);
    assert.ok(response.headers.get("location").startsWith(`${mock.origin}/auth/v1/authorize?provider=discord`));
    assert.match(response.headers.get("set-cookie") ?? "", /code-verifier/, "the sign-in was not tied to this browser");
  });
  await check("another site cannot start a sign-in", async () => {
    const response = await fetch(`${site}/auth/discord`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: "https://elsewhere.example" },
    });
    assert.equal(response.status, 403);
    assert.equal((await fetch(`${site}/auth/discord`, { redirect: "manual" })).status, 405, "a plain visit must not start one");
  });
  await check("pressing Back from Discord and trying again starts a fresh sign-in", async () => {
    await setMock({ holdAtDiscord: true });
    try {
      await page.goto(`${site}/sign-in`);
      const before = handOffs().length;
      await startButton().click();
      await page.getByRole("heading", { name: "Discord stand-in" }).waitFor();
      await page.goBack();
      await headingIs("Sign in");
      await startButton().click();
      await page.getByRole("heading", { name: "Discord stand-in" }).waitFor();
      assert.deepEqual(handOffs().slice(before), ["GET /auth/v1/authorize", "GET /auth/v1/authorize"]);

      // Carrying on from Discord's page finishes the sign-in.
      await page.getByRole("link", { name: "Authorise" }).click();
      await page.waitForURL(`${site}/profile`);
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(`${site}/`);
    } finally {
      await setMock({ holdAtDiscord: false });
    }
  });

  console.log("Signing in");
  await check("signing in with Discord lands on the member's record", async () => {
    await signIn();
    await page.getByText("Applicant", { exact: true }).waitFor();
    await headingIs("Your record");
    assert.match(await page.locator("main").innerText(), /ada_on_discord/);
    assert.match(await page.locator("main").innerText(), /Recruitment opens on/);
    await shot("record-applicant");
  });
  await check("the session lives in cookies the browser sends back", async () => {
    const cookies = await context.cookies();
    const sessionCookies = cookies.filter((cookie) => /^sb-.*-auth-token/.test(cookie.name));
    assert.ok(sessionCookies.length > 0, "no session cookie was set");
    for (const cookie of sessionCookies) {
      assert.equal(cookie.httpOnly, true, `${cookie.name} can be read by scripts`);
      assert.equal(cookie.sameSite, "Lax");
    }
    const readable = await page.evaluate(() => document.cookie);
    assert.doesNotMatch(readable, /auth-token/, "a script in the page can read the session");
    assert.match(readable, /nf_signed_in=1/);
    await page.reload();
    await headingIs("Your record");
  });
  await check("the menu offers the record instead of sign-in", async () => {
    await page.goto(`${site}/`);
    await page.getByRole("link", { name: "Your record" }).click();
    await page.waitForURL(`${site}/profile`);
  });
  await check("the full menu lists the member pages once signed in", async () => {
    await page.goto(`${site}/`);
    const labels = await menuLinks();
    assert.ok(labels.includes("Your record") && labels.includes("Order of battle"), labels.join(", "));
    assert.ok(!labels.includes("Sign in"), "Sign in is still offered to a signed-in member");
  });
  await check("the sign-in page sends a signed-in member to their record", async () => {
    await page.goto(`${site}/sign-in`);
    assert.equal(new URL(page.url()).pathname, "/profile");
  });

  console.log("Names");
  const save = async (name, handle) => {
    if (name !== null) await page.getByLabel("Character name").fill(name);
    await page.getByLabel("RSI handle").fill(handle);
    await page.getByRole("button", { name: "Save" }).click();
  };
  const result = () => page.locator(".form-result");
  await check("a handle with a space is refused with a reason", async () => {
    // The browser's own checks are switched off so the server's answer is seen.
    await page.locator("form.fields").evaluate((form) => form.setAttribute("novalidate", ""));
    await save("Ada Vance", "ada vance");
    await result().filter({ hasText: "no spaces" }).waitFor();
    assert.equal(mock.state.member.rsi_handle, null, "nothing should have been saved");
  });
  await check("a name another member holds is refused", async () => {
    await page.locator("form.fields").evaluate((form) => form.setAttribute("novalidate", ""));
    await save("Taken Name", "AdaVance");
    await result().filter({ hasText: "Another member already has that character name." }).waitFor();
  });
  await check("good names are saved and the page shows them", async () => {
    await save("  Ada   Vance ", "AdaVance");
    await result().filter({ hasText: "Saved." }).waitFor();
    assert.deepEqual(
      { name: mock.state.member.character_name, handle: mock.state.member.rsi_handle },
      { name: "Ada Vance", handle: "AdaVance" },
    );
    await headingIs("Ada Vance");
    await shot("record-named");
  });

  console.log("A serving member");
  const fleetCommander = {
    member: {
      status: "member",
      service: "navy",
      grade_code: "O4",
      rank_name: "Lt. Commander",
      acting: false,
      position_title: "Fleet Commander",
      unit_name: "Fleet Command",
    },
    roles: ["instructor", "staff", "command", "admin"],
  };
  await check("rank, post and roles are shown, and the name is fixed", async () => {
    await setMock(fleetCommander);
    await page.reload();
    await headingIs("Lt. Commander Ada Vance");
    const text = await page.locator("main").innerText();
    for (const expected of ["Fleet Commander, Fleet Command.", "Full member", "Navy", "Instructor, Staff, Command, Admin"]) {
      assert.ok(text.includes(expected), `missing "${expected}"`);
    }
    assert.equal(await page.getByLabel("Character name").getAttribute("readonly"), "");
    assert.doesNotMatch(text, /Recruitment opens on/);
    await shot("record-fleet-commander");
  });
  await check("an acting rank says so", async () => {
    await setMock({ member: { acting: true, rank_name: "Lieutenant", grade_code: "O3", position_title: "Executive Officer", unit_name: "Bridge" } });
    await page.reload();
    await headingIs("Acting Lieutenant Ada Vance");
    await setMock(fleetCommander);
    await page.reload();
    await headingIs("Lt. Commander Ada Vance");
  });
  await check("the handle can still change once the name is fixed", async () => {
    await save(null, "Ada_Vance");
    await result().filter({ hasText: "Saved." }).waitFor();
    assert.equal(mock.state.member.rsi_handle, "Ada_Vance");
    assert.equal(mock.state.member.character_name, "Ada Vance");
  });

  console.log("Order of battle");
  const postId = (unitName, title) => {
    const unit = mock.orderOfBattle.units.find((row) => row.name === unitName);
    return mock.orderOfBattle.positions.find((row) => row.unit_id === unit.id && row.title === title).id;
  };
  const tally = async () =>
    Object.fromEntries(
      await page.locator(".tally > div").evaluateAll((items) =>
        items.map((item) => [item.querySelector("dt").textContent, Number(item.querySelector("dd").textContent)]),
      ),
    );
  const line = (unitName, title) =>
    page
      .locator("section.band", { has: page.getByRole("heading", { name: unitName, exact: true }) })
      .locator("li.post", { has: page.locator(".post-title", { hasText: new RegExp(`^${title}$`) }) });

  await check("an applicant is told the order of battle is for the serving fleet", async () => {
    await setMock({ member: { status: "applicant" } });
    await page.goto(`${site}/order-of-battle`);
    await page.getByText("is for the serving fleet").waitFor();
    assert.equal(await page.locator(".posts").count(), 0);
    await page.goto(`${site}/profile`);
    await page.getByText("Applicant", { exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "See the order of battle" }).count(), 0);
  });
  await check("a serving member reaches it from the menu and from their record", async () => {
    await setMock({
      ...fleetCommander,
      member: { ...fleetCommander.member, position_id: postId("Fleet Command", "Fleet Commander") },
      stage: 1,
      crew: [
        {
          member_id: "00000000-0000-4000-8000-000000000001",
          character_name: "Kit Marlow",
          rank_name: "Starman",
          acting: false,
          position_id: postId("Training Ship", "Helmsman"),
        },
        {
          member_id: "00000000-0000-4000-8000-000000000002",
          character_name: null,
          rank_name: "Starman",
          acting: false,
          position_id: null,
        },
      ],
      duties: [
        { member_id: "00000000-0000-4000-8000-000000000001", position_id: postId("Fleet Staff", "Recruiter") },
        { member_id: "00000000-0000-4000-8000-000000000002", position_id: postId("Fleet Staff", "Recruiter") },
      ],
    });
    await page.reload();
    await page.getByRole("link", { name: "See the order of battle" }).click();
    await page.waitForURL(`${site}/order-of-battle`);
    await headingIs("Order of battle");
    await page.goto(`${site}/`);
    await page.locator("nav[aria-label='Main']").getByRole("link", { name: "Fleet", exact: true }).click();
    await page.waitForURL(`${site}/order-of-battle`);
  });
  await check("it counts the posts that are open, filled, vacant and still to open", async () => {
    await page.locator(".tally").waitFor();
    assert.deepEqual(await tally(), { Stage: 1, "Posts open": 7, Filled: 2, Vacant: 5, "Opening later": 34 });
  });
  await check("it shows who holds each post, and marks your own", async () => {
    const yours = await line("Fleet Command", "Fleet Commander").innerText();
    assert.match(yours, /Lt\. Commander Ada Vance/);
    assert.match(yours, /You/);
    assert.match(yours, /O4 to O10/);

    const helm = await line("Training Ship", "Helmsman").innerText();
    assert.match(helm, /Starman Kit Marlow/);
    assert.match(helm, /Starman to Jr\. Petty Officer \(E2 to E4\)\. Entry post\. Needs Navy crew, Radio user\./);
    assert.doesNotMatch(helm, /You/);

    assert.match(await line("Training Ship", "Gunner 1").innerText(), /Vacant/);
    assert.match(
      await page.locator("section.band", { has: page.getByRole("heading", { name: "Training Ship" }) }).innerText(),
      /Navy\. 1 of 6 posts filled\./,
    );
  });
  await check("a duty lists everyone who holds it", async () => {
    const recruiter = await line("Fleet Staff", "Recruiter").innerText();
    assert.match(recruiter, /Duty, open to E4 and above/);
    assert.match(recruiter, /Starman Kit Marlow/);
    assert.match(recruiter, /Starman Name not set/);
    const instructor = await line("Fleet Staff", "Instructor").innerText();
    assert.match(instructor, /Nobody yet/);
    assert.match(instructor, /Duty\. Needs Instructor\./);
    assert.match(
      await page.locator("section.band", { has: page.getByRole("heading", { name: "Fleet Staff" }) }).innerText(),
      /2 duties open\./,
    );
  });
  await check("units and posts that open later are listed but tucked away", async () => {
    const nexus = page.locator("section.band", { has: page.getByRole("heading", { name: "UEES Nexus", exact: true }) });
    assert.match(await nexus.innerText(), /Ship, Navy\. Opens at stage 2\./);
    const executive = nexus.locator(".post-title", { hasText: "Executive Officer" });
    assert.equal(await executive.isVisible(), false);
    await nexus.getByText("Show its 25 posts").click();
    assert.equal(await executive.isVisible(), true);
    const text = await line("UEES Nexus", "Executive Officer").innerText();
    assert.match(text, /Needs Commission \(not when acting\)\./);
    assert.match(text, /Lieutenant Junior Grade to Lt\. Commander \(O2 to O4\)/);
    assert.match(text, /Opens at stage 2/);
    assert.match(await line("UEES Nexus", "Commanding Officer").first().innerText(), /Opens at stage 5/);

    const staff = page.locator("section.band", { has: page.getByRole("heading", { name: "Fleet Staff", exact: true }) });
    assert.equal(await staff.locator(".post-title", { hasText: "Planner" }).isVisible(), false);
    await staff.getByText("9 more open later").click();
    assert.match(await line("Fleet Staff", "Planner").innerText(), /Opens at stage 4/);
    await shot("order-of-battle-stage-1");
  });
  await check("a new stage opens the flagship's posts", async () => {
    await setMock({ stage: 2 });
    await page.reload();
    await page.locator(".tally").waitFor();
    assert.deepEqual(await tally(), { Stage: 2, "Posts open": 22, Filled: 2, Vacant: 20, "Opening later": 19 });
    assert.match(await line("UEES Nexus", "Executive Officer").innerText(), /Vacant/);
    const nexus = page.locator("section.band", { has: page.getByRole("heading", { name: "UEES Nexus", exact: true }) });
    const text = await nexus.innerText();
    assert.match(text, /0 of 15 posts filled/);
    assert.match(text, /Flight Deck\s*Opens at stage 3/i);
    assert.equal(await nexus.locator(".post-title", { hasText: "Commanding Officer" }).isVisible(), false);
    await shot("order-of-battle-stage-2");
    await setMock({ stage: 1, crew: [], duties: [] });
    // Back to the record, where the checks that follow start from.
    await page.goto(`${site}/profile`);
    await headingIs("Lt. Commander Ada Vance");
  });

  console.log("Session upkeep");
  await check("a session that has run out is renewed without signing in again", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${site}/`);
    await setMock({ nextLifetime: 5 });
    const before = mock.state.refreshes;
    await signIn();
    await page.reload();
    await headingIs("Lt. Commander Ada Vance");
    assert.ok(mock.state.refreshes > before, "the session was not renewed");
  });
  await check("an account with no record is told why", async () => {
    await setMock({ member: null });
    await page.reload();
    await headingIs("No record");
    await setMock({ member: { status: "applicant" } });
    await page.reload();
    await page.getByText("Applicant", { exact: true }).waitFor();
  });

  console.log("Signing out");
  await check("signing out ends the session", async () => {
    const before = mock.state.signOuts;
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${site}/`);
    assert.ok(mock.state.signOuts > before, "the sign-in service was not told");
    assert.match(await nav(), /Sign in/i);
    const left = (await context.cookies()).map((cookie) => cookie.name);
    assert.deepEqual(left.filter((name) => /auth-token|nf_signed_in/.test(name)), [], "cookies were left behind");
    await page.goto(`${site}/profile`);
    assert.equal(new URL(page.url()).pathname, "/sign-in");
  });

  await check("no page raised a script error", async () => {
    assert.deepEqual(pageErrors, []);
  });
} finally {
  await browser?.close();
  running?.stop();
  mock.close();
}

finish(running?.log());
