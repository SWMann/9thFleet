/**
 * Pure radio-net logic. Nothing in this file touches Electron, LiveKit or the DOM,
 * so it can be unit tested with plain Node.
 */

export type Ear = 'left' | 'right' | 'both';

export interface NetConfig {
  /** Stable id. It is also the name of the audio track a member publishes for this net. */
  id: string;
  /** Name shown to the member. */
  name: string;
  ear: Ear;
  /** 0 to 1. */
  volume: number;
  /** A net that is not monitored is not subscribed to, so it is never delivered to this PC. */
  monitor: boolean;
}

/** The spike carries two fixed nets. The product reads them from the member's event slot. */
export const DEFAULT_NETS: readonly NetConfig[] = [
  { id: 'net1', name: 'Net 1', ear: 'left', volume: 1, monitor: true },
  { id: 'net2', name: 'Net 2', ear: 'right', volume: 1, monitor: true },
];

export function panFor(ear: Ear): number {
  if (ear === 'left') return -1;
  if (ear === 'right') return 1;
  return 0;
}

export interface Route {
  /** Linear gain, 0 when the net must not be heard. */
  gain: number;
  /** -1 is the left ear, 1 the right ear, 0 both. */
  pan: number;
}

/** Where a received transmission plays. An unknown or unmonitored net is silent. */
export function routeFor(net: NetConfig | undefined): Route {
  if (!net || !net.monitor) return { gain: 0, pan: 0 };
  const volume = Number.isFinite(net.volume) ? Math.min(1, Math.max(0, net.volume)) : 0;
  return { gain: volume, pan: panFor(net.ear) };
}

export type PttSource = 'key' | 'pad';

export type PttAction =
  | { type: 'start'; netId: string }
  | { type: 'stop'; netId: string }
  | { type: 'blocked'; netId: string; activeNetId: string }
  | { type: 'none' };

const NONE: PttAction = { type: 'none' };

/**
 * Decides what a push-to-talk press or release does.
 *
 * Rules:
 * 1. One transmission at a time. The first net keyed wins.
 * 2. A press on another net while transmitting is blocked. It does not take over
 *    when the first net is released; the member must press again.
 * 3. A net bound to both a key and a stick button stays keyed until both are released.
 */
export class PttArbiter {
  private readonly held = new Set<string>();
  private active: string | null = null;

  get activeNetId(): string | null {
    return this.active;
  }

  /** True while this net's key or stick button is known to be down. */
  holds(netId: string, source: PttSource): boolean {
    return this.held.has(inputId(netId, source));
  }

  press(netId: string, source: PttSource): PttAction {
    const input = inputId(netId, source);
    if (this.held.has(input)) return NONE; // key auto-repeat
    this.held.add(input);
    if (this.active === null) {
      this.active = netId;
      return { type: 'start', netId };
    }
    if (this.active === netId) return NONE;
    return { type: 'blocked', netId, activeNetId: this.active };
  }

  release(netId: string, source: PttSource): PttAction {
    if (!this.held.delete(inputId(netId, source))) return NONE;
    if (this.active !== netId) return NONE;
    if (this.isHeld(netId)) return NONE;
    this.active = null;
    return { type: 'stop', netId };
  }

  /** Drops every held input. Used on disconnect, on the transmit time limit and on screen lock. */
  releaseAll(): PttAction {
    this.held.clear();
    if (this.active === null) return NONE;
    const netId = this.active;
    this.active = null;
    return { type: 'stop', netId };
  }

  private isHeld(netId: string): boolean {
    for (const input of this.held) {
      if (input.startsWith(netId + '\u0000')) return true;
    }
    return false;
  }
}

function inputId(netId: string, source: PttSource): string {
  return netId + '\u0000' + source;
}

export interface Summary {
  count: number;
  median: number;
  worst: number;
}

/** Summary of a list of timings in milliseconds. */
export function summarise(values: readonly number[]): Summary {
  if (values.length === 0) return { count: 0, median: 0, worst: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { count: sorted.length, median, worst: sorted[sorted.length - 1]! };
}

/**
 * A join code is the server address and a token in one line, so a tester pastes once:
 *   wss://example.livekit.cloud#eyJhbGciOi...
 */
export function parseJoinCode(text: string): { url: string; token: string } | null {
  const trimmed = text.replace(/\s+/g, '');
  const hash = trimmed.indexOf('#');
  if (hash <= 0) return null;
  const url = trimmed.slice(0, hash);
  const token = trimmed.slice(hash + 1);
  if (!/^wss?:\/\/[^/]+/i.test(url)) return null;
  if (token.split('.').length !== 3) return null;
  return { url, token };
}
