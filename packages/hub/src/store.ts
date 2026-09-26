// Append-only record store. Every write gets a monotonically increasing `seq`
// (the sync cursor). State lives in memory; durability comes from a JSONL log
// that is periodically compacted into a snapshot. No native dependencies, so
// it runs the same inside Electron, plain Node and Bun.
import fs from 'node:fs';
import path from 'node:path';
import { isNewer, SYNC_TABLES, type AnyRecord, type TableName, type TableRecordMap } from '@anker/core';

export interface StoredRecord {
  table: TableName;
  id: string;
  updatedAt: number;
  seq: number;
  deleted: boolean;
  data: AnyRecord | null;
}

export interface WriteChange {
  table: TableName;
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: AnyRecord | null;
}

type Listener = (changed: StoredRecord[]) => void;

const SNAPSHOT = 'snapshot.jsonl';
const LOG = 'changes.jsonl';
const COMPACT_LINES = 40_000;

export class Store {
  private tables = new Map<TableName, Map<string, StoredRecord>>();
  private logFd: number | null = null;
  private logLines = 0;
  private listeners = new Set<Listener>();
  seq = 0;

  constructor(readonly dir: string) {
    for (const t of SYNC_TABLES) this.tables.set(t, new Map());
  }

  open(): this {
    fs.mkdirSync(this.dir, { recursive: true });
    const snapPath = path.join(this.dir, SNAPSHOT);
    const logPath = path.join(this.dir, LOG);
    let snapSeq = 0;
    if (fs.existsSync(snapPath)) {
      const lines = fs.readFileSync(snapPath, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line) continue;
        const obj = JSON.parse(line);
        if (i === 0 && obj.__meta) {
          snapSeq = obj.seq ?? 0;
          continue;
        }
        this.load(obj as StoredRecord);
      }
      this.seq = Math.max(this.seq, snapSeq);
    }
    if (fs.existsSync(logPath)) {
      const text = fs.readFileSync(logPath, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec: StoredRecord;
        try {
          rec = JSON.parse(line);
        } catch {
          continue; // torn final line after a crash
        }
        this.logLines++;
        if (rec.seq <= snapSeq) continue;
        this.load(rec);
      }
    }
    this.logFd = fs.openSync(logPath, 'a');
    if (this.logLines > COMPACT_LINES) this.compact();
    return this;
  }

  private load(rec: StoredRecord) {
    const t = this.tables.get(rec.table);
    if (!t) return;
    const cur = t.get(rec.id);
    if (!cur || rec.seq >= cur.seq) t.set(rec.id, rec);
    if (rec.seq > this.seq) this.seq = rec.seq;
  }

  close() {
    if (this.logFd !== null) {
      fs.closeSync(this.logFd);
      this.logFd = null;
    }
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  raw(table: TableName, id: string): StoredRecord | undefined {
    return this.tables.get(table)?.get(id);
  }

  get<T extends TableName>(table: T, id: string): TableRecordMap[T] | undefined {
    const r = this.raw(table, id);
    return r && !r.deleted ? (r.data as TableRecordMap[T]) : undefined;
  }

  all<T extends TableName>(table: T): TableRecordMap[T][] {
    const out: TableRecordMap[T][] = [];
    for (const r of this.tables.get(table)!.values()) if (!r.deleted && r.data) out.push(r.data as TableRecordMap[T]);
    return out;
  }

  count(table: TableName): number {
    let n = 0;
    for (const r of this.tables.get(table)!.values()) if (!r.deleted) n++;
    return n;
  }

  /**
   * Apply changes with last-writer-wins. `force` skips the LWW check (used for
   * the hub's own writes, which always bump updatedAt past the current value).
   */
  write(changes: WriteChange[], opts: { force?: boolean } = {}): { applied: StoredRecord[]; rejected: StoredRecord[] } {
    const applied: StoredRecord[] = [];
    const rejected: StoredRecord[] = [];
    const lines: string[] = [];
    for (const ch of changes) {
      const t = this.tables.get(ch.table);
      if (!t || !ch.id) continue;
      const existing = t.get(ch.id);
      if (!opts.force && existing && !isNewer(ch, existing)) {
        rejected.push(existing);
        continue;
      }
      const rec: StoredRecord = {
        table: ch.table,
        id: ch.id,
        updatedAt: ch.updatedAt,
        seq: ++this.seq,
        deleted: !!ch.deleted,
        data: ch.deleted ? null : (ch.data ?? null),
      };
      t.set(ch.id, rec);
      lines.push(JSON.stringify(rec));
      applied.push(rec);
    }
    if (lines.length && this.logFd !== null) {
      fs.writeSync(this.logFd, `${lines.join('\n')}\n`);
      this.logLines += lines.length;
    }
    if (applied.length) {
      for (const fn of this.listeners) {
        try {
          fn(applied);
        } catch (e) {
          console.error('[store] listener failed', e);
        }
      }
      if (this.logLines > COMPACT_LINES) this.compact();
    }
    return { applied, rejected };
  }

  /** Hub-side upsert: bumps updatedAt past the stored version so it always wins. */
  put<T extends TableName>(table: T, records: TableRecordMap[T][]): TableRecordMap[T][] {
    const now = Date.now();
    const out: TableRecordMap[T][] = [];
    const changes: WriteChange[] = records.map((r) => {
      const existing = this.raw(table, r.id);
      const updatedAt = Math.max(now, r.updatedAt ?? 0, (existing?.updatedAt ?? 0) + 1);
      const data = { ...r, updatedAt } as TableRecordMap[T];
      out.push(data);
      return { table, id: r.id, updatedAt, data };
    });
    this.write(changes, { force: true });
    return out;
  }

  remove(table: TableName, ids: string[]) {
    const now = Date.now();
    this.write(
      ids.map((id) => ({ table, id, updatedAt: Math.max(now, (this.raw(table, id)?.updatedAt ?? 0) + 1), deleted: true })),
      { force: true },
    );
  }

  /** Mixed batch (several tables) of hub-side writes in one log append. */
  batch(ops: { table: TableName; put?: AnyRecord[]; remove?: string[] }[]) {
    const now = Date.now();
    const changes: WriteChange[] = [];
    for (const op of ops) {
      for (const r of op.put ?? []) {
        const existing = this.raw(op.table, r.id);
        const updatedAt = Math.max(now, r.updatedAt ?? 0, (existing?.updatedAt ?? 0) + 1);
        changes.push({ table: op.table, id: r.id, updatedAt, data: { ...r, updatedAt } as AnyRecord });
      }
      for (const id of op.remove ?? []) {
        changes.push({ table: op.table, id, updatedAt: Math.max(now, (this.raw(op.table, id)?.updatedAt ?? 0) + 1), deleted: true });
      }
    }
    return this.write(changes, { force: true });
  }

  changesSince(since: number, limit: number): { changes: StoredRecord[]; more: boolean } {
    const out: StoredRecord[] = [];
    for (const t of this.tables.values()) for (const r of t.values()) if (r.seq > since) out.push(r);
    out.sort((a, b) => a.seq - b.seq);
    return { changes: out.slice(0, limit), more: out.length > limit };
  }

  /** Write a fresh snapshot atomically and truncate the log. */
  compact() {
    const snapPath = path.join(this.dir, SNAPSHOT);
    const tmp = `${snapPath}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, `${JSON.stringify({ __meta: true, v: 1, seq: this.seq, at: Date.now() })}\n`);
    let buf: string[] = [];
    for (const t of this.tables.values()) {
      for (const r of t.values()) {
        buf.push(JSON.stringify(r));
        if (buf.length >= 2000) {
          fs.writeSync(fd, `${buf.join('\n')}\n`);
          buf = [];
        }
      }
    }
    if (buf.length) fs.writeSync(fd, `${buf.join('\n')}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, snapPath);
    if (this.logFd !== null) fs.closeSync(this.logFd);
    fs.writeFileSync(path.join(this.dir, LOG), '');
    this.logFd = fs.openSync(path.join(this.dir, LOG), 'a');
    this.logLines = 0;
  }

  /** Keep a dated copy of the whole collection (called once a day). */
  backup(keep = 10): string {
    const dir = path.join(this.dir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const name = `anker-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    const file = path.join(dir, name);
    const dump: Record<string, unknown[]> = {};
    for (const t of SYNC_TABLES) dump[t] = this.all(t);
    fs.writeFileSync(file, JSON.stringify({ app: 'anker', version: 1, exportedAt: Date.now(), ...dump }));
    const files = fs.readdirSync(dir).filter((f) => /^anker-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
    return file;
  }
}
