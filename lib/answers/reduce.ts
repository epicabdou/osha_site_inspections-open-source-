import type { AnswerValue } from '@/lib/schemas';

/**
 * The fields of an answer event that the reducer needs. Both the device's events
 * (with `syncState`) and the server's rows fit this shape.
 */
export type ReducibleEvent = {
  id: string;
  itemId: string;
  value: AnswerValue;
  note?: string | undefined;
  photoHashes: string[];
  hlc: string;
  deviceId: string;
  syncState?: 'local' | 'queued' | 'synced' | 'rejected';
};

export type ItemAnswer<E extends ReducibleEvent = ReducibleEvent> = {
  itemId: string;
  /** The winning event, or undefined if the latest event cleared the answer. */
  current: E | undefined;
  /** Every event for the item, oldest first: the audit trail. */
  history: E[];
  /**
   * True when devices disagree: the latest events from two or more devices carry
   * different values. Both stay in the history; the highest clock wins.
   */
  conflicting: boolean;
};

/**
 * Orders events by `(hlc, deviceId)`. The HLC string already ends in the device id;
 * comparing `deviceId` as well keeps the order total even for hand-written clocks.
 */
export function compareEvents(a: ReducibleEvent, b: ReducibleEvent): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when two events record the same answer (value, note and photos). */
export function sameAnswer(a: ReducibleEvent, b: ReducibleEvent): boolean {
  return (
    JSON.stringify(a.value) === JSON.stringify(b.value) &&
    (a.note ?? '') === (b.note ?? '') &&
    a.photoHashes.join(',') === b.photoHashes.join(',')
  );
}

/**
 * Reduces one item's events to its answer. Rejected events stay in the history but
 * never become the current value: the server did not accept them.
 */
export function reduceItem<E extends ReducibleEvent>(itemId: string, events: E[]): ItemAnswer<E> {
  const history = [...events].sort(compareEvents);
  const effective = history.filter((event) => event.syncState !== 'rejected');
  const latest = effective.at(-1);
  const current = latest && latest.value.kind !== 'cleared' ? latest : undefined;

  const latestPerDevice = new Map<string, E>();
  for (const event of effective) latestPerDevice.set(event.deviceId, event);
  const heads = [...latestPerDevice.values()];
  const conflicting = heads.length > 1 && heads.some((head) => !sameAnswer(head, heads[0]!));

  return { itemId, current, history, conflicting };
}

/**
 * The current answer for every item of an inspection.
 *
 * This is the single definition of "current value", shared by the field app, the
 * dashboard and the tests: the event with the highest `(hlc, deviceId)` wins, and
 * a `cleared` event removes the answer. The result does not depend on the order of
 * `events`, which is what lets two devices converge after exchanging events.
 */
export function reduceAnswers<E extends ReducibleEvent>(events: E[]): Map<string, ItemAnswer<E>> {
  const byItem = new Map<string, E[]>();
  for (const event of events) {
    const list = byItem.get(event.itemId);
    if (list) list.push(event);
    else byItem.set(event.itemId, [event]);
  }
  const result = new Map<string, ItemAnswer<E>>();
  for (const [itemId, itemEvents] of byItem) result.set(itemId, reduceItem(itemId, itemEvents));
  return result;
}
