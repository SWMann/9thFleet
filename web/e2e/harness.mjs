// What every browser test needs: the built site running against a stand-in for
// Supabase, a browser pointed at it, and a way to record each check.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

/** Runs checks one after another and keeps count. A failed check does not stop the rest. */
export function createChecks() {
  const failures = [];
  let passed = 0;
  return {
    async check(name, run) {
      try {
        await run();
        passed += 1;
        console.log(`  ok    ${name}`);
      } catch (error) {
        failures.push(name);
        console.log(`  FAIL  ${name}\n        ${String(error.message).split("\n").join("\n        ")}`);
      }
    },
    /** Print the result and end the process with the right exit code. */
    finish(serverLog = "") {
      console.log(`\n${passed} passed, ${failures.length} failed`);
      if (failures.length > 0) console.log(serverLog.split("\n").slice(-30).join("\n"));
      process.exit(failures.length > 0 ? 1 : 0);
    },
  };
}

/** Start the built site (`npm run build` first) with the given settings. */
export async function startSite({ port, env }) {
  const site = `http://localhost:${port}`;
  // Started in its own process group, so that stopping it also stops the
  // worker processes it starts.
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));
  const stop = () => {
    try {
      if (process.platform === "win32") server.kill();
      else process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${site}/robots.txt`);
      if (response.ok) return { site, stop, log: () => log };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stop();
  throw new Error(`The site did not start.\n${log}`);
}

/**
 * Open a browser page. VIEWPORT_WIDTH sets its width, and SHOTS_DIR, if set,
 * is where `shot(name)` saves a picture of the whole page.
 */
export async function openBrowser() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const width = Number(process.env.VIEWPORT_WIDTH ?? 1280);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  const shotsDir = process.env.SHOTS_DIR;
  const shot = async (name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: `${shotsDir}/${name}.png`, fullPage: true });
  };
  // A page's record arrives a moment after its frame, so wait for the heading
  // that is expected instead of reading whichever is there first.
  const headingIs = (text) =>
    page
      .locator("h1:visible")
      .filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
      .waitFor();
  const nav = () => page.locator("nav[aria-label='Main']").innerText();

  return { browser, context, page, pageErrors, shot, headingIs, nav };
}
