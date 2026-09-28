// Anker for macOS: an Electron shell around the hub (sync server, MCP server,
// Claude/Codex bridge) plus native niceties — menu bar item, dock badge,
// global quick-add shortcut and daily reminders.
import { startHub, type HubHandle } from '@anker/hub';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, shell, systemPreferences, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { dayKey } from '@anker/core';

const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+K';

interface DesktopSettings {
  shortcut: string;
  lang?: 'en' | 'de';
  bounds?: Electron.Rectangle;
  lastReminderDay?: string;
}

let hub: HubHandle | null = null;
let win: BrowserWindow | null = null;
let quick: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let settings: DesktopSettings = { shortcut: DEFAULT_SHORTCUT };

/** Menu, tray and notification text in the app's language (English unless the app says German). */
const L = (de: string, en: string) => (settings.lang === 'de' ? de : en);

const res = (...p: string[]) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, '..', ...p));
const settingsFile = () => path.join(app.getPath('userData'), 'desktop.json');

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    // defaults
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('[anker] could not save settings', e);
  }
}

function webRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '../../app/dist');
}

function mcpScript(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'mcp-stdio.cjs') : path.resolve(__dirname, '../../hub/dist/mcp-stdio.cjs');
}

function bg() {
  return nativeTheme.shouldUseDarkColors ? '#16140f' : '#fbf6ee';
}

