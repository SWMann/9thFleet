import { padLabel, type PadBind } from '../shared/binds';

/**
 * Reads joystick, throttle and gamepad buttons through the Gamepad API.
 *
 * This is candidate 1 for stick push-to-talk. Whether Windows keeps delivering stick input to
 * this window while the game has focus is exactly what Gate A tests, so the watcher also
 * measures its own poll timing to show if it is being slowed down in the background.
 */

const POLL_MS = 10;

export interface PadInfo {
  id: string;
  ordinal: number;
  buttons: number;
}

export interface PadButton {
  padId: string;
  ordinal: number;
  button: number;
}

export class PadWatcher {
  /** Last known pressed state per pad, keyed by Gamepad index. */
  private readonly state = new Map<number, { info: PadInfo; pressed: boolean[] }>();
  private timer: number | null = null;
  private lastPoll = 0;
  private worstGap = 0;
  private capture: ((bind: PadBind) => void) | null = null;

  constructor(
    private readonly onButton: (button: PadButton, down: boolean) => void,
    private readonly onPadsChanged: () => void,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.lastPoll = performance.now();
    this.timer = window.setInterval(() => this.poll(), POLL_MS);
  }

  /** The next button pressed on any stick is reported once, then capture ends. */
  beginCapture(handler: (bind: PadBind) => void): void {
    this.capture = handler;
  }

  endCapture(): void {
    this.capture = null;
  }

  pads(): PadInfo[] {
    return [...this.state.values()].map((entry) => entry.info);
  }

  /** Longest gap between two polls since the last call, in milliseconds. Near 10 is healthy. */
  takeWorstGap(): number {
    const worst = this.worstGap;
    this.worstGap = 0;
    return worst;
  }

  private poll(): void {
    const now = performance.now();
    this.worstGap = Math.max(this.worstGap, now - this.lastPoll);
    this.lastPoll = now;

    const pads = navigator.getGamepads().filter((pad): pad is Gamepad => pad !== null && pad.connected);
    const seen = new Set<number>();
    const countById = new Map<string, number>();
    let changed = false;

    for (const pad of pads.sort((a, b) => a.index - b.index)) {
      const ordinal = countById.get(pad.id) ?? 0;
      countById.set(pad.id, ordinal + 1);
      seen.add(pad.index);

      let entry = this.state.get(pad.index);
      if (!entry || entry.info.id !== pad.id || entry.info.ordinal !== ordinal) {
        if (entry) this.releaseHeld(entry);
        entry = { info: { id: pad.id, ordinal, buttons: pad.buttons.length }, pressed: [] };
        this.state.set(pad.index, entry);
        changed = true;
      }

      for (let button = 0; button < pad.buttons.length; button++) {
        const down = pad.buttons[button]!.pressed;
        if (down === (entry.pressed[button] ?? false)) continue;
        entry.pressed[button] = down;
        this.emit({ padId: pad.id, ordinal, button }, down);
      }
    }

    for (const [index, entry] of this.state) {
      if (seen.has(index)) continue;
      // An unplugged stick can never send its release, so release for it.
      this.releaseHeld(entry);
      this.state.delete(index);
      changed = true;
    }
    if (changed) this.onPadsChanged();
  }

  private releaseHeld(entry: { info: PadInfo; pressed: boolean[] }): void {
    entry.pressed.forEach((down, button) => {
      if (down) this.emit({ padId: entry.info.id, ordinal: entry.info.ordinal, button }, false);
    });
    entry.pressed = [];
  }

  private emit(button: PadButton, down: boolean): void {
    if (this.capture) {
      if (!down) return;
      const handler = this.capture;
      this.capture = null;
      handler({ kind: 'pad', ...button, label: padLabel(button.padId, button.ordinal, button.button) });
      return;
    }
    this.onButton(button, down);
  }
}
