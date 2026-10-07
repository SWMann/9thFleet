import type { KeyBind, PadBind } from '../shared/binds';
import { DEFAULT_NETS, type Ear, type NetConfig } from '../shared/nets';

export interface NetSettings extends NetConfig {
  keyBind: KeyBind | null;
  padBind: PadBind | null;
}

export interface Settings {
  joinCode: string;
  micId: string;
  permitTone: boolean;
  nets: NetSettings[];
}

const STORAGE_KEY = 'ninth-fleet-voice-spike-v1';

function defaults(): Settings {
  return {
    joinCode: '',
    micId: '',
    permitTone: true,
    nets: DEFAULT_NETS.map((net) => ({ ...net, keyBind: null, padBind: null })),
  };
}

const EARS: readonly Ear[] = ['left', 'right', 'both'];

export function loadSettings(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Settings>;
    if (typeof saved.joinCode === 'string') base.joinCode = saved.joinCode;
    if (typeof saved.micId === 'string') base.micId = saved.micId;
    if (typeof saved.permitTone === 'boolean') base.permitTone = saved.permitTone;
    for (const net of base.nets) {
      const old = Array.isArray(saved.nets) ? saved.nets.find((item) => item?.id === net.id) : undefined;
      if (!old) continue;
      if (EARS.includes(old.ear)) net.ear = old.ear;
      if (typeof old.volume === 'number' && old.volume >= 0 && old.volume <= 1) net.volume = old.volume;
      if (typeof old.monitor === 'boolean') net.monitor = old.monitor;
      if (old.keyBind && (old.keyBind.kind === 'key' || old.keyBind.kind === 'mouse')) net.keyBind = old.keyBind;
      if (old.padBind && old.padBind.kind === 'pad') net.padBind = old.padBind;
    }
  } catch {
    // Unreadable settings are replaced by the defaults.
  }
  return base;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; the app works without them.
  }
}
