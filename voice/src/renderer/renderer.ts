import { keyBindId, padBindId, shortPadName, type KeyBind, type PadBind } from '../shared/binds';
import type { AppInfo, FleetApi, HookStatus } from '../shared/ipc';
import { parseJoinCode, PttArbiter, summarise, type Ear, type PttSource } from '../shared/nets';
import { PadWatcher, type PadButton } from './pad';
import { loadSettings, saveSettings, type NetSettings } from './settings';
import { cutTone, permitTone, refusedTone } from './tones';
import { VoiceSession, type LinkState } from './voice';

declare global {
  interface Window {
    fleet: FleetApi;
  }
}

/** A transmission is cut after this long, in case a key release never arrives. */
const MAX_TX_MS = 60_000;
const MAX_LOG_LINES = 2000;
const SHOWN_LOG_LINES = 400;

function $<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

const settings = loadSettings();
const arbiter = new PttArbiter();

/** Net whose microphone track is open right now. */
let live: string | null = null;
let liveSource: PttSource | null = null;
/** Net whose key is held while there is no connection. Shown so keys can be tested offline. */
let heldOffline: string | null = null;
/** Bumped on every start and stop, so a slow start can tell it has been overtaken by a release. */
let txSequence = 0;
let txTimer: number | null = null;

let capture: { netId: string; kind: 'key' | 'pad' } | null = null;
let info: AppInfo | null = null;
let hook: HookStatus = { ok: false, detail: 'Starting' };
let lastKeyInput = 'none yet';
let lastPadInput = 'none yet';
let padGap = 0;

interface Count {
  presses: number;
  releases: number;
  cuts: number;
  toLive: number[];
  toClosed: number[];
}

const counts = new Map<string, Count>();
const heard = new Map<string, { name: string; netId: string; count: number; longest: number }>();
const logLines: string[] = [];

function countFor(netId: string, source: PttSource): Count {
  const key = `${netId}:${source}`;
  let count = counts.get(key);
  if (!count) {
    count = { presses: 0, releases: 0, cuts: 0, toLive: [], toClosed: [] };
    counts.set(key, count);
  }
  return count;
}

function netName(netId: string): string {
  return settings.nets.find((net) => net.id === netId)?.name ?? netId;
}

function sourceName(source: PttSource): string {
  return source === 'key' ? 'key' : 'stick';
}

