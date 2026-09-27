// Offline-first sync: local writes land in the outbox; syncNow() pushes them
// and pulls everything newer than our cursor. Conflicts: last writer wins.
import { isNewer, newId, SYNC_TABLES, type AnyRecord, type SyncChange, type SyncResponse, type TableName } from '@anker/core';
import { db, getMeta, setMeta, tableOf, TABLES, type OutboxEntry } from './db';
import { hub, hubFetch, HubError, onHubChange, sseStream } from './hub';
import { onCommit } from './repo';

export interface SyncState {
  status: 'disabled' | 'idle' | 'syncing' | 'offline' | 'error';
  lastSync?: number;
  error?: string;
  pending: number;
}

let state: SyncState = { status: 'disabled', pending: 0 };
const listeners = new Set<(s: SyncState) => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function getSyncState() {
  return state;
}

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function clientId(): Promise<string> {
  let id = await getMeta<string | null>('clientId', null);
  if (!id) {
    id = newId(16);
    await setMeta('clientId', id);
  }
  return id;
}

async function buildChanges(entries: OutboxEntry[]): Promise<{ changes: SyncChange[]; stale: string[] }> {
  const changes: SyncChange[] = [];
  const stale: string[] = [];
  const byTable = new Map<TableName, OutboxEntry[]>();
  for (const e of entries) byTable.set(e.table, [...(byTable.get(e.table) ?? []), e]);
  for (const [table, list] of byTable) {
    const recs = await TABLES[table]().bulkGet(list.map((e) => e.id));
    const tombs = await db.tombstones.bulkGet(list.map((e) => e.key));
    list.forEach((e, i) => {
      const rec = recs[i] as AnyRecord | undefined;
      const tomb = tombs[i];
      if (rec) changes.push({ table, id: e.id, updatedAt: rec.updatedAt, data: rec });
      else if (tomb) changes.push({ table, id: e.id, updatedAt: tomb.updatedAt, deleted: true });
      else stale.push(e.key);
    });
  }
  return { changes, stale };
}

async function applyRemote(changes: SyncChange[]) {
  if (!changes.length) return;
  const tables = [...new Set(changes.map((c) => c.table))].filter((t) => SYNC_TABLES.includes(t));
  await db.transaction('rw', [...tables.map((t) => TABLES[t]()), db.outbox, db.tombstones], async () => {
    for (const table of tables) {
      const list = changes.filter((c) => c.table === table);
      const t = tableOf(table);
      const keys = list.map((c) => `${table}:${c.id}`);
      const [locals, tombs, outs] = await Promise.all([
        t.bulkGet(list.map((c) => c.id)),
        db.tombstones.bulkGet(keys),
        db.outbox.bulkGet(keys),
      ]);
      const puts: AnyRecord[] = [];
      const dels: string[] = [];
      const tombPuts: { key: string; table: TableName; id: string; updatedAt: number }[] = [];
      const tombDels: string[] = [];
      const outDels: string[] = [];
      const outPuts: OutboxEntry[] = [];
      list.forEach((c, i) => {
        const local = locals[i] as AnyRecord | undefined;
        const tomb = tombs[i];
        const localVer = local ? { updatedAt: local.updatedAt } : tomb ? { updatedAt: tomb.updatedAt, deleted: true } : null;
        const key = keys[i]!;
        if (isNewer(c, localVer)) {
          if (c.deleted) {
            dels.push(c.id);
            tombPuts.push({ key, table, id: c.id, updatedAt: c.updatedAt });
          } else if (c.data) {
            puts.push(c.data as AnyRecord);
            tombDels.push(key);
          }
          if (outs[i]) outDels.push(key);
        } else if (localVer && localVer.updatedAt !== c.updatedAt && !outs[i]) {
          // Our copy is newer but not queued (e.g. after switching hubs) — push it.
          outPuts.push({ key, table, id: c.id, updatedAt: localVer.updatedAt });
        }
      });
      if (puts.length) await t.bulkPut(puts);
      if (dels.length) await t.bulkDelete(dels);
      if (tombPuts.length) await db.tombstones.bulkPut(tombPuts);
      if (tombDels.length) await db.tombstones.bulkDelete(tombDels);
      if (outDels.length) await db.outbox.bulkDelete(outDels);
      if (outPuts.length) await db.outbox.bulkPut(outPuts);
    }
  });
}