// ----------------------------------------------------------------- windows
function createWindow(show = true) {
  const b = settings.bounds;
  win = new BrowserWindow({
    width: b?.width ?? 1240,
    height: b?.height ?? 840,
    x: b?.x,
    y: b?.y,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Anker',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 },
    backgroundColor: bg(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  guard(win);
  void win.loadURL(`${hub!.url}/#/`);
  win.once('ready-to-show', () => show && win?.show());
  const persist = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    settings.bounds = win.getBounds();
    saveSettings();
  };
  win.on('resized', persist);
  win.on('moved', persist);
  win.on('close', (e) => {
    if (!quitting && process.platform === 'darwin') {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => (win = null));
}

/** Keep windows on the hub origin; open everything else in the browser. */
function guard(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(hub!.url)) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
}

function showMain(route?: string) {
  if (!win || win.isDestroyed()) createWindow(true);
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  if (route) win!.webContents.send('anker:navigate', route);
}

function toggleQuickAdd() {
  if (quick && !quick.isDestroyed() && quick.isVisible()) {
    quick.hide();
    return;
  }
  if (!quick || quick.isDestroyed()) {
    quick = new BrowserWindow({
      width: 540,
      height: 262,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      vibrancy: 'popover',
      visualEffectState: 'active',
      backgroundColor: bg(),
      roundedCorners: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    guard(quick);
    void quick.loadURL(`${hub!.url}/#/quick-add`);
    quick.on('blur', () => quick?.hide());
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  quick.setPosition(Math.round(x + (width - 540) / 2), Math.round(y + 140));
  quick.show();
  quick.focus();
}

function registerShortcut(accel: string): boolean {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(accel, toggleQuickAdd);
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------- due count, tray, reminders
function dueToday(): number {
  if (!hub) return 0;
  try {
    const decks = hub.repo.deckSummaries();
    const byPath = new Set(decks.map((d) => d.path));
    let n = 0;
    for (const d of decks) {
      const parent = d.path.includes('::') ? d.path.slice(0, d.path.lastIndexOf('::')) : null;
      if (parent && byPath.has(parent)) continue;
      if (d.due) n += d.due.new + d.due.learn + d.due.review;
    }
    return n;
  } catch {
    return 0;
  }
}

function refreshStatus() {
  const due = dueToday();
  app.dock?.setBadge(due ? String(due) : '');
  if (tray) {
    tray.setTitle(due ? ` ${due}` : '', { fontType: 'monospacedDigit' });
    tray.setToolTip(due ? L(`Anker – ${due} ${due === 1 ? 'Karte' : 'Karten'} fällig`, `Anker – ${due} ${due === 1 ? 'card' : 'cards'} due`) : L('Anker – für heute alles erledigt', 'Anker – all done for today'));
    tray.setContextMenu(trayMenu(due));
  }
}

function trayMenu(due: number) {
  return Menu.buildFromTemplate([
    { label: due ? L(`${due} ${due === 1 ? 'Karte' : 'Karten'} heute fällig`, `${due} ${due === 1 ? 'card' : 'cards'} due today`) : L('Für heute alles erledigt', 'All done for today'), enabled: false },
    { label: L('Jetzt lernen', 'Start studying'), enabled: due > 0, click: () => showMain('/study') },
    { label: L('Schnell hinzufügen …', 'Quick add…'), accelerator: settings.shortcut, click: toggleQuickAdd },
    { label: L('Tutor fragen', 'Ask the tutor'), click: () => showMain('/tutor') },
    { type: 'separator' },
    { label: L('Anker öffnen', 'Open Anker'), click: () => showMain() },
    { label: L('Einstellungen', 'Settings'), click: () => showMain('/settings') },
    { type: 'separator' },
    { label: L('Anker beenden', 'Quit Anker'), role: 'quit' },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(res('build', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', () => tray?.popUpContextMenu());
  refreshStatus();
}

function checkReminder() {
  if (!hub) return;
  const prefs = hub.repo.prefs();
  if (!prefs.reminderTime) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = dayKey(Date.now(), prefs.rolloverHour);
  if (hhmm < prefs.reminderTime || settings.lastReminderDay === today) return;
  const due = dueToday();
  settings.lastReminderDay = today;
  saveSettings();
  if (!due || !Notification.isSupported()) return;
  const n = new Notification({
    title: L('Zeit für Deutsch', 'Time for German'),
    body: L(
      `${due} ${due === 1 ? 'Karte wartet' : 'Karten warten'}. Ein paar Minuten halten deine Serie am Leben.`,
      `${due} ${due === 1 ? 'card is' : 'cards are'} waiting. A few minutes keeps your streak alive.`,
    ),
  });
  n.on('click', () => showMain('/study'));
  n.show();
}

function appMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Anker',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: L('Einstellungen …', 'Settings…'), accelerator: 'Command+,', click: () => showMain('/settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: L('Gehe zu', 'Go'),
      submenu: [
        { label: L('Heute', 'Today'), accelerator: 'Command+1', click: () => showMain('/') },
        { label: 'Decks', accelerator: 'Command+2', click: () => showMain('/decks') },
        { label: L('Neue Karte', 'Add card'), accelerator: 'Command+N', click: () => showMain('/add') },
        { label: L('Karten suchen', 'Browse'), accelerator: 'Command+F', click: () => showMain('/browse') },
        { label: L('Üben', 'Practice'), accelerator: 'Command+3', click: () => showMain('/practice') },
        { label: 'Tutor', accelerator: 'Command+4', click: () => showMain('/tutor') },
        { label: L('Statistik', 'Stats'), accelerator: 'Command+5', click: () => showMain('/stats') },
        { type: 'separator' },
        { label: L('Jetzt lernen', 'Start studying'), accelerator: 'Command+Return', click: () => showMain('/study') },
        { label: L('Schnell hinzufügen', 'Quick add'), click: toggleQuickAdd },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ----------------------------------------------------------------- IPC
function ipc() {
  ipcMain.on('anker:config', (e) => {
    e.returnValue = { hubUrl: hub!.url, token: hub!.token, version: app.getVersion(), platform: process.platform };
  });
  ipcMain.on('anker:badge', () => refreshStatus());
  ipcMain.on('anker:notify', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });
  ipcMain.on('anker:reminder', () => {
    settings.lastReminderDay = undefined;
    saveSettings();
  });
  ipcMain.on('anker:open', (_e, url: string) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  ipcMain.on('anker:quick-close', () => quick?.hide());
  ipcMain.handle('anker:settings', () => ({ openAtLogin: app.getLoginItemSettings().openAtLogin, shortcut: settings.shortcut }));
  ipcMain.handle('anker:lang', (_e, next: string) => {
    const l = next === 'de' ? 'de' : 'en';
    if (settings.lang === l) return;
    settings.lang = l;
    saveSettings();
    appMenu();
    refreshStatus();
  });
  // Voice chat: macOS asks once for the microphone; afterwards it's System Settings' call.
  ipcMain.handle('anker:mic', async () => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone');
    return status === 'granted';
  });
  ipcMain.handle('anker:login-item', (_e, open: boolean) => app.setLoginItemSettings({ openAtLogin: open }));
  ipcMain.handle('anker:shortcut', (_e, accel: string) => {
    const next = accel?.trim() || DEFAULT_SHORTCUT;
    if (!registerShortcut(next)) {
      registerShortcut(settings.shortcut);
      return false;
    }
    settings.shortcut = next;
    saveSettings();
    refreshStatus();
    return true;
  });
}

// ----------------------------------------------------------------- lifecycle
// Test/dev overrides (keep your real collection untouched while hacking on Anker).
if (process.env.ANKER_USER_DATA) app.setPath('userData', process.env.ANKER_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.setName('Anker');

  app.whenReady().then(async () => {
    loadSettings();
    try {
      hub = await startHub({
        dataDir: app.getPath('userData'),
        webRoot: webRoot(),
        version: app.getVersion(),
        stdioProxy: { command: process.execPath, args: [mcpScript()], env: { ELECTRON_RUN_AS_NODE: '1' } },
        port: process.env.ANKER_PORT ? Number(process.env.ANKER_PORT) : undefined,
        discovery: !process.env.ANKER_NO_DISCOVERY,
      });
    } catch (e) {
      const { dialog } = await import('electron');
      dialog.showErrorBox('Anker could not start', `${(e as Error).message}\n\nIs another copy of Anker (or the Anker hub) already running on port 4747?`);
      app.exit(1);
      return;
    }
    ipc();
    appMenu();
    const hidden = app.getLoginItemSettings().wasOpenedAtLogin;
    createWindow(!hidden);
    createTray();
    registerShortcut(settings.shortcut);
    let pending: NodeJS.Timeout | null = null;
    hub.store.onChange(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        refreshStatus();
      }, 1500);
    });
    setInterval(() => {
      refreshStatus();
      checkReminder();
    }, 60_000);
    checkReminder();
  });

  app.on('activate', () => showMain());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', (e) => {
    globalShortcut.unregisterAll();
    if (hub) {
      e.preventDefault();
      const h = hub;
      hub = null;
      void h.stop().finally(() => app.exit(0));
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
