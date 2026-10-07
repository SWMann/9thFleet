// End-to-end test of the voice app.
//
// It starts a local LiveKit server and two real copies of the app ("Alpha" and "Bravo"),
// presses real operating-system keys so the global key hook is exercised, and listens to what
// reaches each ear on the receiving side. Microphones are Chromium's built-in fake device,
// which beeps, so no sound hardware is needed.
//
// What it cannot cover: a real game holding focus, anti-cheat, real joysticks and real audio
// devices. Those are what the Gate A session in docs/gate-a-test.md is for. Stick push-to-talk
// is exercised here with a stand-in for the Gamepad API.
//
// Needs: a LiveKit server binary (LIVEKIT_SERVER, default "livekit-server" on the PATH),
// Python 3, and on Linux an X display plus python-xlib (run under `xvfb-run -a`).
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VOICE = path.resolve(HERE, '..');
const OUT = path.join(VOICE, 'dist-test', 'e2e');
const WINDOWS = process.platform === 'win32';
const SERVER = process.env.LIVEKIT_SERVER || 'livekit-server';
const PYTHON = process.env.PYTHON || (WINDOWS ? 'python' : 'python3');
// Asking the electron package for its path also downloads the binary if it is not there yet.
const ELECTRON = createRequire(import.meta.url)('electron');
const SILENT = 0.001;
const AUDIBLE = 0.003;

mkdirSync(OUT, { recursive: true });
const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keys = (...args) => execFileSync(PYTHON, [path.join(HERE, 'keys.py'), ...args.map(String)]);
const keysAsync = (...args) => execFileAsync(PYTHON, [path.join(HERE, 'keys.py'), ...args.map(String)]);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

// The server writes to a file, never to a pipe: a full pipe would stall the server.
let server = null;
function startServer() {
  const log = openSync(path.join(OUT, 'livekit.log'), 'a');
  server = spawn(SERVER, ['--dev', '--bind', '127.0.0.1'], { stdio: ['ignore', log, log] });
  server.on('error', (error) => {
    console.error(`Could not start the LiveKit server "${SERVER}": ${error.message}`);
    process.exit(2);
  });
}

