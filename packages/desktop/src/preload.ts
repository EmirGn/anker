// Minimal bridge for the web app. The window only ever shows Anker's own hub
// origin (navigation is locked in main.ts), so exposing the hub token is safe.
import { contextBridge, ipcRenderer } from 'electron';

const cfg = ipcRenderer.sendSync('anker:config') as { hubUrl: string; token: string; version: string; platform: string };

contextBridge.exposeInMainWorld('ankerDesktop', {
  hubUrl: cfg.hubUrl,
  token: cfg.token,
  version: cfg.version,
  platform: cfg.platform,
  setBadge: (count: number) => ipcRenderer.send('anker:badge', count),
  notify: (title: string, body: string) => ipcRenderer.send('anker:notify', title, body),
  setReminder: (time: string | null) => ipcRenderer.send('anker:reminder', time),
  openExternal: (url: string) => ipcRenderer.send('anker:open', url),
  onNavigate: (cb: (route: string) => void) => {
    ipcRenderer.on('anker:navigate', (_e, route: string) => cb(route));
  },
  closeQuickAdd: () => ipcRenderer.send('anker:quick-close'),
  getSettings: () => ipcRenderer.invoke('anker:settings'),
  setOpenAtLogin: (open: boolean) => ipcRenderer.invoke('anker:login-item', open),
  setShortcut: (accelerator: string) => ipcRenderer.invoke('anker:shortcut', accelerator),
});
