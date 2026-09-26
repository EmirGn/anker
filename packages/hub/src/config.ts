import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DeviceInfo {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt?: number;
}

export interface HubConfig {
  hubId: string;
  name: string;
  adminToken: string;
  port: number;
  devices: DeviceInfo[];
  /** Listen on all interfaces so phones on the LAN / Tailscale can sync */
  lanEnabled: boolean;
  lastBackupDay?: string;
}

export const DEFAULT_PORT = 4747;

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function defaultName(): string {
  const host = os.hostname().replace(/\.local$/, '').replace(/-/g, ' ');
  return host || 'Anker Hub';
}

export function loadConfig(dataDir: string, overrides: Partial<HubConfig> = {}): HubConfig {
  const file = path.join(dataDir, 'hub.json');
  let cfg: Partial<HubConfig> = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // first run
  }
  const full: HubConfig = {
    hubId: cfg.hubId ?? crypto.randomUUID(),
    name: cfg.name ?? defaultName(),
    adminToken: cfg.adminToken ?? randomToken(),
    port: cfg.port ?? DEFAULT_PORT,
    devices: cfg.devices ?? [],
    lanEnabled: cfg.lanEnabled ?? true,
    lastBackupDay: cfg.lastBackupDay,
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
  };
  saveConfig(dataDir, full);
  return full;
}

export function saveConfig(dataDir: string, cfg: HubConfig) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'hub.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Where MCP proxies and tools find a running hub: ~/.anker/connection.json */
export const DISCOVERY_DIR = path.join(os.homedir(), '.anker');
export const DISCOVERY_FILE = path.join(DISCOVERY_DIR, 'connection.json');

export interface Discovery {
  url: string;
  token: string;
  pid: number;
  dataDir: string;
  version: string;
  hubId: string;
  updatedAt: number;
}

export function writeDiscovery(d: Discovery) {
  fs.mkdirSync(DISCOVERY_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${DISCOVERY_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DISCOVERY_FILE);
}

export function readDiscovery(): Discovery | null {
  try {
    return JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function defaultDataDir(): string {
  if (process.env.ANKER_DATA_DIR) return process.env.ANKER_DATA_DIR;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Anker');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? os.homedir(), 'Anker');
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'anker');
}
