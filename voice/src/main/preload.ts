import { contextBridge, ipcRenderer } from 'electron';
import type { KeyBind } from '../shared/binds';
import { Channel, type AppInfo, type FleetApi, type HookStatus, type NetKeyBind, type PttMessage } from '../shared/ipc';

const api: FleetApi = {
  setBinds: (binds: NetKeyBind[]) => ipcRenderer.send(Channel.setBinds, binds),
  startCapture: () => ipcRenderer.send(Channel.startCapture),
  cancelCapture: () => ipcRenderer.send(Channel.cancelCapture),
  getInfo: () => ipcRenderer.invoke(Channel.getInfo) as Promise<AppInfo>,
  saveLog: (text: string) => ipcRenderer.invoke(Channel.saveLog, text) as Promise<string | null>,
  onPtt: (handler) => {
    ipcRenderer.on(Channel.ptt, (_event, message: PttMessage) => handler(message));
  },
  onCaptured: (handler) => {
    ipcRenderer.on(Channel.captured, (_event, bind: KeyBind) => handler(bind));
  },
  onCaptureCancelled: (handler) => {
    ipcRenderer.on(Channel.captureCancelled, () => handler());
  },
  onReleaseAll: (handler) => {
    ipcRenderer.on(Channel.releaseAll, (_event, reason: string) => handler(reason));
  },
  onHookStatus: (handler) => {
    ipcRenderer.on(Channel.hookStatus, (_event, status: HookStatus) => handler(status));
  },
};

contextBridge.exposeInMainWorld('fleet', api);