function clock(): string {
  const now = new Date();
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

function focusNote(): string {
  return document.hasFocus() ? 'app focused' : 'app in background';
}

function log(line: string): void {
  logLines.push(`${clock()}  ${line}`);
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
  const view = $<HTMLPreElement>('log-lines');
  const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
  view.textContent = logLines.slice(-SHOWN_LOG_LINES).join('\n');
  if (atBottom) view.scrollTop = view.scrollHeight;
}

// ---------------------------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------------------------

const voice = new VoiceSession({
  onState: (state, detail) => onLinkState(state, detail),
  onRoster: () => {
    renderNets();
    renderRoster();
  },
  onLog: (line) => log(line),
  onReceived: (name, netId, seconds) => {
    const key = `${name}\u0000${netId}`;
    const entry = heard.get(key) ?? { name, netId, count: 0, longest: 0 };
    entry.count += 1;
    entry.longest = Math.max(entry.longest, seconds);
    heard.set(key, entry);
    log(`HEARD ${name} on ${netName(netId)} for ${seconds.toFixed(1)} s`);
    renderHeard();
  },
});

let meterSource: MediaStreamAudioSourceNode | null = null;
let meterAnalyser: AnalyserNode | null = null;
const meterBuffer = new Float32Array(1024);

function onLinkState(state: LinkState, detail: string): void {
  if (state !== 'connected') forceRelease(state === 'reconnecting' ? 'link reconnecting' : 'link closed');

  meterSource?.disconnect();
  meterSource = null;
  meterAnalyser = null;
  if (state === 'connected' && voice.micStream) {
    meterAnalyser = new AnalyserNode(voice.audio, { fftSize: 1024 });
    meterSource = voice.audio.createMediaStreamSource(voice.micStream);
    meterSource.connect(meterAnalyser);
  }

  const pill = $('link');
  pill.dataset.state = state;
  const labels: Record<LinkState, string> = {
    disconnected: 'Not connected',
    connecting: 'Connecting',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
  };
  pill.textContent = labels[state];

  const button = $<HTMLButtonElement>('connect');
  button.textContent = state === 'disconnected' ? 'Connect' : 'Disconnect';
  $<HTMLInputElement>('join-code').disabled = state !== 'disconnected';
  $<HTMLSelectElement>('mic').disabled = state !== 'disconnected';

  if (state === 'connected') {
    setJoinStatus(`In room "${voice.roomName}" as ${voice.selfName}.`, false);
  } else if (state === 'disconnected') {
    setJoinStatus(detail ? `Disconnected: ${detail}` : 'Paste the join code you were sent, then connect.', Boolean(detail));
  } else {
    setJoinStatus(labels[state] + '…', false);
  }
  renderNets();
  renderRoster();
}

function setJoinStatus(text: string, isError: boolean): void {
  const status = $('join-status');
  status.textContent = text;
  status.className = isError ? 'error' : 'muted';
}

async function toggleConnection(): Promise<void> {
  if (voice.linkState !== 'disconnected') {
    forceRelease('disconnect');
    await voice.disconnect();
    return;
  }
  const input = $<HTMLInputElement>('join-code');
  const parsed = parseJoinCode(input.value);
  if (!parsed) {
    setJoinStatus('That is not a join code. It is one line that starts wss:// and has a # in the middle.', true);
    return;
  }
  settings.joinCode = input.value.trim();
  saveSettings(settings);
  try {
    await voice.connect(parsed.url, parsed.token, settings.micId, settings.nets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`ERROR could not connect: ${message}`);
    setJoinStatus(`Could not connect: ${message}`, true);
  }
}

// ---------------------------------------------------------------------------------------------
// Push-to-talk
// ---------------------------------------------------------------------------------------------

function handlePtt(netId: string, source: PttSource, down: boolean): void {
  const at = performance.now();
  if (!settings.nets.some((net) => net.id === netId)) return;
  // Count only real edges: a press that is not already held, a release of something held.
  if (down === arbiter.holds(netId, source)) return;
  const count = countFor(netId, source);
  if (down) count.presses += 1;
  else count.releases += 1;

  const action = down ? arbiter.press(netId, source) : arbiter.release(netId, source);
  if (action.type === 'start') {
    void startTx(action.netId, source, at);
  } else if (action.type === 'stop') {
    void stopTx(action.netId, source, at, 'released');
  } else if (action.type === 'blocked') {
    refusedTone(voice.audio);
    log(`REFUSED ${netName(netId)} by ${sourceName(source)}: ${netName(action.activeNetId)} is transmitting`);
  }
  renderCounts();
}

async function startTx(netId: string, source: PttSource, at: number): Promise<void> {
  const sequence = ++txSequence;
  if (voice.linkState !== 'connected') {
    heldOffline = netId;
    log(`KEY DOWN ${netName(netId)} by ${sourceName(source)} (${focusNote()}, not connected so nothing is sent)`);
    renderNets();
    return;
  }
  try {
    await voice.key(netId);
  } catch (error) {
    refusedTone(voice.audio);
    log(`ERROR could not open the microphone on ${netName(netId)}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (sequence !== txSequence) {
    // Released while the microphone was opening.
    await voice.unkey(netId);
    return;
  }
  live = netId;
  liveSource = source;
  const elapsed = performance.now() - at;
  countFor(netId, source).toLive.push(elapsed);
  if (settings.permitTone) permitTone(voice.audio);
  log(`TX START ${netName(netId)} by ${sourceName(source)} (${focusNote()}, live in ${elapsed.toFixed(1)} ms)`);
  txTimer = window.setTimeout(() => forceRelease('60 second limit'), MAX_TX_MS);
  renderNets();
  renderRoster();
  renderCounts();
}

async function stopTx(netId: string, source: PttSource | null, at: number, why: string): Promise<void> {
  txSequence += 1;
  if (txTimer !== null) {
    window.clearTimeout(txTimer);
    txTimer = null;
  }
  const wasLive = live === netId;
  const wasOffline = heldOffline === netId;
  live = null;
  liveSource = null;
  heldOffline = null;
  renderNets();
  // Always close the track, whatever this app believes its state to be.
  await voice.unkey(netId);
  if (wasLive) {
    const elapsed = performance.now() - at;
    if (source) countFor(netId, source).toClosed.push(elapsed);
    log(`TX END ${netName(netId)} (${why}, closed in ${elapsed.toFixed(1)} ms)`);
  } else if (wasOffline) {
    log(`KEY UP ${netName(netId)}`);
  }
  renderRoster();
  renderCounts();
}

/** Ends any transmission without waiting for the key. Used when the app cannot trust the key state. */
function forceRelease(reason: string): void {
  const wasLive = live;
  const source = liveSource;
  const action = arbiter.releaseAll();
  if (action.type !== 'stop') return;
  if (wasLive === action.netId && source) {
    countFor(action.netId, source).cuts += 1;
    cutTone(voice.audio);
  }
  void stopTx(action.netId, null, performance.now(), `CUT BY APP: ${reason}`);
}

// ---------------------------------------------------------------------------------------------
// Inputs and binds
// ---------------------------------------------------------------------------------------------

const pads = new PadWatcher(
  (button, down) => onPadButton(button, down),
  () => renderHealth(),
);

function onPadButton(button: PadButton, down: boolean): void {
  if (down) lastPadInput = `${shortPadName(button.padId)} button ${button.button + 1} at ${clock()} (${focusNote()})`;
  const id = padBindId(button);
  const net = settings.nets.find((item) => item.padBind && padBindId(item.padBind) === id);
  if (net) handlePtt(net.id, 'pad', down);
}

function pushKeyBinds(): void {
  window.fleet.setBinds(
    settings.nets.flatMap((net) => (net.keyBind ? [{ netId: net.id, bind: net.keyBind }] : [])),
  );
}

function beginCapture(netId: string, kind: 'key' | 'pad'): void {
  cancelCapture();
  capture = { netId, kind };
  if (kind === 'key') {
    window.fleet.startCapture();
  } else {
    pads.beginCapture((bind) => finishPadCapture(bind));
  }
  renderNets();
}

function cancelCapture(): void {
  if (!capture) return;
  if (capture.kind === 'key') window.fleet.cancelCapture();
  else pads.endCapture();
  capture = null;
  renderNets();
}

function finishKeyCapture(bind: KeyBind): void {
  if (!capture || capture.kind !== 'key') return;
  const id = keyBindId(bind);
  for (const net of settings.nets) {
    if (net.keyBind && keyBindId(net.keyBind) === id) net.keyBind = null;
  }
  const net = settings.nets.find((item) => item.id === capture!.netId);
  if (net) net.keyBind = bind;
  capture = null;
  saveSettings(settings);
  pushKeyBinds();
  log(`BIND ${net?.name ?? '?'} key set to ${bind.label}`);
  renderNets();
}

function finishPadCapture(bind: PadBind): void {
  if (!capture || capture.kind !== 'pad') return;
  const id = padBindId(bind);
  for (const net of settings.nets) {
    if (net.padBind && padBindId(net.padBind) === id) net.padBind = null;
  }
  const net = settings.nets.find((item) => item.id === capture!.netId);
  if (net) net.padBind = bind;
  capture = null;
  saveSettings(settings);
  log(`BIND ${net?.name ?? '?'} stick set to ${bind.label}`);
  renderNets();
}

function clearBind(net: NetSettings, kind: 'key' | 'pad'): void {
  if (kind === 'key') net.keyBind = null;
  else net.padBind = null;
  saveSettings(settings);
  pushKeyBinds();
  renderNets();
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

interface NetView {
  card: HTMLElement;
  lamp: HTMLElement;
  keyLabel: HTMLElement;
  keySet: HTMLButtonElement;
  padLabel: HTMLElement;
  padSet: HTMLButtonElement;
}

const netViews = new Map<string, NetView>();

function buildNets(): void {
  const host = $('nets');
  host.replaceChildren();
  for (const net of settings.nets) {
    const card = el('section', 'panel net');
    card.dataset.state = 'idle';

    const head = el('div', 'net-head');
    head.append(el('span', 'net-name', net.name));
    const lamp = el('span', 'lamp', 'Idle');
    head.append(lamp);
    card.append(head);

    const bindRow = (title: string, kind: 'key' | 'pad') => {
      const row = el('div', 'net-row');
      row.append(el('span', 'key', title));
      const label = el('span', 'bind unset', 'Not set');
      const set = el('button', 'small', 'Set');
      set.type = 'button';
      set.addEventListener('click', () => {
        if (capture && capture.netId === net.id && capture.kind === kind) cancelCapture();
        else beginCapture(net.id, kind);
      });
      const clear = el('button', 'small', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => clearBind(net, kind));
      row.append(label, set, clear);
      card.append(row);
      return { label, set };
    };
    const key = bindRow('Talk key', 'key');
    const pad = bindRow('Talk stick button', 'pad');

    const listen = el('div', 'listen');
    const monitorLabel = el('label', 'check');
    const monitor = el('input');
    monitor.type = 'checkbox';
    monitor.checked = net.monitor;
    monitor.addEventListener('change', () => {
      net.monitor = monitor.checked;
      saveSettings(settings);
      voice.applyNets(settings.nets);
      renderNets();
    });
    monitorLabel.append(monitor, 'Monitor');

    const ear = el('select');
    ear.setAttribute('aria-label', `${net.name} ear`);
    for (const [value, text] of [['left', 'Left ear'], ['right', 'Right ear'], ['both', 'Both ears']] as const) {
      const option = el('option', '', text);
      option.value = value;
      ear.append(option);
    }
    ear.value = net.ear;
    ear.addEventListener('change', () => {
      net.ear = ear.value as Ear;
      saveSettings(settings);
      voice.applyNets(settings.nets);
    });

    const volume = el('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.value = String(Math.round(net.volume * 100));
    volume.setAttribute('aria-label', `${net.name} volume`);
    volume.addEventListener('input', () => {
      net.volume = Number(volume.value) / 100;
      saveSettings(settings);
      voice.applyNets(settings.nets);
    });

    listen.append(monitorLabel, ear, volume);
    card.append(listen);
    host.append(card);
    netViews.set(net.id, {
      card,
      lamp,
      keyLabel: key.label,
      keySet: key.set,
      padLabel: pad.label,
      padSet: pad.set,
    });
  }
}

function renderNets(): void {
  for (const net of settings.nets) {
    const view = netViews.get(net.id);
    if (!view) continue;

    const talkers = voice.talkers(net.id);
    let state = 'idle';
    let lamp = net.monitor ? 'Idle' : 'Not monitored';
    if (live === net.id) {
      state = 'live';
      lamp = 'TRANSMITTING';
    } else if (heldOffline === net.id) {
      state = 'held';
      lamp = 'KEY HELD, NOT CONNECTED';
    } else if (talkers.length > 0 && net.monitor) {
      state = 'receiving';
      lamp = `RECEIVING ${talkers.join(', ')}`;
    }
    view.card.dataset.state = state;
    view.lamp.textContent = lamp;

    const capturingKey = capture?.netId === net.id && capture.kind === 'key';
    view.keyLabel.textContent = capturingKey
      ? 'Press a key or mouse side button. Esc cancels.'
      : (net.keyBind?.label ?? 'Not set');
    view.keyLabel.className = `bind${capturingKey ? ' capturing' : net.keyBind ? '' : ' unset'}`;
    view.keySet.textContent = capturingKey ? 'Cancel' : 'Set';

    const capturingPad = capture?.netId === net.id && capture.kind === 'pad';
    view.padLabel.textContent = capturingPad
      ? 'Press a button on the stick or throttle. Esc cancels.'
      : (net.padBind?.label ?? 'Not set');
    view.padLabel.className = `bind${capturingPad ? ' capturing' : net.padBind ? '' : ' unset'}`;
    view.padSet.textContent = capturingPad ? 'Cancel' : 'Set';
  }
}

function timing(values: number[]): string {
  const summary = summarise(values);
  if (summary.count === 0) return '—';
  return `${summary.median.toFixed(1)} ms (worst ${summary.worst.toFixed(1)})`;
}

function countRows(): string[][] {
  const rows: string[][] = [];
  for (const net of settings.nets) {
    for (const source of ['key', 'pad'] as const) {
      const count = countFor(net.id, source);
      rows.push([
        `${net.name}, ${sourceName(source)}`,
        String(count.presses),
        String(count.releases),
        String(count.cuts),
        timing(count.toLive),
        timing(count.toClosed),
      ]);
    }
  }
  return rows;
}

function heardRows(): string[][] {
  return [...heard.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.netId.localeCompare(b.netId))
    .map((entry) => [`${entry.name} on ${netName(entry.netId)}`, String(entry.count), `${entry.longest.toFixed(1)} s`]);
}

function fillBody(tableId: string, rows: string[][], badColumn = -1): void {
  const body = $(tableId).querySelector('tbody')!;
  body.replaceChildren(
    ...rows.map((cells) => {
      const row = el('tr');
      cells.forEach((cell, index) => {
        const td = el('td', index === badColumn && cell !== '0' ? 'bad' : '', cell);
        row.append(td);
      });
      return row;
    }),
  );
}

function renderCounts(): void {
  fillBody('counts', countRows(), 3);
}

function renderHeard(): void {
  const rows = heardRows();
  fillBody('heard', rows.length > 0 ? rows : [['Nobody yet', '—', '—']]);
}

function renderRoster(): void {
  const list = $('roster');
  const entries = voice.roster();
  if (entries.length === 0) {
    list.replaceChildren(el('li', 'muted', 'Not connected'));
    return;
  }
  list.replaceChildren(
    ...entries.map((entry) => {
      const item = el('li');
      item.append(el('span', '', entry.isLocal ? `${entry.name} (you)` : entry.name));
      if (entry.talkingOn.length > 0) {
        item.append(el('span', `talking${entry.isLocal ? ' me' : ''}`, entry.talkingOn.map(netName).join(', ')));
      }
      return item;
    }),
  );
}

function renderHealth(): void {
  const list = $('health');
  const sticks = pads.pads();
  const rows: Array<[string, string, '' | 'good' | 'bad']> = [
    ['Key hook', hook.ok ? 'running' : hook.detail, hook.ok ? 'good' : 'bad'],
    ['Last talk key', lastKeyInput, ''],
    [
      'Sticks',
      sticks.length > 0
        ? sticks.map((pad) => `${shortPadName(pad.id)} (${pad.buttons} buttons)`).join('; ')
        : 'none seen yet: press any stick button',
      '',
    ],
    ['Last stick button', lastPadInput, ''],
    ['Stick poll gap', `${padGap.toFixed(0)} ms worst in the last second`, padGap > 100 ? 'bad' : 'good'],
    ['Window', `${document.visibilityState}, ${document.hasFocus() ? 'focused' : 'in background'}`, ''],
  ];
  list.replaceChildren(
    ...rows.flatMap(([term, value, tone]) => [el('dt', '', term), el('dd', tone, value)]),
  );
}

function table(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, column) => Math.max(...all.map((row) => (row[column] ?? '').length)));
  return all.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd()).join('\n');
}

function report(): string {
  const sticks = pads.pads().map((pad) => `${pad.id} (${pad.buttons} buttons)`);
  return [
    '9th Fleet Voice: test record',
    `Saved: ${new Date().toISOString()}`,
    `App: ${info?.version ?? '?'} on ${info?.platform ?? '?'}, Electron ${info?.electron ?? '?'}`,
    `Name in room: ${voice.selfName || 'not connected'}`,
    `Key hook: ${hook.detail}`,
    `Sticks: ${sticks.length > 0 ? sticks.join('; ') : 'none seen'}`,
    ...settings.nets.map(
      (net) => `${net.name}: key ${net.keyBind?.label ?? 'not set'}; stick ${net.padBind?.label ?? 'not set'}`,
    ),
    '',
    table(['Sent from this PC', 'Presses', 'Releases', 'Cut by app', 'Key to live', 'Release to closed'], countRows()),
    '',
    table(['Heard on this PC', 'Transmissions', 'Longest'], heardRows()),
    '',
    'Log',
    ...logLines,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Microphones
// ---------------------------------------------------------------------------------------------

async function listMicrophones(askFirst: boolean): Promise<void> {
  const select = $<HTMLSelectElement>('mic');
  try {
    if (askFirst) {
      // Device names are only readable once the microphone has been opened once.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
    select.replaceChildren();
    const fallback = el('option', '', 'System default');
    fallback.value = '';
    select.append(fallback);
    for (const device of devices) {
      if (device.deviceId === 'default' || device.deviceId === 'communications') continue;
      const option = el('option', '', device.label || 'Microphone');
      option.value = device.deviceId;
      select.append(option);
    }
    const known = [...select.options].some((option) => option.value === settings.micId);
    select.value = known ? settings.micId : '';
  } catch (error) {
    setJoinStatus(`No microphone available: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

function start(): void {
  buildNets();
  renderNets();
  renderCounts();
  renderHeard();
  renderRoster();
  renderHealth();

  $<HTMLInputElement>('join-code').value = settings.joinCode;
  $<HTMLInputElement>('permit-tone').checked = settings.permitTone;

  $('connect').addEventListener('click', () => void toggleConnection());
  $<HTMLSelectElement>('mic').addEventListener('change', (event) => {
    settings.micId = (event.target as HTMLSelectElement).value;
    saveSettings(settings);
  });
  $<HTMLInputElement>('permit-tone').addEventListener('change', (event) => {
    settings.permitTone = (event.target as HTMLInputElement).checked;
    saveSettings(settings);
  });
  $('reset').addEventListener('click', () => {
    counts.clear();
    heard.clear();
    log('COUNTS reset');
    renderCounts();
    renderHeard();
  });
  $('copy').addEventListener('click', () => {
    void navigator.clipboard.writeText(report()).then(
      () => log('RECORD copied to the clipboard'),
      () => log('ERROR could not copy. Use Save instead.'),
    );
  });
  $('save').addEventListener('click', () => {
    void window.fleet.saveLog(report()).then((path) => {
      if (path) log(`RECORD saved to ${path}`);
    });
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && capture?.kind === 'pad') cancelCapture();
  });

  window.fleet.onPtt((message) => {
    if (message.down) lastKeyInput = `${netName(message.netId)} at ${clock()} (${focusNote()})`;
    handlePtt(message.netId, 'key', message.down);
  });
  window.fleet.onCaptured((bind) => finishKeyCapture(bind));
  window.fleet.onCaptureCancelled(() => {
    if (capture?.kind === 'key') {
      capture = null;
      renderNets();
    }
  });
  window.fleet.onReleaseAll((reason) => forceRelease(reason));
  window.fleet.onHookStatus((status) => {
    hook = status;
    renderHealth();
  });
  void window.fleet.getInfo().then((result) => {
    info = result;
    hook = result.hook;
    $('version').textContent = `Gate A spike, version ${result.version}`;
    log(`APP ${result.version} on ${result.platform}, Electron ${result.electron}. ${result.hook.detail}.`);
    renderHealth();
  });
  pushKeyBinds();

  pads.start();
  window.setInterval(() => {
    padGap = pads.takeWorstGap();
    renderHealth();
  }, 1000);
  window.setInterval(() => {
    const bar = $('mic-level');
    if (!meterAnalyser) {
      bar.style.transform = 'scaleX(0)';
      return;
    }
    meterAnalyser.getFloatTimeDomainData(meterBuffer);
    let sum = 0;
    for (const sample of meterBuffer) sum += sample * sample;
    const level = Math.min(1, Math.sqrt(sum / meterBuffer.length) * 6);
    bar.style.transform = `scaleX(${level.toFixed(3)})`;
  }, 60);

  void listMicrophones(true);
  navigator.mediaDevices.addEventListener('devicechange', () => void listMicrophones(false));
}

start();
