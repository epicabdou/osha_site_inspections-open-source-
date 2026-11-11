import { v7 as uuidv7 } from 'uuid';
import type { AnswerValue, Mutation } from '@/lib/schemas';

/**
 * Builders for well-formed mutations, as a device would send them.
 * Clocks increase on every call so events order the way they were created.
 */
let wall = 1_794_430_000_000;
const nextHlc = (deviceId: string) => `${String((wall += 1)).padStart(15, '0')}-00000-${deviceId}`;

export function createMutation(
  userId: string,
  overrides: Partial<Extract<Mutation, { kind: 'inspection.create' }>['payload']> = {},
): Extract<Mutation, { kind: 'inspection.create' }> {
  return {
    mutationId: uuidv7(),
    kind: 'inspection.create',
    hlc: nextHlc('device-a'),
    payload: {
      id: uuidv7(),
      templateId: 'scaffold-inspection',
      templateVersion: 1,
      site: 'Plant room B2',
      status: 'draft',
      createdBy: userId,
      createdAtDevice: '2026-11-11T09:00:00.000Z',
      hasCriticalFailure: false,
      ...overrides,
    },
  };
}

export function answerMutation(
  userId: string,
  inspectionId: string,
  itemId: string,
  value: AnswerValue,
  options: { deviceId?: string; note?: string; photoHashes?: string[] } = {},
): Extract<Mutation, { kind: 'answer.record' }> {
  const deviceId = options.deviceId ?? 'device-a';
  const hlc = nextHlc(deviceId);
  return {
    mutationId: uuidv7(),
    kind: 'answer.record',
    hlc,
    payload: {
      id: uuidv7(),
      inspectionId,
      itemId,
      value,
      ...(options.note ? { note: options.note } : {}),
      photoHashes: options.photoHashes ?? [],
      hlc,
      deviceId,
      authorId: userId,
      deviceTime: '2026-11-11T09:05:00.000Z',
    },
  };
}

export function submitMutation(
  inspectionId: string,
): Extract<Mutation, { kind: 'inspection.submit' }> {
  return {
    mutationId: uuidv7(),
    kind: 'inspection.submit',
    hlc: nextHlc('device-a'),
    payload: { inspectionId, submittedAtDevice: '2026-11-11T09:30:00.000Z' },
  };
}