/** Queue every local record for upload (first sync with a different hub). */
async function markAllDirty() {
  for (const table of SYNC_TABLES) {
    const recs = (await TABLES[table]().toArray()) as AnyRecord[];
    for (let i = 0; i < recs.length; i += 2000) {
      await db.outbox.bulkPut(
        recs.slice(i, i + 2000).map((r) => ({ key: `${table}:${r.id}`, table, id: r.id, updatedAt: r.updatedAt })),
      );
    }
  }
}

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (!hub()) {
    setState({ status: 'disabled' });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  running = doSync().finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

async function doSync() {
  setState({ status: 'syncing' });
  try {
    const cid = await clientId();
    for (let round = 0; round < 200; round++) {
      const since = await getMeta<number>('syncSince', 0);
      const entries = await db.outbox.limit(400).toArray();
      const { changes, stale } = await buildChanges(entries);
      if (stale.length) await db.outbox.bulkDelete(stale);
      const res = await hubFetch<SyncResponse>('/api/sync', {
        body: { clientId: cid, since, changes, limit: 2000 },
        timeoutMs: 60_000,
      });
      const knownHub = await getMeta<string | null>('syncHubId', null);
      if (knownHub && knownHub !== res.hubId) {
        // Connected to a different hub: merge everything we have into it.
        await setMeta('syncHubId', res.hubId);
        await setMeta('syncSince', 0);
        await markAllDirty();
        continue;
      }
      if (!knownHub) await setMeta('syncHubId', res.hubId);
      await applyRemote([...res.changes, ...res.rejected]);
      // Drop pushed entries unless they changed again while we were syncing.
      const pushed = new Map(changes.map((c) => [`${c.table}:${c.id}`, c.updatedAt]));
      const current = await db.outbox.bulkGet([...pushed.keys()]);
      const done = current.filter((e): e is OutboxEntry => !!e && e.updatedAt <= (pushed.get(e.key) ?? 0)).map((e) => e.key);
      await db.outbox.bulkDelete(done);
      await setMeta('syncSince', res.seq);
      const pending = await db.outbox.count();
      if (!res.more && (pending === 0 || changes.length === 0)) {
        setState({ status: 'idle', lastSync: Date.now(), error: undefined, pending });
        return;
      }
    }
    setState({ status: 'idle', lastSync: Date.now(), pending: await db.outbox.count() });
  } catch (e) {
    const offline = e instanceof HubError && e.status === 0;
    const unauthorized = e instanceof HubError && e.status === 401;
    setState({
      status: offline ? 'offline' : 'error',
      error: unauthorized ? 'This device is no longer paired. Pair it again in Settings.' : (e as Error).message,
      pending: await db.outbox.count(),
    });
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delay = 900) {
  if (!hub()) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncNow();
  }, delay);
}

let loopAbort: AbortController | null = null;

/** Keep in sync: SSE change notifications + periodic + on focus/online. */
export function startSyncLoop() {
  onCommit(() => {
    void db.outbox.count().then((pending) => setState({ pending }));
    scheduleSync();
  });
  const restart = () => {
    loopAbort?.abort();
    loopAbort = null;
    if (!hub()) {
      setState({ status: 'disabled' });
      return;
    }
    const ac = new AbortController();
    loopAbort = ac;
    void syncNow();
    const listen = async () => {
      let backoff = 1000;
      while (!ac.signal.aborted) {
        try {
          await sseStream(
            '/api/events',
            (event, data) => {
              backoff = 1000;
              if (event === 'change' || event === 'hello') {
                void getMeta<number>('syncSince', 0).then((since) => {
                  if ((data?.seq ?? 0) > since) scheduleSync(150);
                });
              }
            },
            ac.signal,
          );
        } catch {
          // fall through to retry
        }
        if (ac.signal.aborted) return;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
        void syncNow();
      }
    };
    void listen();
  };
  onHubChange(restart);
  restart();
  setInterval(() => void syncNow(), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
}

/** Forget sync cursor (used after unpairing). */
export async function resetSyncState() {
  await setMeta('syncSince', 0);
  await setMeta('syncHubId', null);
  await markAllDirty();
}
