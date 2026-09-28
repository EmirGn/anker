import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { dayKey } from '@anker/core';
import { JobManager } from './ai/jobs';
import { resolvedPath } from './ai/env';
import { VoiceManager } from './ai/voice';
import { defaultDataDir, loadConfig, saveConfig, writeDiscovery, type HubConfig } from './config';
import type { StdioCommand } from './integrations';
import { Repo } from './repo';
import { createServer } from './server';
import { Store } from './store';

export { Store } from './store';
export { Repo } from './repo';
export { createMcpServer, MCP_INSTRUCTIONS } from './mcp';
export { defaultDataDir, readDiscovery, DISCOVERY_FILE } from './config';
export type { StdioCommand } from './integrations';
export type { HubConfig } from './config';

export interface HubOptions {
  dataDir?: string;
  port?: number;
  /** Directory with the built web app to serve at "/" (null = API only) */
  webRoot?: string | null;
  version?: string;
  /** How MCP clients should launch the stdio proxy for this hub */
  stdioProxy?: StdioCommand | null;
  /** Write ~/.anker/connection.json (default true) */
  discovery?: boolean;
  log?: (msg: string) => void;
}

export interface HubHandle {
  url: string;
  port: number;
  token: string;
  config: HubConfig;
  store: Store;
  repo: Repo;
  jobs: JobManager;
  dataDir: string;
  setLanEnabled(enabled: boolean): Promise<void>;
  stop(): Promise<void>;
}

export async function startHub(opts: HubOptions = {}): Promise<HubHandle> {
  const log = opts.log ?? ((m: string) => console.log(`[anker] ${m}`));
  const dataDir = opts.dataDir ?? defaultDataDir();
  const version = opts.version ?? '0.0.0';
  const config = loadConfig(dataDir, opts.port ? { port: opts.port } : {});
  const store = new Store(path.join(dataDir, 'collection')).open();
  const repo = new Repo(store);
  const workDir = path.join(dataDir, 'agent-workspace');
  fs.mkdirSync(workDir, { recursive: true });
  void resolvedPath(); // warm up the login-shell PATH lookup for the AI CLIs

  let port = config.port;
  const jobs = new JobManager(repo, { mcpUrl: () => `http://127.0.0.1:${port}/mcp`, token: config.adminToken, workDir });
  const voice = new VoiceManager(repo, { mcpUrl: () => `http://127.0.0.1:${port}/mcp`, token: config.adminToken, workDir });

  const server = createServer({
    config,
    dataDir,
    store,
    repo,
    jobs,
    voice,
    version,
    webRoot: opts.webRoot ?? null,
    stdioProxy: opts.stdioProxy ?? null,
    port: () => port,
    onSettingsChanged: async (patch) => {
      const lanChanged = patch.lanEnabled !== undefined && patch.lanEnabled !== config.lanEnabled;
      Object.assign(config, patch);
      saveConfig(dataDir, config);
      if (lanChanged) await listen();
    },
  });
  server.keepAliveTimeout = 65_000;

  const listen = () =>
    new Promise<void>((resolve, reject) => {
      const host = config.lanEnabled ? '0.0.0.0' : '127.0.0.1';
      const doListen = () => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          port = (server.address() as AddressInfo).port;
          resolve();
        });
      };
      if (server.listening) server.close(() => doListen());
      else doListen();
    });

  await listen();
  if (config.port !== port && !opts.port) {
    config.port = port;
    saveConfig(dataDir, config);
  }
  const url = `http://127.0.0.1:${port}`;
  if (opts.discovery !== false) {
    writeDiscovery({ url, token: config.adminToken, pid: process.pid, dataDir, version, hubId: config.hubId, updatedAt: Date.now() });
  }

  const backupIfNeeded = () => {
    const today = dayKey(Date.now(), 4);
    if (config.lastBackupDay === today || store.count('notes') === 0) return;
    try {
      const file = store.backup();
      config.lastBackupDay = today;
      saveConfig(dataDir, config);
      log(`backup written: ${file}`);
    } catch (e) {
      log(`backup failed: ${(e as Error).message}`);
    }
  };
  backupIfNeeded();
  const backupTimer = setInterval(backupIfNeeded, 60 * 60_000);
  backupTimer.unref();

  log(`hub "${config.name}" listening on ${config.lanEnabled ? `0.0.0.0:${port} (LAN on)` : url} — data in ${dataDir}`);

  return {
    url,
    port,
    token: config.adminToken,
    config,
    store,
    repo,
    jobs,
    dataDir,
    async setLanEnabled(enabled: boolean) {
      if (enabled === config.lanEnabled) return;
      config.lanEnabled = enabled;
      saveConfig(dataDir, config);
      await listen();
    },
    stop: () =>
      new Promise<void>((resolve) => {
        clearInterval(backupTimer);
        void voice.shutdown();
        server.closeAllConnections?.();
        server.close(() => {
          store.compact();
          store.close();
          resolve();
        });
      }),
  };
}
