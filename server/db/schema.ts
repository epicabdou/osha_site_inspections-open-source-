import 'server-only';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnswerValue, Template } from '@/lib/schemas';

/**
 * One sequence shared by every synced table. Every insert and update sets
 * `server_seq`, and pull returns rows with `server_seq > cursor`.
 *
 * Concurrent transactions can commit out of sequence order, which would let a
 * client's cursor skip a row. Every transaction that assigns `server_seq` first
 * takes `pg_advisory_xact_lock(SERVER_SEQ_LOCK_KEY)`, so assignment and commit are
 * serialised. See docs/SYNC.md for the trade-off.
 */
export const serverSeq = pgSequence('server_seq', { startWith: 1, increment: 1 });

/** The fixed advisory-lock key that serialises server_seq assignment. */
export const SERVER_SEQ_LOCK_KEY = 7_340_001;

const serverSeqColumn = () =>
  bigint('server_seq', { mode: 'number' })
    .notNull()
    .default(sql`nextval('server_seq')`);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const inspectionStatusEnum = pgEnum('inspection_status', [
  'draft',
  'submitted',
  'cancelled',
  'closed',
]);

export const correctiveActionStatusEnum = pgEnum('corrective_action_status', ['open', 'closed']);

/** Published templates. Immutable: a change is a new (id, version) row. */
export const templates = pgTable(
  'templates',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    definition: jsonb('definition').$type<Template>().notNull(),
    publishedAt: timestamptz('published_at').notNull().defaultNow(),
    serverSeq: serverSeqColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    index('templates_server_seq_idx').on(t.serverSeq),
  ],
);

export const inspections = pgTable(
  'inspections',
  {
    id: uuid('id').primaryKey(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    site: text('site').notNull(),
    status: inspectionStatusEnum('status').notNull().default('draft'),
    createdBy: text('created_by').notNull(),
    createdAtDevice: timestamptz('created_at_device').notNull(),
    submittedAtDevice: timestamptz('submitted_at_device'),
    serverReceivedAt: timestamptz('server_received_at').notNull().defaultNow(),
    cancelledAt: timestamptz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    hasCriticalFailure: boolean('has_critical_failure').notNull().default(false),
    serverSeq: serverSeqColumn(),
  },
  (t) => [
    foreignKey({
      columns: [t.templateId, t.templateVersion],
      foreignColumns: [templates.id, templates.version],
      name: 'inspections_template_fk',
    }),
    index('inspections_created_by_idx').on(t.createdBy),
    index('inspections_server_seq_idx').on(t.serverSeq),
  ],
);

/** Answers as permanent events. Append-only: rows are never updated or deleted. */
export const answerEvents = pgTable(
  'answer_events',
  {
    id: uuid('id').primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id),
    itemId: text('item_id').notNull(),
    value: jsonb('value').$type<AnswerValue>().notNull(),
    note: text('note'),
    photoHashes: text('photo_hashes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hlc: text('hlc').notNull(),
    deviceId: text('device_id').notNull(),
    authorId: text('author_id').notNull(),
    deviceTime: timestamptz('device_time').notNull(),
    serverReceivedAt: timestamptz('server_received_at').notNull().defaultNow(),
    serverSeq: serverSeqColumn(),
  },
  (t) => [
    index('answer_events_inspection_item_idx').on(t.inspectionId, t.itemId),
    index('answer_events_server_seq_idx').on(t.serverSeq),
  ],
);

/** Uploaded photos, keyed by the SHA-256 of the compressed bytes. */
export const photos = pgTable(
  'photos',
  {
    hash: text('hash').primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id),
    itemId: text('item_id').notNull(),
    blobUrl: text('blob_url').notNull(),
    bytes: integer('bytes').notNull(),
    mime: text('mime').notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    uploadedAt: timestamptz('uploaded_at').notNull().defaultNow(),
  },
  (t) => [index('photos_inspection_idx').on(t.inspectionId)],
);

/** Raised by an accepted critical fail; closed only by a supervisor, with a note. */
export const correctiveActions = pgTable(
  'corrective_actions',
  {
    id: uuid('id').primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id),
    itemId: text('item_id').notNull(),
    sourceEventId: uuid('source_event_id')
      .notNull()
      .unique()
      .references(() => answerEvents.id),
    status: correctiveActionStatusEnum('status').notNull().default('open'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    closedAt: timestamptz('closed_at'),
    closedBy: text('closed_by'),
    closeNote: text('close_note'),
    serverSeq: serverSeqColumn(),
  },
  (t) => [
    index('corrective_actions_inspection_idx').on(t.inspectionId),
    index('corrective_actions_server_seq_idx').on(t.serverSeq),
  ],
);

/** The idempotency ledger: a mutationId seen before returns its stored result. */
export const processedMutations = pgTable('processed_mutations', {
  mutationId: uuid('mutation_id').primaryKey(),
  deviceId: text('device_id').notNull(),
  result: jsonb('result').notNull(),
  processedAt: timestamptz('processed_at').notNull().defaultNow(),
});
