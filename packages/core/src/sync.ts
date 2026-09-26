import type { AnyRecord, TableName } from './types';

export interface SyncChange {
  table: TableName;
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: AnyRecord | null;
}

export interface SyncRequest {
  clientId: string;
  /** Last hub sequence number this client has seen */
  since: number;
  changes: SyncChange[];
  limit?: number;
}

export interface SyncResponse {
  hubId: string;
  seq: number;
  changes: SyncChange[];
  more: boolean;
  /** Pushed changes that lost against a newer hub version (the hub's winner is included) */
  rejected: SyncChange[];
  serverTime: number;
}

/** Last-writer-wins: is `a` newer than `b`? Ties go to deletions. */
export function isNewer(
  a: { updatedAt: number; deleted?: boolean },
  b: { updatedAt: number; deleted?: boolean } | undefined | null,
): boolean {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return !!a.deleted && !b.deleted;
}

export interface PairingInfo {
  hubId: string;
  name: string;
  urls: string[];
  version: string;
}
