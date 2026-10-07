import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, session } from 'electron';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { keyBindId, type KeyBind } from '../shared/binds';
import { Channel, type AppInfo, type HookStatus, type NetKeyBind, type PttMessage } from '../shared/ipc';

// The window must keep working while the game covers it and holds focus.
// Without these, Chromium marks a covered window as hidden and stops timers and gamepad input.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const ESCAPE = `key:${UiohookKey.Escape}`;
const KEY_NAMES = new Map<number, string>(
  Object.entries(UiohookKey).map(([name, code]) => [code as number, name]),
);
const MOUSE_NAMES = new Map<number, string>([
  [3, 'Mouse middle button'],
  [4, 'Mouse button 4'],
  [5, 'Mouse button 5'],
]);

/**
 * `--smoke=<file>` starts the app, writes what it found to the file and exits.
 * The build pipeline uses it to prove that a packaged copy starts and can load its key hook.
 */
const smokeFile = process.argv.find((arg) => arg.startsWith('--smoke='))?.slice('--smoke='.length);

let win: BrowserWindow | null = null;
let hookStatus: HookStatus = { ok: false, detail: 'Not started' };
let capturing = false;
/** Input id ("key:57", "mouse:4") to net id. */
let binds = new Map<string, string>();
/** Inputs currently down. Stops key auto-repeat from sending a press more than once. */
const held = new Set<string>();

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function onDown(input: string, describe: () => KeyBind | null): void {
  if (held.has(input)) return;
  held.add(input);
  if (capturing) {
    if (input === ESCAPE) {
      capturing = false;
      send(Channel.captureCancelled);
      return;
    }
    const bind = describe();
    if (!bind) return;
    capturing = false;
    send(Channel.captured, bind);
    return;
  }
  const netId = binds.get(input);
  if (netId) send(Channel.ptt, { netId, down: true } satisfies PttMessage);
}

function onUp(input: string): void {
  if (!held.delete(input)) return;
  const netId = binds.get(input);
  if (netId) send(Channel.ptt, { netId, down: false } satisfies PttMessage);
}

function releaseAll(reason: string): void {
  held.clear();
  send(Channel.releaseAll, reason);
}

function startHook(): void {
  uIOhook.on('keydown', (event) => {
    const code = event.keycode;
    onDown(`key:${code}`, () => ({ kind: 'key', code, label: KEY_NAMES.get(code) ?? `Key ${code}` }));
  });
  uIOhook.on('keyup', (event) => onUp(`key:${event.keycode}`));
  uIOhook.on('mousedown', (event) => {
    const button = Number(event.button);
    // Left and right click are never push-to-talk: they would transmit on every click.
    if (!MOUSE_NAMES.has(button)) return;
    onDown(`mouse:${button}`, () => ({ kind: 'mouse', button, label: MOUSE_NAMES.get(button)! }));
  });
  uIOhook.on('mouseup', (event) => {
    const button = Number(event.button);
    if (MOUSE_NAMES.has(button)) onUp(`mouse:${button}`);
  });
  try {
    uIOhook.start();
    hookStatus = { ok: true, detail: 'Global key hook running' };
  } catch (error) {
    hookStatus = { ok: false, detail: `Global key hook failed: ${String(error)}` };
  }
  send(Channel.hookStatus, hookStatus);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0b1017',
    title: '9th Fleet Voice',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keeps timers, audio and the joystick poll alive when the game has focus.
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('closed', () => {
    win = null;
  });
  void win.loadFile(path.join(__dirname, 'index.html'));
}

function registerIpc(): void {
  ipcMain.on(Channel.setBinds, (_event, list: NetKeyBind[]) => {
    const next = new Map<string, string>();
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item.netId === 'string' && item.bind) next.set(keyBindId(item.bind), item.netId);
      }
    }
    binds = next;
  });
  ipcMain.on(Channel.startCapture, () => {
    capturing = true;
  });
  ipcMain.on(Channel.cancelCapture, () => {
    capturing = false;
  });
  ipcMain.handle(Channel.getInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    electron: process.versions.electron ?? 'unknown',
    hook: hookStatus,
  }));
  ipcMain.handle(Channel.saveLog, async (_event, text: string): Promise<string | null> => {
    if (!win) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const result = await dialog.showSaveDialog(win, {
      title: 'Save test log',
      defaultPath: `9th-fleet-voice-log-${stamp}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, String(text), 'utf8');
    return result.filePath;
  });
}

async function runSmokeCheck(file: string): Promise<void> {
  const result = { version: app.getVersion(), packaged: app.isPackaged, hook: hookStatus, nets: 0, error: '' };
  try {
    const contents = win?.webContents;
    if (!contents) throw new Error('No window');
    if (contents.isLoading()) {
      await new Promise<void>((resolve, reject) => {
        contents.once('did-finish-load', () => resolve());
        contents.once('did-fail-load', (_event, _code, description) => reject(new Error(description)));
      });
    }
    result.nets = Number(await contents.executeJavaScript("document.querySelectorAll('.net').length"));
  } catch (error) {
    result.error = String(error);
  }
  result.hook = hookStatus;
  await writeFile(file, JSON.stringify(result, null, 2), 'utf8');
  app.exit(result.hook.ok && result.nets === 2 && !result.error ? 0 : 1);
}

void app.whenReady().then(() => {
  // No menu, so no shortcut can reload or close the window mid-operation.
  // Start with --dev to keep the default menu and its developer tools.
  if (!process.argv.includes('--dev')) Menu.setApplicationMenu(null);
  // The window only ever needs the microphone.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });
  registerIpc();
  createWindow();
  startHook();
  // A key cannot be meaningfully held across a lock or sleep, and the release may never arrive.
  powerMonitor.on('lock-screen', () => releaseAll('screen locked'));
  powerMonitor.on('suspend', () => releaseAll('PC went to sleep'));
  if (smokeFile) void runSmokeCheck(smokeFile);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  try {
    uIOhook.stop();
  } catch {
    // Nothing to do: the process is ending.
  }
});
