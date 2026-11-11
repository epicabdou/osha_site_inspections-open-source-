import 'server-only';
import type { AnswerValue, Mutation } from '@/lib/schemas';
import { encodeHlc } from '@/lib/sync/hlc';
import type { Db } from '@/server/db/types';
import { processPush } from '@/server/sync/push';

/**
 * One past, submitted inspection so the dashboard and its history panel are never empty:
 * a critical failure with an open corrective action, and a few answers that were
 * corrected (superseded) along the way.
 *
 * It is created through the real push path, with fixed ids, so it passes the same checks
 * as device data and seeding twice changes nothing.
 */

const DEVICE = '019a6f00-0000-7000-8000-00000000d001';
const INSPECTION = '019a6f00-0000-7000-8000-000000000001';
const START = Date.parse('2026-11-09T08:05:00.000Z');

/** Deterministic UUIDv7-shaped ids for seed records. */
const id = (n: number) => `019a6f00-0000-7000-8000-${String(n).padStart(12, '0')}`;

type Step = { item: string; value: AnswerValue; note?: string; photoHashes?: string[] };

/** The answers, in the order they were given. Later entries for an item supersede earlier ones. */
const STEPS: Step[] = [
  { item: 'tag-in-date', value: { kind: 'pass_fail_na', result: 'pass' } },
  { item: 'safe-way-up', value: { kind: 'pass_fail_na', result: 'pass' } },
  { item: 'access-gate', value: { kind: 'pass_fail_na', result: 'na' } },
  {
    item: 'access-gate',
    value: { kind: 'pass_fail_na', result: 'pass' },
    note: 'Gate found behind the ladder',
  },
  { item: 'base-plates', value: { kind: 'pass_fail_na', result: 'pass' } },
  { item: 'ties-and-braces', value: { kind: 'pass_fail_na', result: 'pass' } },
  { item: 'upright-and-level', value: { kind: 'pass_fail_na', result: 'pass' } },
  { item: 'guardrail-height', value: { kind: 'number', value: 1000 } },
  {
    item: 'guardrail-height',
    value: { kind: 'number', value: 1010 },
    note: 'Re-measured at the corner',
  },
  { item: 'boards-complete', value: { kind: 'pass_fail_na', result: 'pass' } },
  {
    item: 'toe-boards',
    value: { kind: 'pass_fail_na', result: 'fail' },
    note: 'Missing on the north side',
  },
  { item: 'weather', value: { kind: 'text', value: 'Dry' } },
  { item: 'weather', value: { kind: 'text', value: 'Dry, light wind from the west' } },
  {
    item: 'overview-photo',
    value: { kind: 'photo' },
    photoHashes: ['5eed000000000000000000000000000000000000000000000000000000000001'],
  },
  {
    item: 'other-notes',
    value: { kind: 'text', value: 'Scaffold in use by the electrical crew.' },
  },
  // A closer look at the tag: it expired yesterday. Critical.
  {
    item: 'tag-in-date',
    value: { kind: 'pass_fail_na', result: 'fail' },
    note: 'Tag dated last week; no re-inspection recorded',
    photoHashes: ['5eed000000000000000000000000000000000000000000000000000000000002'],
  },
];

export function demoMutations(inspectorId: string): Mutation[] {
  const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();
  const hlc = (minutes: number) =>
    encodeHlc({ wallMs: START + minutes * 60_000, counter: 0 }, DEVICE);
  const mutations: Mutation[] = [
    {
      mutationId: id(100),
      kind: 'inspection.create',
      hlc: hlc(0),
      payload: {
        id: INSPECTION,
        templateId: 'scaffold-inspection',
        templateVersion: 1,
        site: 'Plant room B2',
        status: 'draft',
        createdBy: inspectorId,
        createdAtDevice: at(0),
        hasCriticalFailure: false,
      },
    },
  ];
  STEPS.forEach((step, index) => {
    const minutes = 2 + index * 2;
    mutations.push({
      mutationId: id(200 + index),
      kind: 'answer.record',
      hlc: hlc(minutes),
      payload: {
        id: id(300 + index),
        inspectionId: INSPECTION,
        itemId: step.item,
        value: step.value,
        ...(step.note ? { note: step.note } : {}),
        photoHashes: step.photoHashes ?? [],
        hlc: hlc(minutes),
        deviceId: DEVICE,
        authorId: inspectorId,
        deviceTime: at(minutes),
      },
    });
  });
  mutations.push({
    mutationId: id(400),
    kind: 'inspection.submit',
    hlc: hlc(60),
    payload: { inspectionId: INSPECTION, submittedAtDevice: at(60) },
  });
  return mutations;
}

/** Pushes the demo inspection as its inspector. Safe to run again. */
export async function seedDemoInspection(db: Db, inspectorId: string) {
  const results = await processPush(
    db,
    { userId: inspectorId, role: 'inspector' },
    DEVICE,
    demoMutations(inspectorId),
  );
  const rejected = results.filter((result) => result.status === 'rejected');
  if (rejected.length) throw new Error(`Seed mutations rejected: ${JSON.stringify(rejected)}`);
  return results.filter((result) => result.status === 'accepted').length;
}
