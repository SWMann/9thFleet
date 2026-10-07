import type { KeyBind } from './binds';

/** Messages between the main process (global input hook) and the window. */
export const Channel = {
  setBinds: 'binds:set',
  startCapture: 'capture:start',
  cancelCapture: 'capture:cancel',
  captured: 'input:captured',
  captureCancelled: 'input:capture-cancelled',
  ptt: 'input:ptt',
  releaseAll: 'input:release-all',
  hookStatus: 'hook:status',
  getInfo: 'app:info',
  saveLog: 'log:save',
} as const;

export interface NetKeyBind {
  netId: string;
  bind: KeyBind;
}

export interface PttMessage {
  netId: string;
  down: boolean;
}

export interface HookStatus {
  ok: boolean;
  detail: string;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  hook: HookStatus;
}

/** The only surface the window gets. It never sees raw keystrokes outside bind capture. */
export interface FleetApi {
  setBinds(binds: NetKeyBind[]): void;
  startCapture(): void;
  cancelCapture(): void;
  getInfo(): Promise<AppInfo>;
  saveLog(text: string): Promise<string | null>;
  onPtt(handler: (message: PttMessage) => void): void;
  onCaptured(handler: (bind: KeyBind) => void): void;
  onCaptureCancelled(handler: () => void): void;
  onReleaseAll(handler: (reason: string) => void): void;
  onHookStatus(handler: (status: HookStatus) => void): void;
}