async function launch(name) {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [
      VOICE,
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--user-data-dir=${mkdtempSync(path.join(tmpdir(), `fleet-${name}-`))}`,
    ],
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.waitForSelector('.net');

  // Tap everything that reaches the speakers, one analyser per ear.
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect;
    let taps = null;
    AudioNode.prototype.connect = function (destination, ...rest) {
      if (destination instanceof AudioDestinationNode && !this.__tap) {
        const context = this.context;
        if (!taps) {
          const bus = context.createGain();
          bus.channelCount = 2;
          bus.channelCountMode = 'explicit';
          const splitter = context.createChannelSplitter(2);
          const left = context.createAnalyser();
          const right = context.createAnalyser();
          const sink = context.createGain();
          sink.gain.value = 0;
          sink.__tap = true;
          connect.call(bus, splitter);
          connect.call(splitter, left, 0);
          connect.call(splitter, right, 1);
          connect.call(left, sink);
          connect.call(right, sink);
          connect.call(sink, context.destination);
          taps = { bus, left, right };
        }
        connect.call(this, taps.bus);
      }
      return connect.call(this, destination, ...rest);
    };
    // Loudest level seen in each ear over a period.
    window.__listen = async (ms) => {
      if (!taps) return { left: 0, right: 0 };
      const buffer = new Float32Array(taps.left.fftSize);
      const level = (node) => {
        node.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        return Math.sqrt(sum / buffer.length);
      };
      let left = 0;
      let right = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        left = Math.max(left, level(taps.left));
        right = Math.max(right, level(taps.right));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { left, right };
    };
  });
  return { app, page, errors };
}

const net = (instance, index) => instance.page.locator('.net').nth(index);
const lamp = (instance, index) => net(instance, index).locator('.lamp').innerText();
const state = (instance, index) => net(instance, index).getAttribute('data-state');
const logText = (instance) => instance.page.locator('#log-lines').innerText();
const listen = (instance, ms) => instance.page.evaluate((period) => window.__listen(period), ms);
const show = (levels) => `left ${levels.left.toFixed(4)}, right ${levels.right.toFixed(4)}`;
const onlyLeft = (levels) => levels.left > AUDIBLE && levels.right < levels.left * 0.05;
const onlyRight = (levels) => levels.right > AUDIBLE && levels.left < levels.right * 0.05;
const silent = (levels) => levels.left < SILENT && levels.right < SILENT;
const resetCounts = (instance) => instance.page.getByRole('button', { name: 'Reset counts' }).click();
const sentRow = async (instance, row) =>
  (await instance.page.locator('#counts tbody tr').nth(row).locator('td').allInnerTexts()).map((text) => text.trim());
const heardRows = async (instance) =>
  (await instance.page.locator('#heard tbody tr').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim());
const bindLabel = (instance, netIndex, row) => net(instance, netIndex).locator('.net-row').nth(row).locator('.bind').innerText();
const setButton = (instance, netIndex, row) => net(instance, netIndex).locator('.net-row').nth(row).getByRole('button', { name: 'Set' });

async function bindKey(instance, netIndex, key) {
  await setButton(instance, netIndex, 0).click();
  await sleep(150);
  keys('down', key);
  await sleep(60);
  keys('up', key);
  await sleep(200);
  return bindLabel(instance, netIndex, 0);
}

let alpha;
let bravo;
try {
  startServer();
  await sleep(2500);

  const tokenOutput = execFileSync(
    process.execPath,
    ['scripts/token.mjs', '--room', 'e2e', '--hours', '1', 'Alpha', 'Bravo'],
    {
      cwd: VOICE,
      env: { ...process.env, LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' },
    },
  ).toString();
  const joinCodes = tokenOutput.split(/\r?\n/).filter((line) => line.startsWith('ws://'));
  check('token script prints one join code per name', joinCodes.length === 2);

  alpha = await launch('alpha');
  bravo = await launch('bravo');

  const health = await alpha.page.locator('#health').innerText();
  check('global key hook starts', /Key hook\s*running/.test(health), health.split('\n').slice(0, 2).join(' '));

  console.log('\nBinds');
  const binds = [await bindKey(alpha, 0, 'F5'), await bindKey(alpha, 1, 'F6'), await bindKey(bravo, 0, 'F7'), await bindKey(bravo, 1, 'F8')];
  check('keys are captured through the global hook', binds.join(',') === 'F5,F6,F7,F8', binds.join(','));

  await setButton(alpha, 0, 0).click();
  await sleep(100);
  keys('down', 'Escape');
  keys('up', 'Escape');
  await sleep(200);
  check('Escape cancels key capture and keeps the old bind', (await bindLabel(alpha, 0, 0)) === 'F5');

  // A stand-in for the Gamepad API: the app's stick code runs, the operating system part does not.
  await alpha.page.evaluate(() => {
    window.__pad = {
      index: 0,
      id: 'VKB-Sim Gladiator NXT R (Vendor: 231d Product: 0200)',
      connected: true,
      buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })),
      axes: [],
    };
    window.__padPlugged = true;
    navigator.getGamepads = () => (window.__padPlugged ? [window.__pad, null, null, null] : [null, null, null, null]);
  });
  const stick = (button, down) =>
    alpha.page.evaluate(([index, pressed]) => {
      window.__pad.buttons[index].pressed = pressed;
    }, [button, down]);

  await setButton(alpha, 0, 1).click();
  await stick(4, true);
  await sleep(120);
  await stick(4, false);
  await sleep(120);
  check('stick button is captured and named', (await bindLabel(alpha, 0, 1)) === 'VKB-Sim Gladiator NXT R, button 5', await bindLabel(alpha, 0, 1));
  check('capturing a bind is not counted as a press', (await sentRow(alpha, 1)).slice(1, 4).join(',') === '0,0,0');
  await setButton(alpha, 1, 1).click();
  await alpha.page.keyboard.press('Escape');
  await sleep(120);
  check('Escape cancels stick capture', (await bindLabel(alpha, 1, 1)) === 'Not set');
  check('stick is listed under input health', /VKB-Sim Gladiator NXT R \(12 buttons\)/.test(await alpha.page.locator('#health').innerText()));

  console.log('\nNot connected');
  keys('down', 'F5');
  await sleep(200);
  check('a held key shows on its net', (await state(alpha, 0)) === 'held', await lamp(alpha, 0));
  keys('up', 'F5');
  await sleep(200);
  check('release clears it', (await state(alpha, 0)) === 'idle');
  await resetCounts(alpha);

  console.log('\nConnected');
  for (const [instance, code] of [[alpha, joinCodes[0]], [bravo, joinCodes[1]]]) {
    await instance.page.fill('#join-code', code);
    await instance.page.click('#connect');
    await instance.page.waitForSelector('#link[data-state="connected"]', { timeout: 30000 });
  }
  await sleep(1500);
  const roster = await bravo.page.locator('#roster').innerText();
  check('both members see each other', /Alpha/.test(roster) && /Bravo \(you\)/.test(roster), roster.replace(/\n/g, ' | '));
  let levels = await listen(bravo, 2500);
  check('nothing is heard before a key is pressed', silent(levels), show(levels));

  keys('down', 'F5');
  await sleep(400);
  check('sender shows TRANSMITTING on net 1', (await state(alpha, 0)) === 'live', await lamp(alpha, 0));
  check('receiver shows who is on net 1', (await lamp(bravo, 0)) === 'RECEIVING Alpha', await lamp(bravo, 0));
  check('receiver net 2 stays idle', (await state(bravo, 1)) === 'idle');
  levels = await listen(bravo, 3000);
  check('net 1 arrives in the left ear only', onlyLeft(levels), show(levels));
  keys('up', 'F5');
  await sleep(500);
  check('on release both ends go idle', (await state(alpha, 0)) === 'idle' && (await state(bravo, 0)) === 'idle');
  levels = await listen(bravo, 2500);
  check('on release the receiver hears silence', silent(levels), show(levels));

  keys('down', 'F6');
  await sleep(400);
  check('receiver shows who is on net 2', (await lamp(bravo, 1)) === 'RECEIVING Alpha', await lamp(bravo, 1));
  levels = await listen(bravo, 3000);
  check('net 2 arrives in the right ear only', onlyRight(levels), show(levels));
  keys('down', 'F5');
  await sleep(200);
  check('a second net is refused while transmitting', /REFUSED Net 1 by key: Net 2 is transmitting/.test(await logText(alpha)) && (await state(alpha, 0)) === 'idle');
  keys('up', 'F6');
  await sleep(300);
  check('the refused key does not take over after release', (await state(alpha, 0)) === 'idle' && (await state(alpha, 1)) === 'idle');
  keys('up', 'F5');
  await sleep(300);

  console.log('\nStick');
  await resetCounts(alpha);
  await stick(4, true);
  await sleep(500);
  check('stick button transmits on its net', (await state(alpha, 0)) === 'live' && (await lamp(bravo, 0)) === 'RECEIVING Alpha');
  keys('down', 'F5');
  await sleep(150);
  await stick(4, false);
  await sleep(300);
  check('still transmitting while the key for the same net is held', (await state(alpha, 0)) === 'live');
  keys('up', 'F5');
  await sleep(400);
  check('stops when both are released', (await state(alpha, 0)) === 'idle' && (await state(bravo, 0)) === 'idle');
  const separate = [(await sentRow(alpha, 0)).slice(1, 4).join(','), (await sentRow(alpha, 1)).slice(1, 4).join(',')];
  check('key and stick are counted separately', separate.join(' ; ') === '1,1,0 ; 1,1,0', separate.join(' ; '));
  await stick(4, true);
  await sleep(500);
  await alpha.page.evaluate(() => {
    window.__padPlugged = false;
  });
  await sleep(500);
  check('unplugging the stick ends the transmission', (await state(alpha, 0)) === 'idle' && (await state(bravo, 0)) === 'idle');
  await alpha.page.evaluate(() => {
    window.__pad.buttons[4].pressed = false;
    window.__padPlugged = true;
  });
  await sleep(300);

  console.log('\nListening controls');
  keys('down', 'F7');
  await sleep(400);
  check('the other direction works', (await lamp(alpha, 0)) === 'RECEIVING Bravo', await lamp(alpha, 0));
  keys('up', 'F7');
  await sleep(400);

  await net(bravo, 1).getByLabel('Monitor').uncheck();
  await sleep(800);
  keys('down', 'F6');
  await sleep(400);
  levels = await listen(bravo, 2500);
  check('an unmonitored net is silent and not shown', silent(levels) && (await state(bravo, 1)) === 'idle', `${show(levels)}, ${await lamp(bravo, 1)}`);
  keys('up', 'F6');
  await sleep(300);
  await net(bravo, 1).getByLabel('Monitor').check();
  await sleep(1000);
  keys('down', 'F6');
  await sleep(500);
  levels = await listen(bravo, 3000);
  check('monitoring again restores the net', onlyRight(levels) && (await lamp(bravo, 1)) === 'RECEIVING Alpha', show(levels));
  keys('up', 'F6');
  await sleep(400);

  await net(bravo, 0).getByLabel('Net 1 ear').selectOption('right');
  keys('down', 'F5');
  await sleep(400);
  levels = await listen(bravo, 3000);
  check('changing the ear moves the net', onlyRight(levels), show(levels));
  keys('up', 'F5');
  await sleep(300);
  await net(bravo, 0).getByLabel('Net 1 ear').selectOption('left');

  console.log('\nRelease reliability');
  await resetCounts(alpha);
  await resetCounts(bravo);
  await keysAsync('taps', 50, 300, 250, 'F5');
  await sleep(1000);
  const fifty = await sentRow(alpha, 0);
  check('50 presses give 50 releases and no cuts', fifty.slice(1, 4).join(',') === '50,50,0', fifty.join(' | '));
  const heard = await heardRows(bravo);
  check('the receiver logged 50 separate transmissions', /^Alpha on Net 1 50 /.test(heard[0] ?? ''), heard.join(' ; '));
  check('the sender is idle after the run', (await state(alpha, 0)) === 'idle' && (await state(alpha, 1)) === 'idle');

  await resetCounts(alpha);
  await keysAsync('taps', 30, 15, 15, 'F6');
  await sleep(1500);
  const fast = await sentRow(alpha, 2);
  check('30 very fast taps all end closed', fast.slice(1, 4).join(',') === '30,30,0' && (await state(alpha, 1)) === 'idle', fast.join(' | '));
  levels = await listen(bravo, 2000);
  check('no transmission is left open after fast taps', silent(levels) && (await state(bravo, 1)) === 'idle', show(levels));

  check('no script errors in either window', alpha.errors.length + bravo.errors.length === 0, [...alpha.errors, ...bravo.errors].join(' ;; ').slice(0, 500));

  console.log('\nLink loss');
  server.kill('SIGKILL');
  await sleep(1500);
  const during = await alpha.page.locator('#link').getAttribute('data-state');
  startServer();
  await alpha.page.waitForSelector('#link[data-state="connected"]', { timeout: 60000 });
  await bravo.page.waitForSelector('#link[data-state="connected"]', { timeout: 60000 });
  await sleep(3000);
  check('a lost link is shown and both recover unaided', during === 'reconnecting', `state during the outage: ${during}`);
  keys('down', 'F5');
  await sleep(600);
  const lampAfter = await lamp(bravo, 0);
  levels = await listen(bravo, 3000);
  check('after recovery net 1 still works in the left ear', lampAfter === 'RECEIVING Alpha' && onlyLeft(levels), `${lampAfter}, ${show(levels)}`);
  keys('up', 'F5');
  await sleep(500);
  keys('down', 'F8');
  await sleep(600);
  const lampBack = await lamp(alpha, 1);
  keys('up', 'F8');
  await sleep(500);
  check('after recovery the other direction works on net 2', lampBack === 'RECEIVING Bravo', lampBack);

  keys('down', 'F5');
  await sleep(400);
  await alpha.page.click('#connect');
  await sleep(1200);
  check('disconnecting while keyed ends the transmission', (await state(bravo, 0)) === 'idle' && /CUT BY APP/.test(await logText(alpha)));
  keys('up', 'F5');
  await sleep(300);
  check('the receiver sees the member leave', !/Alpha/.test(await bravo.page.locator('#roster').innerText()));

  await alpha.page.screenshot({ path: path.join(OUT, 'alpha.png') });
  await bravo.page.screenshot({ path: path.join(OUT, 'bravo.png') });
} catch (error) {
  console.error('\nTEST RUN FAILED', error);
  results.push({ name: 'test run completes', ok: false });
  for (const [name, instance] of [['Alpha', alpha], ['Bravo', bravo]]) {
    if (!instance) continue;
    console.log(`--- ${name} log ---\n${await logText(instance).catch(() => '(unavailable)')}`);
    console.log(`--- ${name} errors ---\n${instance.errors.join('\n')}`);
  }
} finally {
  await alpha?.app.close().catch(() => undefined);
  await bravo?.app.close().catch(() => undefined);
  server?.kill('SIGKILL');
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
if (failed.length > 0) console.log(`Server log: ${path.join(OUT, 'livekit.log')}`);
process.exit(failed.length > 0 ? 1 : 0);
