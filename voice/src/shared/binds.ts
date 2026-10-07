/** A keyboard key or mouse button, captured by the global input hook in the main process. */
export type KeyBind =
  | { kind: 'key'; code: number; label: string }
  | { kind: 'mouse'; button: number; label: string };

/** A joystick, throttle or gamepad button, read through the Gamepad API in the window. */
export interface PadBind {
  kind: 'pad';
  /** Device name as the Gamepad API reports it, including vendor and product id. */
  padId: string;
  /** 0 for the first device with this name, 1 for the second. Tells two identical sticks apart. */
  ordinal: number;
  button: number;
  label: string;
}

export function keyBindId(bind: KeyBind): string {
  return bind.kind === 'key' ? `key:${bind.code}` : `mouse:${bind.button}`;
}

export function padBindId(bind: Pick<PadBind, 'padId' | 'ordinal' | 'button'>): string {
  return `${bind.padId}\u0000${bind.ordinal}\u0000${bind.button}`;
}

/** Shortens "VKB-Sim Gladiator NXT R (Vendor: 231d Product: 0200)" to "VKB-Sim Gladiator NXT R". */
export function shortPadName(padId: string): string {
  const cut = padId.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*\)\s*$/i, '').trim();
  return cut.length > 0 ? cut : padId;
}

export function padLabel(padId: string, ordinal: number, button: number): string {
  const suffix = ordinal > 0 ? ` #${ordinal + 1}` : '';
  return `${shortPadName(padId)}${suffix}, button ${button + 1}`;
}
