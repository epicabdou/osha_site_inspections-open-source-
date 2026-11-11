import 'client-only';
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Role } from '@/lib/auth/roles';
import type {
  AnswerEvent,
  CorrectiveAction,
  Inspection,
  Mutation,
  RejectReason,
  SyncState,
  Template,
} from '@/lib/schemas';
import type { HlcState } from '@/lib/sync/hlc';

/**
 * The device database (IndexedDB via Dexie). Client-only: server code must never
 * import this module (enforced by 'client-only' and an ESLint rule).
 *
 * Writes that belong together (an answer event and its outbox entry, a photo row
 * and the event that references it) go in one Dexie transaction. Never await
 * fetch, crypto.subtle or any other non-Dexie promise inside a transaction: it
 * commits the transaction early.
 */

export type LocalTemplate = Template;

export type LocalInspection = Inspection & {
  /** Device time of the last local change; orders the inspection list. */
  updatedAt: string;
  /** Sync state of the inspection record itself (its create/submit mutations). */
  syncState: SyncState;
  rejectReason?: RejectReason;
  /** Server-owned fields, filled in by pull. */
  serverReceivedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
};

export type LocalAnswerEvent = AnswerEvent & { serverReceivedAt?: string };

export type OutboxState = 'queued' | 'sending';

export type OutboxEntry = {
  seq?: number;
  mutationId: string;
  kind: Mutation['kind'];
  payload: Mutation['payload'];
  hlc: string;
  state: OutboxState;
  attempts: number;
  /** Epoch ms; the entry is not sent before this time (backoff). */
  nextAttemptAt: number;
  createdAt: string;
  lastError?: string;
};

/** `rejected`: the server refused the photo for good (e.g. its inspection was rejected). */
export type PhotoUploadState = 'pending' | 'uploading' | 'uploaded' | 'rejected';

export type LocalPhoto = {
  /** SHA-256 of `blob`, hex. Also the upload path and the answer's reference. */
  hash: string;
  /**
   * The compressed JPEG bytes. Stored as an ArrayBuffer rather than a Blob: some WebKit
   * builds cannot put Blobs in IndexedDB, and every engine can store ArrayBuffers.
   */
  data: ArrayBuffer;
  inspectionId: string;
  itemId: string;
  mime: string;
  bytes: number;
  uploadState: PhotoUploadState;
  attempts: number;
  nextAttemptAt: number;
  createdAt: string;
  uploadedAt?: string;
  lastError?: string;
};

export type LocalCorrectiveAction = CorrectiveAction;

export type LastUser = {
  userId: string;
  displayName: string;
  role: Role | null;
};

/** Settings for the demo chaos panel; see lib/demo/settings.ts. */
export type DemoSettings = {
  forceOffline: boolean;
  latencyMs: number;
  dropRate: number;
  clockSkewMs: number;
};

/** Typed values stored in the `meta` table. */
export type MetaValues = {
  deviceId: string;
  lastUser: LastUser;
  pullCursor: number;
  hlc: HlcState;
  demoSettings: DemoSettings;
  installGuideDismissed: boolean;
  persistRequested: boolean;
  lastSyncAt: string;
  /** Milliseconds the device clock is ahead (+) or behind (-) the server, from the last push. */
  clockOffsetMs: number;
};
export type MetaKey = keyof MetaValues;
export type MetaRow = { [K in MetaKey]: { key: K; value: MetaValues[K] } }[MetaKey];

export const DATABASE_NAME = 'field-inspections';

export class FieldDatabase extends Dexie {
  templates!: Table<LocalTemplate, [string, number]>;
  inspections!: EntityTable<LocalInspection, 'id'>;
  answerEvents!: EntityTable<LocalAnswerEvent, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  photos!: EntityTable<LocalPhoto, 'hash'>;
  correctiveActions!: EntityTable<LocalCorrectiveAction, 'id'>;
  meta!: Table<MetaRow, MetaKey>;

  constructor(name: string = DATABASE_NAME) {
    super(name);
    // Version 1. Every later version needs a migration test in tests/unit/dexie-migrations.test.ts.
    this.version(1).stores({
      templates: '[id+version], id',
      inspections: 'id, status, updatedAt',
      answerEvents: 'id, inspectionId, [inspectionId+itemId], syncState',
      outbox: '++seq, mutationId, state, nextAttemptAt',
      photos: 'hash, inspectionId, uploadState',
      correctiveActions: 'id, inspectionId',
      meta: 'key',
    });
  }
}

export const db = new FieldDatabase();

/** Reads a typed meta value. Works inside or outside a transaction. */
export async function getMeta<K extends MetaKey>(
  key: K,
  database: FieldDatabase = db,
): Promise<MetaValues[K] | undefined> {
  const row = await database.meta.get(key);
  return row?.value as MetaValues[K] | undefined;
}

/** Writes a typed meta value. Works inside or outside a transaction. */
export async function setMeta<K extends MetaKey>(
  key: K,
  value: MetaValues[K],
  database: FieldDatabase = db,
): Promise<void> {
  await database.meta.put({ key, value } as MetaRow);
}

/** True for the error IndexedDB raises when the device is out of storage. */
export function isQuotaExceeded(error: unknown): boolean {
  const name = (error as { name?: string; inner?: { name?: string } } | null)?.name;
  const inner = (error as { inner?: { name?: string } } | null)?.inner?.name;
  return name === 'QuotaExceededError' || inner === 'QuotaExceededError';
}
