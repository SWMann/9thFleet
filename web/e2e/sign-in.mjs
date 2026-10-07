// Signs in and out of the built site in a real browser, against a stand-in for
// Supabase. It proves the parts that only show up end to end: the hand-off to
// Discord and back, the session cookies, the redirects, and saving names.
//
// Run it with `npm run e2e`. It builds nothing: run `npm run build` first.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { startMockSupabase } from "./mock-supabase.mjs";

const SITE_PORT = 3111;
const MOCK_PORT = 54399;
const site = `http://localhost:${SITE_PORT}`;
const shotsDir = process.env.SHOTS_DIR;

const failures = [];
let passed = 0;
async function check(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${String(error.message).split("\n").join("\n        ")}`);
  }
}

const mock = await startMockSupabase(MOCK_PORT);
const setMock = (body) =>
  fetch(`${mock.origin}/__mock/set`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());

// Started in its own process group, so that stopping it also stops the worker
// processes it starts.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(SITE_PORT)], {
  env: { ...process.env, SUPABASE_URL: mock.origin, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_for_tests" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
function stopServer() {
  try {
    if (process.platform === "win32") server.kill();
    else process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
}
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));

async function waitForSite() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${site}/robots.txt`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The site did not start.\n${serverLog}`);
}

let browser;
try {
  await waitForSite();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const width = Number(process.env.VIEWPORT_WIDTH ?? 1280);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  const shot = async (name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: `${shotsDir}/${name}.png`, fullPage: true });
  };
  // The member's record arrives a moment after the page's frame, so wait for
  // the heading that is expected instead of reading whichever is there first.
  const headingIs = (text) =>
    page.locator("h1:visible").filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).waitFor();
  const nav = () => page.locator("nav[aria-label='Main']").innerText();
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
    assert.match(await nav(), /Sign in/);
    await shot("sign-in");
  });
  await check("leaving Discord early is explained", async () => {
    await page.goto(`${site}/auth/callback?error=access_denied`);
    assert.equal(new URL(page.url()).pathname, "/sign-in");
    assert.match(await page.locator(".notice").innerText(), /left Discord before finishing/);
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
    assert.match(await nav(), /Sign in/);
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
  stopServer();
  mock.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(serverLog.split("\n").slice(-30).join("\n"));
}
process.exit(failures.length > 0 ? 1 : 0);
