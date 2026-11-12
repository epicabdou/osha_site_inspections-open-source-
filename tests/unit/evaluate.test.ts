import { describe, expect, it } from 'vitest';
import {
  failingCriticalItems,
  isCriticalFailure,
  isFailure,
  progress,
  submitProblems,
  valueMatchesItem,
} from '@/lib/answers/evaluate';
import { reduceAnswers, type ReducibleEvent } from '@/lib/answers/reduce';
import type { AnswerValue, Template, TemplateItem } from '@/lib/schemas';

const guardrail: TemplateItem = {
  id: 'guardrail-height',
  prompt: 'Top guardrail height',
  kind: 'number',
  unit: 'mm',
  min: 950,
  max: 1150,
  critical: true,
  photoOnFail: true,
};
const tag: TemplateItem = {
  id: 'tag',
  prompt: 'Tag present',
  kind: 'pass_fail_na',
  critical: true,
};
const notes: TemplateItem = { id: 'notes', prompt: 'Notes', kind: 'text' };

const template: Template = {
  id: 'scaffold-inspection',
  version: 1,
  title: 'Scaffold',
  sections: [{ id: 's', title: 'S', items: [tag, guardrail, notes] }],
};

let n = 0;
const event = (itemId: string, value: AnswerValue, extra: Partial<ReducibleEvent> = {}) => ({
  id: `e${(n += 1)}`,
  itemId,
  value,
  photoHashes: [],
  hlc: `${String(n).padStart(15, '0')}-00000-d`,
  deviceId: 'd',
  ...extra,
});

describe('isFailure', () => {
  it('treats a fail result as a failure', () => {
    expect(isFailure(tag, { kind: 'pass_fail_na', result: 'fail' })).toBe(true);
    expect(isFailure(tag, { kind: 'pass_fail_na', result: 'na' })).toBe(false);
  });

  it('treats a reading outside min..max as a failure, in the template unit', () => {
    expect(isFailure(guardrail, { kind: 'number', value: 900 })).toBe(true);
    expect(isFailure(guardrail, { kind: 'number', value: 950 })).toBe(false);
    expect(isFailure(guardrail, { kind: 'number', value: 1150 })).toBe(false);
    expect(isFailure(guardrail, { kind: 'number', value: 1151 })).toBe(true);
    expect(isFailure(guardrail, undefined)).toBe(false);
  });

  it('only critical items raise critical failures', () => {
    expect(isCriticalFailure(tag, { kind: 'pass_fail_na', result: 'fail' })).toBe(true);
    expect(
      isCriticalFailure({ ...tag, critical: false }, { kind: 'pass_fail_na', result: 'fail' }),
    ).toBe(false);
  });
});

describe('valueMatchesItem', () => {
  it('accepts the item kind or cleared, nothing else', () => {
    expect(valueMatchesItem(guardrail, { kind: 'number', value: 1 })).toBe(true);
    expect(valueMatchesItem(guardrail, { kind: 'cleared' })).toBe(true);
    expect(valueMatchesItem(guardrail, { kind: 'text', value: '1000' })).toBe(false);
  });
});

describe('submitProblems', () => {
  it('lists unanswered items', () => {
    const problems = submitProblems(template, reduceAnswers([]));
    expect(problems.map((p) => p.itemId)).toEqual(['tag', 'guardrail-height', 'notes']);
  });

  it('a failed photoOnFail item needs a note and a photo', () => {
    const events = [
      event('tag', { kind: 'pass_fail_na', result: 'pass' }),
      event('guardrail-height', { kind: 'number', value: 800 }),
      event('notes', { kind: 'text', value: 'ok' }),
    ];
    expect(submitProblems(template, reduceAnswers(events)).map((p) => p.problem)).toEqual([
      'needs_note',
      'needs_photo',
    ]);
    events.push(
      event(
        'guardrail-height',
        { kind: 'number', value: 800 },
        { note: 'Rail low', photoHashes: ['a'.repeat(64)] },
      ),
    );
    expect(submitProblems(template, reduceAnswers(events))).toEqual([]);
  });

  it('lists failing critical items and counts progress', () => {
    const answers = reduceAnswers([
      event('tag', { kind: 'pass_fail_na', result: 'fail' }),
      event('guardrail-height', { kind: 'number', value: 1000 }),
    ]);
    expect(failingCriticalItems(template, answers).map((i) => i.id)).toEqual(['tag']);
    expect(progress(template, answers)).toEqual({ answered: 2, total: 3 });
  });
});
