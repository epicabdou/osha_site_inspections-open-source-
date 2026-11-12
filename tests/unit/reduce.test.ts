import { describe, expect, it } from 'vitest';
import {
  compareEvents,
  reduceAnswers,
  reduceItem,
  type ReducibleEvent,
} from '@/lib/answers/reduce';
import type { AnswerValue } from '@/lib/schemas';

let n = 0;
function event(
  itemId: string,
  value: AnswerValue,
  wallMs: number,
  deviceId = 'device-a',
  extra: Partial<ReducibleEvent> = {},
): ReducibleEvent {
  n += 1;
  return {
    id: `e${String(n).padStart(4, '0')}`,
    itemId,
    value,
    photoHashes: [],
    hlc: `${String(wallMs).padStart(15, '0')}-00000-${deviceId}`,
    deviceId,
    ...extra,
  };
}

const pass = { kind: 'pass_fail_na', result: 'pass' } as const;
const fail = { kind: 'pass_fail_na', result: 'fail' } as const;

describe('reduceItem', () => {
  it('the latest event wins', () => {
    const answer = reduceItem('x', [event('x', pass, 1), event('x', fail, 2)]);
    expect(answer.current?.value).toEqual(fail);
    expect(answer.history).toHaveLength(2);
  });

  it('does not depend on the order events arrive in', () => {
    const a = event('x', pass, 1);
    const b = event('x', fail, 3);
    const c = event('x', pass, 2);
    expect(reduceItem('x', [b, c, a]).current).toBe(b);
    expect(reduceItem('x', [a, b, c]).history.map((e) => e.id)).toEqual([a.id, c.id, b.id]);
  });

  it('a cleared event removes the answer but keeps the history', () => {
    const answer = reduceItem('x', [event('x', pass, 1), event('x', { kind: 'cleared' }, 2)]);
    expect(answer.current).toBeUndefined();
    expect(answer.history).toHaveLength(2);
  });

  it('an answer given after clearing becomes current again', () => {
    const answer = reduceItem('x', [
      event('x', pass, 1),
      event('x', { kind: 'cleared' }, 2),
      event('x', fail, 3),
    ]);
    expect(answer.current?.value).toEqual(fail);
  });

  it('ignores rejected events for the current value', () => {
    const accepted = event('x', pass, 1, 'device-a', { syncState: 'synced' });
    const rejected = event('x', fail, 2, 'device-a', { syncState: 'rejected' });
    const answer = reduceItem('x', [accepted, rejected]);
    expect(answer.current).toBe(accepted);
    expect(answer.history).toContain(rejected);
  });

  it('flags a conflict when two devices disagree', () => {
    const answer = reduceItem('x', [
      event('x', pass, 1, 'device-a'),
      event('x', fail, 2, 'device-b'),
    ]);
    expect(answer.conflicting).toBe(true);
    expect(answer.current?.deviceId).toBe('device-b');
  });

  it('no conflict when two devices agree, or one device changes its mind', () => {
    expect(
      reduceItem('x', [event('x', pass, 1, 'device-a'), event('x', pass, 2, 'device-b')])
        .conflicting,
    ).toBe(false);
    expect(
      reduceItem('x', [event('x', pass, 1, 'device-a'), event('x', fail, 2, 'device-a')])
        .conflicting,
    ).toBe(false);
  });

  it('the conflict resolves when the devices come to agree', () => {
    const answer = reduceItem('x', [
      event('x', pass, 1, 'device-a'),
      event('x', fail, 2, 'device-b'),
      event('x', fail, 3, 'device-a'),
    ]);
    expect(answer.conflicting).toBe(false);
  });
});

describe('compareEvents', () => {
  it('orders by clock, then device id, then event id', () => {
    const a = event('x', pass, 1, 'device-a');
    const b = { ...a, id: 'zzz', deviceId: 'device-b', hlc: a.hlc };
    expect(compareEvents(a, b)).toBe(-1);
    expect(compareEvents(b, a)).toBe(1);
    expect(compareEvents(a, a)).toBe(0);
  });
});

describe('reduceAnswers', () => {
  it('groups by item', () => {
    const answers = reduceAnswers([event('x', pass, 1), event('y', fail, 1), event('x', fail, 2)]);
    expect([...answers.keys()].sort()).toEqual(['x', 'y']);
    expect(answers.get('x')?.current?.value).toEqual(fail);
    expect(answers.get('y')?.history).toHaveLength(1);
  });
});
